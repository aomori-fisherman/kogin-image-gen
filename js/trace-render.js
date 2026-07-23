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

  // 1行から多色ランを抽出（render 内で完結・validate 非依存）
  function rowRuns(row) {
    var runs = [], x = 0, n = row.length;
    while (x < n) {
      var c = row[x];
      if (c == null) { x++; continue; }
      var s = x;
      while (x < n && row[x] === c) x++;
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
    var fab = lookup(fabrics, doc.fabricId) || { hex: '#1B2440' };
    var dark = hexLum(fab.hex) < 0.5;
    var baseLine = dark ? '255,255,255' : '30,40,60';
    var gOp = (view.gridOpacity != null) ? view.gridOpacity : 0.18;

    var out = [];
    out.push('<g style="pointer-events:none">');

    // 背景（地色）
    out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + fab.hex + '"/>');

    // 下絵（グリッドの下・cells の下）
    if (doc.underlay && doc.underlay.dataURL) {
      var u = doc.underlay;
      var dw = (u.w || 0) * (u.scale || 1), dh = (u.h || 0) * (u.scale || 1);
      var ux = PAD + (u.x || 0), uy = PAD + (u.y || 0);
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

    // cells（ラン=横バー）
    var inset = Math.min(cw * 0.14, 2.5);
    var barH = Math.max(2, ch * 0.62);
    for (var y = 0; y < h; y++) {
      var runs = rowRuns(doc.cells[y]);
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
