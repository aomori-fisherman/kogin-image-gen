/* kogin-render.js
   level行列（0..levels-1）を「こぎん風チャート」としてcanvasに描画する。
   決定論。厳密なこぎん文法（モドコ・奇数目・裏渡り制約）はv2。
   MVPは「藍地×白糸の横流れ刺し目 or 升目塗り」で"それっぽい"格子刺しに寄せる。 */

(function (global) {
  'use strict';

  var COLORS = {
    ground: '#1b2a4a',   // 藍地
    thread: '#eef2f5',   // 白糸
    grid: 'rgba(255,255,255,0.10)',
    gridStrong: 'rgba(255,255,255,0.22)'
  };

  /**
   * こぎんチャートを描画。
   * @param {HTMLCanvasElement} canvas
   * @param {Uint8Array} levels level行列(row-major)
   * @param {number} gridW
   * @param {number} gridH
   * @param {object} opts {numLevels, style:'dash'|'fill', showGrid, cellPx}
   */
  function render(canvas, levels, gridW, gridH, opts) {
    opts = opts || {};
    var numLevels = opts.numLevels || 3;
    var style = opts.style || 'dash';
    var showGrid = opts.showGrid !== false;

    // セルは横長（こぎんの刺し目＝横に長い升目）: 横:縦 = 3:2 目安
    var cellW = opts.cellW || 14;
    var cellH = opts.cellH || Math.round(cellW * 0.66);
    if (cellH < 4) cellH = 4;

    var pad = opts.pad != null ? opts.pad : 16;
    var W = gridW * cellW + pad * 2;
    var H = gridH * cellH + pad * 2;
    canvas.width = W;
    canvas.height = H;

    var ctx = canvas.getContext('2d');
    // 藍地
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, W, H);

    // 格子線
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

    // 刺し目描画
    ctx.fillStyle = COLORS.thread;
    for (var y = 0; y < gridH; y++) {
      for (var x = 0; x < gridW; x++) {
        var lv = levels[y * gridW + x];
        if (lv <= 0) continue; // level0=非刺し
        var cx = pad + x * cellW;
        var cy = pad + y * cellH;
        if (style === 'fill') {
          drawFill(ctx, cx, cy, cellW, cellH, lv, numLevels);
        } else {
          drawDash(ctx, cx, cy, cellW, cellH, lv, numLevels, x, y);
        }
      }
    }

    return { width: W, height: H, cellW: cellW, cellH: cellH };
  }

  /* 升目の塗り：段階に応じて塗り面積（濃淡）を変える。 */
  function drawFill(ctx, cx, cy, cw, ch, lv, numLevels) {
    var ratio = lv / (numLevels - 1); // 0..1
    var inset = (1 - ratio) * Math.min(cw, ch) * 0.35;
    ctx.globalAlpha = 0.55 + 0.45 * ratio;
    ctx.fillRect(cx + inset, cy + inset, cw - inset * 2, ch - inset * 2);
    ctx.globalAlpha = 1;
  }

  /* 横流れ刺し：こぎんは糸が水平に走る。段階で刺し目の「長さ・本数」を変える。
     level低=短いダッシュ1本、level高=横いっぱいに近い刺し。
     隣接セルで連続させ、格子上の横ステッチ感を出す。 */
  function drawDash(ctx, cx, cy, cw, ch, lv, numLevels, gx, gy) {
    var ratio = lv / (numLevels - 1); // 0..1
    // 刺し目の縦幅（糸の太さ）
    var th = Math.max(2, ch * (0.42 + 0.20 * ratio));
    var yc = cy + ch / 2 - th / 2;

    // 刺し目の横の長さ：ratioが大きいほどセル幅いっぱい、小さいと中央に短く。
    var len = cw * (0.45 + 0.55 * ratio);
    var xStart = cx + (cw - len) / 2;

    // 濃い段階(最大)は上下にもう1本走らせて "総刺し風" の密度を出す
    ctx.fillRect(Math.round(xStart), Math.round(yc), Math.round(len), Math.round(th));
    if (ratio >= 0.99) {
      var th2 = Math.max(1.5, ch * 0.22);
      ctx.fillRect(Math.round(cx), Math.round(cy + ch * 0.08), Math.round(cw), Math.round(th2));
      ctx.fillRect(Math.round(cx), Math.round(cy + ch - ch * 0.08 - th2), Math.round(cw), Math.round(th2));
    }
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  global.KoginRender = { render: render, COLORS: COLORS };
})(window);
