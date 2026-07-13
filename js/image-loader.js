/* image-loader.js
   画像の読み込み（file input / D&D / dataURL）と、ソースcanvasへの描画。
   完全クライアントサイド。外部依存なし。 */

(function (global) {
  'use strict';

  /**
   * File または Blob を <img> 経由で読み込み、指定canvasに描画して解決する。
   * @param {File|Blob} file
   * @param {HTMLCanvasElement} canvas 描画先（縮小して収める）
   * @param {number} maxDim 内部処理用の最大辺（大きすぎる画像を縮小）
   * @returns {Promise<{width:number, height:number, imageData:ImageData}>}
   */
  function loadFileToCanvas(file, canvas, maxDim) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error('画像ファイルではありません: ' + (file && file.type)));
        return;
      }
      var url = URL.createObjectURL(file);
      loadUrlToCanvas(url, canvas, maxDim).then(function (r) {
        URL.revokeObjectURL(url);
        resolve(r);
      }).catch(function (e) {
        URL.revokeObjectURL(url);
        reject(e);
      });
    });
  }

  /**
   * URL / dataURL を読み込んでcanvasへ。
   */
  function loadUrlToCanvas(url, canvas, maxDim) {
    maxDim = maxDim || 480;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      // dataURL/blobURLは同一オリジン扱い。将来外部URLを許すなら crossOrigin 検討。
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) { reject(new Error('画像サイズを取得できません')); return; }

        var scale = Math.min(1, maxDim / Math.max(w, h));
        var dw = Math.max(1, Math.round(w * scale));
        var dh = Math.max(1, Math.round(h * scale));

        canvas.width = dw;
        canvas.height = dh;
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, dw, dh);
        ctx.drawImage(img, 0, 0, dw, dh);

        var imageData;
        try {
          imageData = ctx.getImageData(0, 0, dw, dh);
        } catch (e) {
          reject(new Error('canvasの読み取りに失敗（tainted?）: ' + e.message));
          return;
        }
        resolve({ width: dw, height: dh, imageData: imageData });
      };
      img.onerror = function () { reject(new Error('画像の読み込みに失敗しました')); };
      img.src = url;
    });
  }

  /**
   * D&Dの配線。dropzone要素にドラッグ状態クラスを付け、drop時にコールバック。
   * @param {HTMLElement} zone
   * @param {(file:File)=>void} onFile
   */
  function wireDropzone(zone, onFile) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      onFile(dt.files[0]);
    });
  }

  global.KoginImageLoader = {
    loadFileToCanvas: loadFileToCanvas,
    loadUrlToCanvas: loadUrlToCanvas,
    wireDropzone: wireDropzone
  };
})(window);
