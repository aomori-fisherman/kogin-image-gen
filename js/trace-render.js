/* trace-render.js
   こぎんトレース台エディタ T0 — cells 等 → SVG レイヤ文字列。
   ★ SVG 要素は app 側で1度だけ生成し、以降は innerHTML と width/height/viewBox のみ更新する（§9.1）。
   ここは「中身の文字列」と寸法を返すだけ（DOM を新規生成しない）。
   ブラウザ専用（window.TraceRender）。 */
(function () {
  'use strict';

  var PAD = 26; // 座標数字の余白（純描画上の定数・未確定値ではない）

  function hexLum(hex) {
    if (!hex) return 0;
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function lookup(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function brkSet(breaksRow) {
    if (!breaksRow || !breaksRow.length) return null;
    var s = {}; for (var i = 0; i < breaksRow.length; i++) s[breaksRow[i]] = 1; return s;
  }

  // 1行から多色ランを抽出（render 内で完結・validate 非依存）。
  // breaksRow を渡すと切れ目でランを分割し、バーを分けて描く。
  function rowRuns(row, breaksRow) {
    var brk = brkSet(breaksRow);
    var runs = [], x = 0, n = row.length;
    while (x < n) {
      var c = row[x];
      if (c == null) { x++; continue; }
      var s = x;
      x++;
      while (x < n && row[x] === c && !(brk && brk[x])) x++;
      runs.push({ start: s, len: x - s, colorId: c });
    }
    return runs;
  }

  function cellAt(view, sx, sy) {
    var cw = view.cellW, ch = view.cellH;
    return { x: Math.floor((sx - PAD) / cw), y: Math.floor((sy - PAD) / ch) };
  }

  function build(doc, view) {
    var w = doc.grid.w, h = doc.grid.h;
    var cw = view.cellW, ch = view.cellH;
    var W = PAD * 2 + w * cw, H = PAD * 2 + h * ch;
    var palette = view.palette || [];
    var fabrics = view.fabrics || [];
    // R9: 地布は view.fabricHex（app が TraceState.fabricHexOf で解決＝自由色対応）を優先。
    //     未指定なら従来どおり FABRICS からプリセットを引く（後方互換）。
    var fab = { hex: view.fabricHex || (lookup(fabrics, doc.fabricId) || {}).hex || '#1B2440' };
    var dark = hexLum(fab.hex) < 0.5;
    var baseLine = dark ? '255,255,255' : '30,40,60';
    var gOp = (view.gridOpacity != null) ? view.gridOpacity : 0.18;

    var out = [];
    out.push('<g style="pointer-events:none">');

    // 背景（地色）
    out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + fab.hex + '"/>');

    // 下絵（グリッドの下・cells の下）
    // #13 ズーム一体化: ジオメトリ(x/y/scale)は zoom非依存の world単位で保持し、描画時に係数
    //   uf=zoom/ZREF で一律スケール（グリッドと同率・同中心で拡縮＝相対位置/スケールが固定）。
    //   uf 省略時は 1（後方互換・zoom=ZREF と同じ描画）。
    // #14 表示トグル: view.hideUnderlay が真なら描画をスキップ（データは doc に保持）。
    if (doc.underlay && doc.underlay.dataURL && !view.hideUnderlay) {
      var u = doc.underlay;
      var uf = (view.uf != null) ? view.uf : 1;
      var dw = (u.w || 0) * (u.scale || 1) * uf, dh = (u.h || 0) * (u.scale || 1) * uf;
      var ux = PAD + (u.x || 0) * uf, uy = PAD + (u.y || 0) * uf;
      var cx = ux + dw / 2, cy = uy + dh / 2;
      var filt = u.grayscale ? 'filter:grayscale(1);' : '';
      out.push('<image href="' + u.dataURL + '" x="' + ux + '" y="' + uy + '" width="' + dw + '" height="' + dh +
        '" opacity="' + (u.opacity != null ? u.opacity : 0.5) + '" transform="rotate(' + (u.rotateDeg || 0) + ' ' + cx + ' ' + cy + ')" ' +
        'preserveAspectRatio="none" style="' + filt + '"/>');
    }

    // グリッド線
    if (view.showGrid !== false) {
      var gx, gy, px, py;
      for (gx = 0; gx <= w; gx++) {
        var strong5 = view.show5 !== false && gx % 5 === 0;
        var op = strong5 ? Math.min(1, gOp * 2.4) : gOp;
        var sw = strong5 ? 1.4 : 1;
        px = PAD + gx * cw;
        out.push('<line x1="' + px + '" y1="' + PAD + '" x2="' + px + '" y2="' + (PAD + h * ch) +
          '" stroke="rgba(' + baseLine + ',' + op.toFixed(3) + ')" stroke-width="' + sw + '"/>');
      }
      for (gy = 0; gy <= h; gy++) {
        var strong5b = view.show5 !== false && gy % 5 === 0;
        var opb = strong5b ? Math.min(1, gOp * 2.4) : gOp;
        var swb = strong5b ? 1.4 : 1;
        py = PAD + gy * ch;
        out.push('<line x1="' + PAD + '" y1="' + py + '" x2="' + (PAD + w * cw) + '" y2="' + py +
          '" stroke="rgba(' + baseLine + ',' + opb.toFixed(3) + ')" stroke-width="' + swb + '"/>');
      }
    }

    // 中心線（十字・破線）
    if (view.showCenter) {
      var mx = PAD + (w / 2) * cw, my = PAD + (h / 2) * ch;
      var cLine = 'stroke="rgba(' + baseLine + ',0.5)" stroke-width="1" stroke-dasharray="4 4"';
      out.push('<line x1="' + mx + '" y1="' + PAD + '" x2="' + mx + '" y2="' + (PAD + h * ch) + '" ' + cLine + '/>');
      out.push('<line x1="' + PAD + '" y1="' + my + '" x2="' + (PAD + w * cw) + '" y2="' + my + '" ' + cLine + '/>');
    }

    // 座標数字（5目ごと）
    var lblCol = 'rgba(' + baseLine + ',0.75)';
    for (var lx = 0; lx <= w; lx += 5) {
      out.push('<text x="' + (PAD + lx * cw) + '" y="' + (PAD - 8) + '" font-size="9" text-anchor="middle" fill="' + lblCol + '">' + lx + '</text>');
    }
    for (var ly = 0; ly <= h; ly += 5) {
      out.push('<text x="' + (PAD - 6) + '" y="' + (PAD + ly * ch + 3) + '" font-size="9" text-anchor="end" fill="' + lblCol + '">' + ly + '</text>');
    }

    // cells（ラン=横バー）。切れ目がある行は rowRuns がバーを分割する。
    var breaks = doc.breaks || null;
    var inset = Math.min(cw * 0.14, 2.5);
    var barH = Math.max(2, ch * 0.62);
    for (var y = 0; y < h; y++) {
      var brow = breaks ? breaks[y] : null;
      var runs = rowRuns(doc.cells[y], brow);
      for (var r = 0; r < runs.length; r++) {
        var run = runs[r];
        var pcol = lookup(palette, run.colorId);
        var fill = pcol ? pcol.hex : '#cccccc';
        var bx = PAD + run.start * cw + inset;
        var bw = run.len * cw - inset * 2; if (bw < 2) bw = 2;
        var by = PAD + y * ch + (ch - barH) / 2;
        var rx = Math.min(barH / 2, cw / 2);
        out.push('<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + barH.toFixed(1) +
          '" rx="' + rx.toFixed(1) + '" fill="' + fill + '"/>');
      }
    }

    // 切れ目マーカー（同色ランを分ける明示的な仕切り。セル境界に短い縦線）
    if (breaks) {
      for (var byk in breaks) if (Object.prototype.hasOwnProperty.call(breaks, byk)) {
        var yy = +byk; if (yy < 0 || yy >= h) continue;
        var bxs = breaks[byk];
        for (var bi = 0; bi < bxs.length; bi++) {
          var xEdge = bxs[bi]; if (xEdge < 1 || xEdge > w - 1) continue;
          var lineX = PAD + xEdge * cw;
          var y0 = PAD + yy * ch + ch * 0.12, y1 = PAD + (yy + 1) * ch - ch * 0.12;
          out.push('<line x1="' + lineX.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + lineX.toFixed(1) + '" y2="' + y1.toFixed(1) +
            '" stroke="#0E1116" stroke-width="3" stroke-linecap="round"/>');
          out.push('<line x1="' + lineX.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + lineX.toFixed(1) + '" y2="' + y1.toFixed(1) +
            '" stroke="#E3A93D" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2"/>');
        }
      }
    }

    // 偶数ラン下線（黄・参考）
    if (view.evenRuns && view.evenRuns.length) {
      for (var e = 0; e < view.evenRuns.length; e++) {
        var er = view.evenRuns[e];
        var ex = PAD + er.start * cw, ey = PAD + (er.y + 1) * ch - 1.5;
        out.push('<line x1="' + ex + '" y1="' + ey + '" x2="' + (ex + er.len * cw) + '" y2="' + ey + '" stroke="#E3C24A" stroke-width="1.6"/>');
      }
    }

    // float 違反（赤枠）
    if (view.violations && view.violations.length) {
      for (var v = 0; v < view.violations.length; v++) {
        var vi = view.violations[v];
        out.push('<rect x="' + (PAD + vi.start * cw) + '" y="' + (PAD + vi.y * ch) + '" width="' + (vi.len * cw) + '" height="' + ch +
          '" fill="none" stroke="#E23B3B" stroke-width="2"/>');
      }
    }

    // 選択ラン（強調枠）
    if (view.selection) {
      var s = view.selection;
      out.push('<rect x="' + (PAD + s.start * cw) + '" y="' + (PAD + s.y * ch) + '" width="' + (s.len * cw) + '" height="' + ch +
        '" fill="rgba(79,176,198,0.18)" stroke="#4FB0C6" stroke-width="2"/>');
    }

    // ゴースト（ペン/斜線/連続ペースト プレビュー）
    if (view.ghostCells && view.ghostCells.length) {
      var gcol = view.ghostColor || '#4FB0C6';
      for (var gI = 0; gI < view.ghostCells.length; gI++) {
        var gc = view.ghostCells[gI];
        if (gc.x < 0 || gc.x >= w || gc.y < 0 || gc.y >= h) continue;
        out.push('<rect x="' + (PAD + gc.x * cw) + '" y="' + (PAD + gc.y * ch) + '" width="' + cw + '" height="' + ch +
          '" fill="' + gcol + '" opacity="0.45"/>');
      }
    }

    // ホバーセル（ペン/消しゴムの「今どこに塗る/消すか」・#12）
    if (view.hoverCell) {
      var hc = view.hoverCell;
      if (hc.x >= 0 && hc.x < w && hc.y >= 0 && hc.y < h) {
        var hx = PAD + hc.x * cw, hy = PAD + hc.y * ch;
        var hStroke = hc.kind === 'eraser' ? '#E23B3B' : '#FFFFFF';
        var hFill = hc.kind === 'eraser' ? 'rgba(226,59,59,0.10)' : 'rgba(255,255,255,0.10)';
        out.push('<rect x="' + hx.toFixed(1) + '" y="' + hy.toFixed(1) + '" width="' + cw + '" height="' + ch +
          '" fill="' + hFill + '" stroke="' + hStroke + '" stroke-width="1.5" opacity="0.85"/>');
      }
    }

    // マーキー（矩形選択）
    if (view.marquee) {
      var m = view.marquee;
      var mlo = Math.min(m.x0, m.x1), mhi = Math.max(m.x0, m.x1);
      var mto = Math.min(m.y0, m.y1), mbo = Math.max(m.y0, m.y1);
      out.push('<rect x="' + (PAD + mlo * cw) + '" y="' + (PAD + mto * ch) + '" width="' + ((mhi - mlo + 1) * cw) + '" height="' + ((mbo - mto + 1) * ch) +
        '" fill="rgba(227,169,61,0.15)" stroke="#E3A93D" stroke-width="1.5" stroke-dasharray="5 3"/>');
    }

    out.push('</g>');
    return { innerHTML: out.join(''), width: W, height: H, viewBox: '0 0 ' + W + ' ' + H };
  }

  window.TraceRender = { build: build, cellAt: cellAt, PAD: PAD, esc: esc, hexLum: hexLum };
})();
