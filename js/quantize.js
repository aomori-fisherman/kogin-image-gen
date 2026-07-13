/* quantize.js
   画像を刺し目グリッドへダウンサンプルし、輝度を N 段階に量子化する。
   決定論・純関数。ImageData → level行列 を返す。 */

(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * 横の目数から、画像の縦横比に合わせた縦の目数を決める。
   * こぎんは奇数目基調 → 両方を奇数に丸める。
   */
  function computeGridDims(imgW, imgH, gridW) {
    gridW = Math.max(3, Math.round(gridW));
    if (gridW % 2 === 0) gridW += 1; // 奇数へ
    var gridH = Math.round(gridW * (imgH / imgW));
    gridH = Math.max(3, gridH);
    if (gridH % 2 === 0) gridH += 1;
    return { gridW: gridW, gridH: gridH };
  }

  /**
   * ImageDataを gridW x gridH のセルにダウンサンプルし、各セルの平均輝度(0..255)を返す。
   * @returns {{gridW:number, gridH:number, lum:Float32Array}} lumは row-major
   */
  function downsampleLuminance(imageData, gridW, gridH) {
    var W = imageData.width, H = imageData.height, data = imageData.data;
    var lum = new Float32Array(gridW * gridH);
    var count = new Float32Array(gridW * gridH);

    for (var y = 0; y < H; y++) {
      var gy = Math.min(gridH - 1, Math.floor(y * gridH / H));
      for (var x = 0; x < W; x++) {
        var gx = Math.min(gridW - 1, Math.floor(x * gridW / W));
        var i = (y * W + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        // 透明ピクセルは「白（明・非刺し）」として扱う（ロゴの背景透過対策）
        var l;
        if (a < 16) {
          l = 255;
        } else {
          // Rec.601 輝度
          l = 0.299 * r + 0.587 * g + 0.114 * b;
          // 半透明は白へブレンド
          if (a < 255) { l = l * (a / 255) + 255 * (1 - a / 255); }
        }
        var idx = gy * gridW + gx;
        lum[idx] += l;
        count[idx] += 1;
      }
    }
    for (var k = 0; k < lum.length; k++) {
      lum[k] = count[k] > 0 ? lum[k] / count[k] : 255;
    }
    return { gridW: gridW, gridH: gridH, lum: lum };
  }

  /**
   * コントラスト・反転・しきい値バイアスを適用しつつ、輝度を levels 段階に量子化。
   * 返すlevelは 0..(levels-1)。0=最も明るい（非刺し）、levels-1=最も暗い（濃い刺し）。
   * @param {Float32Array} lum 0..255
   * @param {object} opts {levels, contrast, thresholdBias, invert}
   * @returns {Uint8Array} level行列（row-major・0..levels-1）
   */
  function quantize(lum, opts) {
    var levels = clamp(opts.levels | 0, 2, 8);
    var contrast = opts.contrast != null ? opts.contrast : 1.0;
    var bias = opts.thresholdBias || 0; // -128..128 相当
    var invert = !!opts.invert;

    var out = new Uint8Array(lum.length);
    for (var i = 0; i < lum.length; i++) {
      var l = lum[i];
      // コントラスト（中心128）
      l = (l - 128) * contrast + 128;
      // バイアス：正で暗くする＝刺し増（後で暗いほど高levelなので、明るさを下げる）
      l = l - bias;
      if (invert) l = 255 - l;
      l = clamp(l, 0, 255);

      // 明るいl=255 → level0（非刺し）、暗いl=0 → level(levels-1)（濃い刺し）
      var darkness = 255 - l; // 0..255
      var lv = Math.floor(darkness / 256 * levels);
      if (lv > levels - 1) lv = levels - 1;
      out[i] = lv;
    }
    return out;
  }

  global.KoginQuantize = {
    computeGridDims: computeGridDims,
    downsampleLuminance: downsampleLuminance,
    quantize: quantize
  };
})(window);
