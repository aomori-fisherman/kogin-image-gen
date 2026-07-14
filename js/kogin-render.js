/* kogin-render.js
   level行列（0..levels-1）を「こぎん風チャート」としてcanvasに描画する。決定論。

   ■ producible（実際に刺せる）担保 — 渡り長の上限
     こぎんは「一本の渡り糸(float)」が長すぎると引っかかる/糸が抜ける/締まりすぎて
     実際に刺せない（所長確認・2026-07-14）。伝統の上限＝FLOAT_MAX=7目。
     面（べた）を「長い横バー1本」で塗らず、短い渡り(最大7目)＋隙間で段々に充填する。
     行ごとに隙間位置をオフセットしてひし形/モドコ調のテクスチャにする。
     生成物に float>7 が1つも無いことを KoginRender.verifyFloats() で機械検証できる。 */

(function (global) {
  'use strict';

  // ---- producible ルール -----------------------------------------------
  var FLOAT_MAX = 7;   // 一本の渡り糸(横連続の刺し目)の最大目数。超えると実際に刺せない。
  var GAP = 1;         // 渡りと渡りの間に落とす目数（グリッド上で1目空ける）。

  var COLORS = {
    ground: '#1b2a4a',   // 藍地
    thread: '#eef2f5',   // 白糸
    grid: 'rgba(255,255,255,0.10)',
    gridStrong: 'rgba(255,255,255,0.22)'
  };

  /* 1行(level配列)から、指定level以上の連続オンの横ランを抽出。
     lv0=非刺し。levelごとに濃淡を出すため、各セルのlevelも保持する。
     返り値: [{start, len}] （levelは分解後にセル参照で拾う） */
  function extractRuns(levels, gridW, y) {
    var runs = [];
    var x = 0;
    while (x < gridW) {
      if (levels[y * gridW + x] <= 0) { x++; continue; }
      var start = x;
      while (x < gridW && levels[y * gridW + x] > 0) x++;
      runs.push({ start: start, len: x - start });
    }
    return runs;
  }

  /* 1本の論理ラン(start,len)を producible な短い渡りに分解。
     返り値: [{start, len}]（各 len は 1..FLOAT_MAX）。
     段々こぎん充填: 隙間位置を行ごとにオフセットして斜めに段を流す。 */
  function splitRun(start, len, rowIndex) {
    if (len <= FLOAT_MAX) return [{ start: start, len: len }];

    var period = FLOAT_MAX + GAP;
    var phase = (rowIndex * (Math.floor(FLOAT_MAX / 2) + 1)) % period;

    var segs = [];
    var x = start;
    var end = start + len;

    var first = FLOAT_MAX - phase;
    if (first <= 0) first += period;
    if (first > FLOAT_MAX) first = FLOAT_MAX;

    var segLen = Math.min(first, end - x);
    if (segLen > 0) segs.push({ start: x, len: segLen });
    x += segLen + GAP;

    while (x < end) {
      segLen = Math.min(FLOAT_MAX, end - x);
      if (segLen > 0) segs.push({ start: x, len: segLen });
      x += segLen + GAP;
    }
    return segs;
  }

  /* levels行列 → 実際に糸が乗るセルのマップ。
     stitched[y*gridW+x] = level（>0）。分解後の渡りだけを記録。
     verifyFloats / 描画の両方がこれを使う（単一の真実）。 */
  function buildStitchMap(levels, gridW, gridH) {
    var stitched = new Uint8Array(gridW * gridH);
    for (var y = 0; y < gridH; y++) {
      var runs = extractRuns(levels, gridW, y);
      for (var r = 0; r < runs.length; r++) {
        var segs = splitRun(runs[r].start, runs[r].len, y);
        for (var s = 0; s < segs.length; s++) {
          for (var dx = 0; dx < segs[s].len; dx++) {
            var gx = segs[s].start + dx;
            // 元セルの level を保持（濃淡表現用）
            stitched[y * gridW + gx] = levels[y * gridW + gx];
          }
        }
      }
    }
    return stitched;
  }

  /* producible検証: stitchedマップ内の横連続(float)が floatMax を超える箇所を列挙。
     返り値: [{y, start, len}]。空なら合格。 */
  function verifyFloats(stitched, gridW, gridH, floatMax) {
    floatMax = floatMax || FLOAT_MAX;
    var violations = [];
    for (var y = 0; y < gridH; y++) {
      var runLen = 0, runStart = 0;
      for (var x = 0; x < gridW; x++) {
        if (stitched[y * gridW + x] > 0) {
          if (runLen === 0) runStart = x;
          runLen++;
        } else {
          if (runLen > floatMax) violations.push({ y: y, start: runStart, len: runLen });
          runLen = 0;
        }
      }
      if (runLen > floatMax) violations.push({ y: y, start: runStart, len: runLen });
    }
    return violations;
  }

  /**
   * こぎんチャートを描画。
   * @param {HTMLCanvasElement} canvas
   * @param {Uint8Array} levels level行列(row-major)
   * @param {number} gridW
   * @param {number} gridH
   * @param {object} opts {numLevels, style:'dash'|'fill', showGrid, cellW}
   */
  function render(canvas, levels, gridW, gridH, opts) {
    opts = opts || {};
    var numLevels = opts.numLevels || 3;
    var style = opts.style || 'dash';
    var showGrid = opts.showGrid !== false;

    var cellW = opts.cellW || 14;
    var cellH = opts.cellH || Math.round(cellW * 0.66);
    if (cellH < 4) cellH = 4;

    var pad = opts.pad != null ? opts.pad : 16;
    var W = gridW * cellW + pad * 2;
    var H = gridH * cellH + pad * 2;
    canvas.width = W;
    canvas.height = H;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, W, H);

    if (showGrid) {
      ctx.lineWidth = 1;
      for (var gx = 0; gx <= gridW; gx++) {
        ctx.strokeStyle = (gx % 10 === 0) ? COLORS.gridStrong : COLORS.grid;
        var px = pad + gx * cellW + 0.5;
        line(ctx, px, pad, px, H - pad);
      }
      for (var gy = 0; gy <= gridH; gy++) {
        ctx.strokeStyle = (gy % 10 === 0) ? COLORS.gridStrong : COLORS.grid;
        var py = pad + gy * cellH + 0.5;
        line(ctx, pad, py, W - pad, py);
      }
    }

    // producible な短い渡りに分解したマップを作る（面のべた塗りをしない）
    var stitched = buildStitchMap(levels, gridW, gridH);

    // producible検証（float>FLOAT_MAX が無いこと）。違反があれば info に載せる。
    var violations = verifyFloats(stitched, gridW, gridH, FLOAT_MAX);

    // 刺し目描画: stitchedマップの連続runごとに短い渡りとして描く
    ctx.fillStyle = COLORS.thread;
    for (var y = 0; y < gridH; y++) {
      var x = 0;
      while (x < gridW) {
        if (stitched[y * gridW + x] <= 0) { x++; continue; }
        var start = x;
        while (x < gridW && stitched[y * gridW + x] > 0) x++;
        // start..x-1 が1本の短い渡り（既に FLOAT_MAX 以下に分解済み）
        drawStitch(ctx, pad, start, x - start, y, cellW, cellH, stitched, gridW, numLevels, style);
      }
    }

    var stitchedCount = 0;
    for (var i = 0; i < stitched.length; i++) if (stitched[i] > 0) stitchedCount++;

    return {
      width: W, height: H, cellW: cellW, cellH: cellH,
      violations: violations, stitchedCells: stitchedCount
    };
  }

  /* 1本の短い渡り（run: start..start+len-1, len<=FLOAT_MAX）を描く。
     styleに関わらず、渡りは横に連続した1本の刺し目として描く（実際の渡り糸の見え）。
     levelで糸の太さ(濃淡)を変える。fillは太め、dashはやや細め＋端を丸める。 */
  function drawStitch(ctx, pad, start, len, y, cw, ch, stitched, gridW, numLevels, style) {
    // このrunの代表level（先頭セル）で太さを決める
    var lv = stitched[y * gridW + start];
    var ratio = (numLevels > 1) ? lv / (numLevels - 1) : 1;

    var x0 = pad + start * cw;
    var runW = len * cw;

    // 糸の太さ（縦幅）
    var thBase = (style === 'fill') ? 0.62 : 0.42;
    var th = Math.max(2, ch * (thBase + 0.22 * ratio));
    var yc = pad + y * ch + ch / 2 - th / 2;

    // 渡りは升目にまたがる連続バー。端に少し余白を入れて隣の渡りと分離を見せる。
    var inset = Math.min(cw * 0.14, 3);
    var bx = Math.round(x0 + inset);
    var bw = Math.round(runW - inset * 2);
    if (bw < 2) bw = 2;
    ctx.fillRect(bx, Math.round(yc), bw, Math.round(th));
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  global.KoginRender = {
    render: render,
    verifyFloats: verifyFloats,
    buildStitchMap: buildStitchMap,
    splitRun: splitRun,
    FLOAT_MAX: FLOAT_MAX,
    COLORS: COLORS
  };
})(typeof window !== 'undefined' ? window : this);
