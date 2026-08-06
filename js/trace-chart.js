/* trace-chart.js
   こぎんトレース台エディタ T0 — チャート紙面（記号グリッド＋凡例＋注記）を1枚のSVGで生成し、
   印刷（window.print）と PNG 書き出しに共用する。
   記法は仮（ハート現行記法の確認後に差し替え）。CC BY は T0 では不要（モドコ不使用）。
   ブラウザ専用（window.TraceChart）。 */
(function () {
  'use strict';

  var CELL = 14;      // チャート1目のpx（印刷はCSSで用紙に合わせて縮尺）
  var MX = 34, MY = 64; // グリッド左上マージン（座標数字・タイトル分）

  // 方眼の3階層（池田さんFB 2026-08-06「印刷のマス目が細かく出すぎる」）。
  // こぎん方眼の通例＝毎目は薄い細線・5目ごとに中太・10目ごと（と外枠）は太線。
  // class は @media print 側で紙用に微調整するためのフック
  // （CSSルールは SVG の presentation attribute を上書きできる＝attr は画面/PNG用の既定値になる）。
  var GRID_TIERS = {
    1:  { cls: 'cg-thin', stroke: '#d9d9d9', w: 0.4 },
    5:  { cls: 'cg-5',    stroke: '#8c8c8c', w: 0.9 },
    10: { cls: 'cg-10',   stroke: '#1f1f1f', w: 1.6 }
  };
  var TIER_ORDER = [1, 5, 10];   // 薄→濃の順に描いて太線を上に重ねる

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lookup(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }

  // i 本目の罫線の階層（0本目と最終本＝外枠は太線）
  function lineTier(i, n) {
    if (i === 0 || i === n || i % 10 === 0) return 10;
    return (i % 5 === 0) ? 5 : 1;
  }

  // 糸色の明るさ（0〜1）。記号の色を白/黒どちらにするかの判定に使う。
  function lum(hex) {
    if (!hex) return 0;
    var s = String(hex).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var r = parseInt(s.substr(0, 2), 16), g = parseInt(s.substr(2, 2), 16), b = parseInt(s.substr(4, 2), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 0;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function symbolInk(hex) { return lum(hex) < 0.55 ? '#ffffff' : '#111111'; }

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
  // opts.color=true（既定）… 刺し目を糸色で塗る＝カラー印刷用（池田さんFB 2026-08-06）。
  //   記号は色の上に残す（白黒コピー・モノクロ機でも判別できるように）。
  //   opts.color=false で従来の記号のみ（白黒）チャート。
  function buildChartSVG(doc, vr, cfg, opts) {
    var colorMode = !(opts && opts.color === false);
    var w = doc.grid.w, h = doc.grid.h;
    var used = assignSymbols(doc, vr, cfg);
    var symById = {}, hexById = {};
    for (var u = 0; u < used.length; u++) { symById[used[u].colorId] = used[u].symbol; hexById[used[u].colorId] = used[u].hex; }

    var gridW = w * CELL, gridH = h * CELL;
    var legendTop = MY + gridH + 28;
    var legendRowH = 22;
    var legendH = 22 + Math.max(1, used.length) * legendRowH;
    var notesTop = legendTop + legendH + 14;
    var W = Math.max(MX + gridW + 20, 460);
    var H = notesTop + 68;   // 注記3行分

    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="sans-serif">');
    s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>');

    // タイトル
    var date = new Date().toLocaleDateString('ja-JP');
    s.push('<text x="' + MX + '" y="26" font-size="16" font-weight="bold" fill="#111">こぎんチャート（記法は仮）</text>');
    s.push('<text x="' + MX + '" y="46" font-size="11" fill="#444">' +
      w + '×' + h + '目 ／ セル縦横比 ' + (doc.grid.cellAspect) + '（仮・要実測） ／ ' +
      (colorMode ? 'カラー（糸色）' : '記号のみ（白黒）') + ' ／ ' + esc(date) + '</text>');

    // 刺し目の色塗り（カラーモード）— 方眼線より先に置いて、罫線が色の上に見えるようにする。
    var colorCellCount = 0;
    if (colorMode) {
      for (var cy = 0; cy < h; cy++) {
        var crow = doc.cells[cy];
        for (var cx = 0; cx < w; cx++) {
          var cid = crow[cx];
          if (cid == null) continue;
          var chex = hexById[cid] || '#cccccc';
          // 薄い糸色（白・生成）が白い紙に埋もれないよう、セルに淡い輪郭を付ける
          s.push('<rect class="chart-cell" x="' + (MX + cx * CELL) + '" y="' + (MY + cy * CELL) +
            '" width="' + CELL + '" height="' + CELL + '" fill="' + chex +
            '" stroke="rgba(0,0,0,0.18)" stroke-width="0.5"/>');
          colorCellCount++;
        }
      }
    }

    // グリッド線（3階層: 毎目=薄い細線 / 5目=中太 / 10目・外枠=太線）
    var gx, gy, px, py, t, tv;
    for (t = 0; t < TIER_ORDER.length; t++) {
      tv = GRID_TIERS[TIER_ORDER[t]];
      for (gx = 0; gx <= w; gx++) {
        if (lineTier(gx, w) !== TIER_ORDER[t]) continue;
        px = MX + gx * CELL;
        s.push('<line class="' + tv.cls + '" x1="' + px + '" y1="' + MY + '" x2="' + px + '" y2="' + (MY + gridH) +
          '" stroke="' + tv.stroke + '" stroke-width="' + tv.w + '"/>');
      }
      for (gy = 0; gy <= h; gy++) {
        if (lineTier(gy, h) !== TIER_ORDER[t]) continue;
        py = MY + gy * CELL;
        s.push('<line class="' + tv.cls + '" x1="' + MX + '" y1="' + py + '" x2="' + (MX + gridW) + '" y2="' + py +
          '" stroke="' + tv.stroke + '" stroke-width="' + tv.w + '"/>');
      }
    }
    // 中心線
    var mx = MX + (w / 2) * CELL, my = MY + (h / 2) * CELL;
    s.push('<line x1="' + mx + '" y1="' + MY + '" x2="' + mx + '" y2="' + (MY + gridH) + '" stroke="#4FB0C6" stroke-width="0.8" stroke-dasharray="4 3"/>');
    s.push('<line x1="' + MX + '" y1="' + my + '" x2="' + (MX + gridW) + '" y2="' + my + '" stroke="#4FB0C6" stroke-width="0.8" stroke-dasharray="4 3"/>');
    // 座標数字（5目ごと）
    for (var lx = 0; lx <= w; lx += 5) s.push('<text x="' + (MX + lx * CELL) + '" y="' + (MY - 4) + '" font-size="8" text-anchor="middle" fill="#666">' + lx + '</text>');
    for (var ly = 0; ly <= h; ly += 5) s.push('<text x="' + (MX - 4) + '" y="' + (MY + ly * CELL + 3) + '" font-size="8" text-anchor="end" fill="#666">' + ly + '</text>');

    // 記号セル（白黒モードのみ）。
    // ★ カラー時は記号を一切描かない（伎海FB 2026-08-06 R8「糸の色を記号の形で表現していて見づらい」）。
    //   色そのものが糸の識別子なので、記号は色を邪魔するノイズにしかならない。
    //   記号が要るのは「色が出せない白黒印刷」だけ＝そこでは唯一の識別手段なので従来どおり出す。
    var symFS = CELL - 2;
    var symDY = 4;
    var symbolCellCount = 0;
    if (!colorMode) {
      for (var y = 0; y < h; y++) {
        var row = doc.cells[y];
        for (var x = 0; x < w; x++) {
          var c = row[x];
          if (c == null) continue;
          var sym = symById[c] || '?';
          s.push('<text class="chart-symbol" x="' + (MX + x * CELL + CELL / 2) + '" y="' + (MY + y * CELL + CELL / 2 + symDY) + '" font-size="' + symFS + '" text-anchor="middle" fill="#111">' + esc(sym) + '</text>');
          symbolCellCount++;
        }
      }
    }

    // 凡例（カラー時は記号列を出さない＝紙面に記号が無いため）
    s.push('<text x="' + MX + '" y="' + (legendTop) + '" font-size="12" font-weight="bold" fill="#111">' +
      (colorMode ? '凡例（色 / 名称 / 糸番号(仮) / 目数）' : '凡例（記号 / 色 / 名称 / 糸番号(仮) / 目数）') + '</text>');
    for (var i = 0; i < used.length; i++) {
      var it = used[i];
      var ry = legendTop + 14 + i * legendRowH;
      s.push('<g class="legend-row">');
      if (!colorMode) s.push('<text x="' + (MX + 4) + '" y="' + (ry + 12) + '" font-size="13" fill="#111">' + esc(it.symbol) + '</text>');
      s.push('<rect class="legend-swatch" x="' + (MX + (colorMode ? 4 : 30)) + '" y="' + (ry) + '" width="' + (colorMode ? 26 : 16) + '" height="14" fill="' + it.hex + '" stroke="#888"/>');
      s.push('<text x="' + (MX + 54) + '" y="' + (ry + 12) + '" font-size="11" fill="#222">' + esc(it.name) + '　' + esc(it.code) + '　' + it.count + '目</text>');
      s.push('</g>');
    }
    if (!used.length) s.push('<text x="' + (MX + 4) + '" y="' + (legendTop + 26) + '" font-size="11" fill="#888">（まだ刺し目がありません）</text>');

    // 注記3行
    s.push('<text x="' + MX + '" y="' + (notesTop + 14) + '" font-size="10" fill="#777">※ 記法は仮＝ハート現行記法の確認後に差し替え。</text>');
    s.push('<text x="' + MX + '" y="' + (notesTop + 30) + '" font-size="10" fill="#777">※ 偶数ラン ' + vr.evenRuns.length + ' 箇所あり・様式判断は作り手（奇数目が伝統則とされる／確認中）。</text>');
    s.push('<text x="' + MX + '" y="' + (notesTop + 46) + '" font-size="10" fill="#777">※ ' +
      (colorMode
        ? 'マスの色がそのまま糸の色です（記号は使いません）。太い罫線は10目ごと・中太は5目ごと。'
        : '白黒（記号）で印刷。色は記号で表します。カラーで刷るときは印刷画面の「白黒（記号だけ）で印刷する」のチェックを外してください。') + '</text>');

    s.push('</svg>');
    return {
      svgString: s.join(''), width: W, height: H, usedColors: used,
      symbolCellCount: symbolCellCount, colorCellCount: colorCellCount, colorMode: colorMode
    };
  }

  // 画面にオーバーレイして印刷
  // 印刷用の紙面はこのオーバーレイをそのまま刷る（@media print で他を隠す）＝画面プレビュー＝紙面。
  function open(doc, vr, cfg, opts) {
    var state = { color: !(opts && opts.color === false) };
    var built = buildChartSVG(doc, vr, cfg, state);
    var ov = document.getElementById('trace-chart-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'trace-chart-overlay';
      document.body.appendChild(ov);
    }
    // ★ 既定はカラー。白黒は「オプトアウト」側に置く（チェックを探させないと色が出ない設計にしない・R8）。
    ov.innerHTML =
      '<div class="tco-bar">' +
        '<span class="tco-mode">糸の色そのままカラーで印刷します</span>' +
        '<label class="tco-check" title="チェックを入れると、色を使わず記号だけの白黒チャートになります（モノクロ機・コピー用）">' +
          '<input type="checkbox" id="tco-mono"' + (state.color ? '' : ' checked') + '> 白黒（記号だけ）で印刷する' +
        '</label>' +
        '<button id="tco-print" class="btn-primary">印刷</button>' +
        '<button id="tco-png" class="btn-small">PNG保存</button>' +
        '<button id="tco-close" class="btn-small">閉じる</button>' +
      '</div>' +
      '<div class="tco-sheet">' + built.svgString + '</div>' +
      '<p class="tco-tip">色が出ない時は、プリンタ側の設定が「白黒／グレースケール」になっていないか確認してください（印刷画面で「カラー」を選ぶ）。</p>';
    ov.style.display = 'block';
    document.getElementById('tco-close').onclick = function () { ov.style.display = 'none'; };
    document.getElementById('tco-print').onclick = function () { window.print(); };
    document.getElementById('tco-png').onclick = function () { exportPNG(doc, vr, cfg, state); };
    document.getElementById('tco-mono').onchange = function () {
      state.color = !this.checked;
      var sheet = ov.querySelector('.tco-sheet');
      if (sheet) sheet.innerHTML = buildChartSVG(doc, vr, cfg, state).svgString;
      var m = ov.querySelector('.tco-mode');
      if (m) m.textContent = state.color ? '糸の色そのままカラーで印刷します' : '記号だけの白黒で印刷します';
    };
    return built;
  }

  // チャートSVG → PNG ダウンロード（画面のカラー切替と同じ opts で出す）
  function exportPNG(doc, vr, cfg, opts) {
    var built = buildChartSVG(doc, vr, cfg, opts);
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
