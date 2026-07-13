/* app.js
   UI結線・パイプライン統括。
   画像 → ダウンサンプル → 量子化 → こぎん風描画 → PNG書き出し。 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    btnSample: $('btn-sample'),
    srcCanvas: $('src-canvas'),
    chartCanvas: $('chart-canvas'),
    chartInfo: $('chart-info'),
    gridW: $('grid-w'), gwVal: $('gw-val'),
    levels: $('levels'), lvVal: $('lv-val'),
    threshold: $('threshold'), thVal: $('th-val'),
    contrast: $('contrast'), ctVal: $('ct-val'),
    invert: $('invert'),
    stitchStyle: $('stitch-style'),
    showGrid: $('show-grid'),
    btnExport: $('btn-export')
  };

  // 現在読み込まれている画像の ImageData を保持
  var state = { imageData: null, imgW: 0, imgH: 0 };

  /* ---- 画像読み込み ---- */
  function handleFile(file) {
    KoginImageLoader.loadFileToCanvas(file, els.srcCanvas, 480)
      .then(function (r) {
        state.imageData = r.imageData;
        state.imgW = r.width;
        state.imgH = r.height;
        els.srcCanvas.classList.add('loaded');
        regenerate();
      })
      .catch(function (e) {
        els.chartInfo.textContent = '読み込みエラー: ' + e.message;
      });
  }

  function loadSample() {
    var url = KoginSample.makeSampleDataUrl(400);
    KoginImageLoader.loadUrlToCanvas(url, els.srcCanvas, 480)
      .then(function (r) {
        state.imageData = r.imageData;
        state.imgW = r.width;
        state.imgH = r.height;
        els.srcCanvas.classList.add('loaded');
        regenerate();
      })
      .catch(function (e) {
        els.chartInfo.textContent = 'サンプル生成エラー: ' + e.message;
      });
  }

  /* ---- パイプライン ---- */
  function regenerate() {
    if (!state.imageData) return;

    var gridWReq = parseInt(els.gridW.value, 10);
    var dims = KoginQuantize.computeGridDims(state.imgW, state.imgH, gridWReq);

    var ds = KoginQuantize.downsampleLuminance(state.imageData, dims.gridW, dims.gridH);

    var numLevels = parseInt(els.levels.value, 10);
    var levels = KoginQuantize.quantize(ds.lum, {
      levels: numLevels,
      contrast: parseFloat(els.contrast.value),
      thresholdBias: parseInt(els.threshold.value, 10),
      invert: els.invert.checked
    });

    // セルサイズ：チャート最大辺を ~900px に収める
    var maxSide = 900;
    var cellW = Math.max(6, Math.floor(maxSide / dims.gridW));
    if (cellW > 22) cellW = 22;

    var info = KoginRender.render(els.chartCanvas, levels, dims.gridW, dims.gridH, {
      numLevels: numLevels,
      style: els.stitchStyle.value,
      showGrid: els.showGrid.checked,
      cellW: cellW
    });

    // 刺し目セル数（level>0）を数えて情報表示
    var stitched = 0;
    for (var i = 0; i < levels.length; i++) if (levels[i] > 0) stitched++;
    els.chartInfo.textContent =
      'グリッド ' + dims.gridW + '×' + dims.gridH + ' 目（横は奇数に丸め・縦は比率から自動）'
      + ' ／ 刺し目セル ' + stitched + ' ／ 段数 ' + numLevels
      + ' ／ 出力 ' + info.width + '×' + info.height + 'px';
  }

  /* ---- 書き出し ---- */
  function exportPng() {
    if (!state.imageData) { return; }
    try {
      var url = els.chartCanvas.toDataURL('image/png');
      var a = document.createElement('a');
      var ts = new Date();
      var name = 'kogin-chart-' +
        ts.getFullYear() +
        String(ts.getMonth() + 1).padStart(2, '0') +
        String(ts.getDate()).padStart(2, '0') + '-' +
        String(ts.getHours()).padStart(2, '0') +
        String(ts.getMinutes()).padStart(2, '0') + '.png';
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      els.chartInfo.textContent = '書き出しエラー: ' + e.message;
    }
  }

  /* ---- ラベル同期 ---- */
  function syncLabels() {
    // 表示グリッド横は奇数丸め後の値を出したいので、丸め結果を表示
    var raw = parseInt(els.gridW.value, 10);
    var shown = raw % 2 === 0 ? raw + 1 : raw;
    els.gwVal.textContent = shown;
    els.lvVal.textContent = els.levels.value;
    var th = parseInt(els.threshold.value, 10);
    els.thVal.textContent = (th > 0 ? '+' : '') + th;
    els.ctVal.textContent = parseFloat(els.contrast.value).toFixed(1);
  }

  /* ---- 配線 ---- */
  function init() {
    KoginImageLoader.wireDropzone(els.dropzone, handleFile);
    els.fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });
    els.btnSample.addEventListener('click', loadSample);
    els.btnExport.addEventListener('click', exportPng);

    ['gridW', 'levels', 'threshold', 'contrast'].forEach(function (k) {
      els[k].addEventListener('input', function () { syncLabels(); regenerate(); });
    });
    ['invert', 'showGrid'].forEach(function (k) {
      els[k].addEventListener('change', regenerate);
    });
    els.stitchStyle.addEventListener('change', regenerate);

    syncLabels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
