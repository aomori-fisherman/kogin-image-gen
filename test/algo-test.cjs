/* algo-test.cjs
   純関数層（quantize）をNodeで検証。canvas/DOM不要。
   quantize.jsを window グローバル注入で読み込む。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
const sandbox = { window: win };
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'quantize.js'), 'utf8');
vm.runInNewContext(code, sandbox);
const Q = win.KoginQuantize;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); }
}

// computeGridDims: 奇数丸め + 縦横比
(() => {
  const d = Q.computeGridDims(100, 50, 40);
  assert(d.gridW % 2 === 1, 'gridW odd (' + d.gridW + ')');
  assert(d.gridH % 2 === 1, 'gridH odd (' + d.gridH + ')');
  assert(d.gridW === 41, 'gridW rounds 40->41 (' + d.gridW + ')');
  // 100:50 = 2:1 なので gridH ~ 20 → 奇数 21
  assert(d.gridH === 21, 'gridH ~ ratio (' + d.gridH + ')');
})();

// downsampleLuminance: 左半分黒 / 右半分白 の画像 → 平均輝度が左低・右高
(() => {
  const W = 20, H = 10;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = x < W / 2 ? 0 : 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const imageData = { width: W, height: H, data };
  const ds = Q.downsampleLuminance(imageData, 4, 2); // 4x2 grid
  // 左列(col0,1)は暗、右列(col2,3)は明
  assert(ds.lum[0] < 10, 'left cell dark (' + ds.lum[0] + ')');
  assert(ds.lum[3] > 245, 'right cell light (' + ds.lum[3] + ')');
})();

// quantize: 暗い→高level, 明るい→level0
(() => {
  const lum = new Float32Array([0, 128, 255]);
  const lv = Q.quantize(lum, { levels: 3, contrast: 1, thresholdBias: 0, invert: false });
  assert(lv[2] === 0, 'bright -> level0 (' + lv[2] + ')');
  assert(lv[0] === 2, 'dark -> maxlevel (' + lv[0] + ')');
  assert(lv[1] >= 0 && lv[1] <= 2, 'mid in range (' + lv[1] + ')');
})();

// quantize invert: 明るい→刺し
(() => {
  const lum = new Float32Array([0, 255]);
  const lv = Q.quantize(lum, { levels: 2, contrast: 1, thresholdBias: 0, invert: true });
  assert(lv[0] === 0, 'invert: dark -> level0 (' + lv[0] + ')');
  assert(lv[1] === 1, 'invert: bright -> stitched (' + lv[1] + ')');
})();

// quantize bias: 正バイアスで刺しが増える（同じ中間輝度でlevelが上がる）
(() => {
  const lum = new Float32Array([150]);
  const lo = Q.quantize(lum, { levels: 3, contrast: 1, thresholdBias: 0, invert: false })[0];
  const hi = Q.quantize(lum, { levels: 3, contrast: 1, thresholdBias: 60, invert: false })[0];
  assert(hi >= lo, 'positive bias increases stitch level (' + lo + ' -> ' + hi + ')');
})();

console.log('\nalgo-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
