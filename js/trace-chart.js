/* trace-chart.js
   こぎんトレース台エディタ T0 — チャート紙面（記号グリッド＋凡例＋注記）を1枚のSVGで生成し、
   印刷（window.print）と PNG 書き出しに共用する。
   記法は仮（ハート現行記法の確認後に差し替え）。CC BY は T0 では不要（モドコ不使用）。
   ブラウザ専用（window.TraceChart）。 */
(function () {
  'use strict';

  var CELL = 14;      // チャート1目のpx（印刷はCSSで用紙に合わせて縮尺）
  var MX = 34, MY = 64; // グリッド左上マージン（座標数字・タイトル分）

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lookup(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }

  // 使用色に PALETTE 順で記号を割当
  function assignSymbols(doc, vr, cfg) {
    var used = [];
    var k = 0;
    for (var i = 0; i < cfg.PALETTE.length; i++) {
      var p = cfg.PALETTE[i];
      if (vr.perColor[p.id] != null) {
        used.push({
          colorId: p.id, symbol: cfg.CHART_SYMBOLS[k % cfg.CHART_SYMBOLS.length],
          name: p.name, code: p.code || '', hex: p.hex, count: vr.perColor[p.id]
        });
        k++;
      }
    }
    return used;
  }

  // 1枚のチャートSVG文字列と付随情報を返す
  function buildChartSVG(doc, vr, cfg) {
    var w = doc.grid.w, h = doc.grid.h;
    var used = assignSymbols(doc, vr, cfg);
    var symById = {};
    for (var u = 0; u < used.length; u++) symById[used[u].colorId] = used[u].symbol;

    var gridW = w * CELL, gridH = h * CELL;
    var legendTop = MY + gridH + 28;
    var legendRowH = 22;
    var legendH = 22 + Math.max(1, used.length) * legendRowH;
    var notesTop = legendTop + legendH + 14;
    var W = Math.max(MX + gridW + 20, 460);
    var H = notesTop + 52;

    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="sans-serif">');
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>');

    // タイトル
    var date = new Date().toLocaleDateString('ja-JP');
    s.push('<text x="' + MX + '" y="26" font-size="16" font-weight="bold" fill="#111">こぎんチャート（記法は仮）</text>');
    s.push('<text x="' + MX + '" y="46" font-size="11" fill="#444">' +
      w + '×' + h + '目 ／ セル縦横比 ' + (doc.grid.cellAspect) + '（仮・要実測） ／ ' + esc(date) + '</text>');

    // グリッド線・5目太罫
    var gx, gy, px, py;
    for (gx = 0; gx <= w; gx++) {
      px = MX + gx * CELL;
      var st = (gx % 5 === 0);
      s.push('<line x1="' + px + '" y1="' + MY + '" x2="' + px + '" y2="' + (MY + gridH) + '" stroke="' + (st ? '#333' : '#c8c8c8') + '" stroke-width="' + (st ? 1.2 : 0.6) + '"/>');
    }
    for (gy = 0; gy <= h; gy++) {
      py = MY + gy * CELL;
      var sth = (gy % 5 === 0);
      s.push('<line x1="' + MX + '" y1="' + py + '" x2="' + (MX + gridW) + '" y2="' + py + '" stroke="' + (sth ? '#333' : '#c8c8c8') + '" stroke-width="' + (sth ? 1.2 : 0.6) + '"/>');
    }
    // 中心線
    var mx = MX + (w / 2) * CELL, my = MY + (h / 2) * CELL;
    s.push('<line x1="' + mx + '" y1="' + MY + '" x2="' + mx + '" y2="' + (MY + gridH) + '" stroke="#4FB0C6" stroke-width="0.8" stroke-dasharray="4 3"/>');
    s.push('<line x1="' + MX + '" y1="' + my + '" x2="' + (MX + gridW) + '" y2="' + my + '" stroke="#4FB0C6" stroke-width="0.8" stroke-dasharray="4 3"/>');
    // 座標数字（5目ごと）
    for (var lx = 0; lx <= w; lx += 5) s.push('<text x="' + (MX + lx * CELL) + '" y="' + (MY - 4) + '" font-size="8" text-anchor="middle" fill="#666">' + lx + '</text>');
    for (var ly = 0; ly <= h; ly += 5) s.push('<text x="' + (MX - 4) + '" y="' + (MY + ly * CELL + 3) + '" font-size="8" text-anchor="end" fill="#666">' + ly + '</text>');

    // 記号セル
    var symbolCellCount = 0;
    for (var y = 0; y < h; y++) {
      var row = doc.cells[y];
      for (var x = 0; x < w; x++) {
        var c = row[x];
        if (c == null) continue;
        var sym = symById[c] || '?';
        s.push('<text class="chart-symbol" x="' + (MX + x * CELL + CELL / 2) + '" y="' + (MY + y * CELL + CELL / 2 + 4) + '" font-size="' + (CELL - 2) + '" text-anchor="middle" fill="#111">' + esc(sym) + '</text>');
        symbolCellCount++;
      }
    }

    // 凡例
    s.push('<text x="' + MX + '" y="' + (legendTop) + '" font-size="12" font-weight="bold" fill="#111">凡例（記号 / 色 / 名称 / 糸番号(仮) / 目数）</text>');
    for (var i = 0; i < used.length; i++) {
      var it = used[i];
      var ry = legendTop + 14 + i * legendRowH;
      s.push('<g class="legend-row">');
      s.push('<text x="' + (MX + 4) + '" y="' + (ry + 12) + '" font-size="13" fill="#111">' + esc(it.symbol) + '</text>');
      s.push('<rect x="' + (MX + 30) + '" y="' + (ry) + '" width="16" height="14" fill="' + it.hex + '" stroke="#888"/>');
      s.push('<text x="' + (MX + 54) + '" y="' + (ry + 12) + '" font-size="11" fill="#222">' + esc(it.name) + '　' + esc(it.code) + '　' + it.count + '目</text>');
      s.push('</g>');
    }
    if (!used.length) s.push('<text x="' + (MX + 4) + '" y="' + (legendTop + 26) + '" font-size="11" fill="#888">（まだ刺し目がありません）</text>');

    // 注記2行
    s.push('<text x="' + MX + '" y="' + (notesTop + 14) + '" font-size="10" fill="#777">※ 記法は仮＝ハート現行記法の確認後に差し替え。</text>');
    s.push('<text x="' + MX + '" y="' + (notesTop + 30) + '" font-size="10" fill="#777">※ 偶数ラン ' + vr.evenRuns.length + ' 箇所あり・様式判断は作り手（奇数目が伝統則とされる／確認中）。</text>');

    s.push('</svg>');
    return { svgString: s.join(''), width: W, height: H, usedColors: used, symbolCellCount: symbolCellCount };
  }

  // 画面にオーバーレイして印刷
  function open(doc, vr, cfg) {
    var built = buildChartSVG(doc, vr, cfg);
    var ov = document.getElementById('trace-chart-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'trace-chart-overlay';
      document.body.appendChild(ov);
    }
    ov.innerHTML =
      '<div class="tco-bar">' +
        '<button id="tco-print" class="btn-primary">印刷</button>' +
        '<button id="tco-png" class="btn-small">PNG保存</button>' +
        '<button id="tco-close" class="btn-small">閉じる</button>' +
      '</div>' +
      '<div class="tco-sheet">' + built.svgString + '</div>';
    ov.style.display = 'block';
    document.getElementById('tco-close').onclick = function () { ov.style.display = 'none'; };
    document.getElementById('tco-print').onclick = function () { window.print(); };
    document.getElementById('tco-png').onclick = function () { exportPNG(doc, vr, cfg); };
    return built;
  }

  // チャートSVG → PNG ダウンロード
  function exportPNG(doc, vr, cfg) {
    var built = buildChartSVG(doc, vr, cfg);
    var svg = built.svgString;
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var scale = 2; // 高精細
      var canvas = document.createElement('canvas');
      canvas.width = built.width * scale;
      canvas.height = built.height * scale;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      var png = canvas.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = png;
      a.download = 'kogin-chart-' + stamp() + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };
    img.onerror = function () { URL.revokeObjectURL(url); alert('PNG書き出しに失敗しました'); };
    img.src = url;
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  window.TraceChart = { buildChartSVG: buildChartSVG, open: open, exportPNG: exportPNG };
})();
