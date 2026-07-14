/* pipeline-producible.cjs
   実パイプライン（quantize.js → kogin-render.js の producibleロジック）をNodeで通し、
   合成の高コントラスト画像（サンプル相当＝ベタ塗り面が出る最悪ケース）で
   float>7 が1つも出ないことを機械検証する。canvas描画は不要（純ロジック層のみ）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
const sandbox = { window: win, self: win };
function load(f) { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox); }
load('quantize.js');
load('kogin-render.js');
const Q = win.KoginQuantize;
const R = win.KoginRender;
const FLOAT_MAX = R.FLOAT_MAX;

// --- 合成画像を作る: 白地に黒のベタ図形（面塗りが出る＝floatが伸びやすい最悪ケース）---
function makeImage(W, H, painter) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255; }
  painter((x, y, v) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4; data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  });
  return { width: W, height: H, data };
}

const cases = [];

// 1. ベタ四角（大面積・最悪）
cases.push(['solid-rect', makeImage(400, 300, (put) => {
  for (let y = 40; y < 260; y++) for (let x = 40; x < 360; x++) put(x, y, 20);
})]);

// 2. 菱形（サンプル相当）
cases.push(['diamond', makeImage(400, 400, (put) => {
  const cx = 200, cy = 200, r = 150;
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++)
    if (Math.abs(x - cx) + Math.abs(y - cy) < r) put(x, y, 17);
})]);

// 3. 太い横帯（softbank相当・純粋な長float）
cases.push(['wide-bars', makeImage(400, 200, (put) => {
  for (let x = 20; x < 380; x++) { for (let y = 40; y < 70; y++) put(x, y, 15); for (let y = 130; y < 160; y++) put(x, y, 15); }
})]);

let allOk = true, totalViol = 0;
console.log(`FLOAT_MAX = ${FLOAT_MAX}\n`);
console.log('case          grid       rawMaxFloat  splitMaxFloat  violations');
for (const [name, img] of cases) {
  const dims = Q.computeGridDims(img.width, img.height, 61);
  const ds = Q.downsampleLuminance(img, dims.gridW, dims.gridH);
  const levels = Q.quantize(ds.lum, { levels: 3, contrast: 1.2, thresholdBias: 0, invert: false });

  // raw float
  let rawMax = 0;
  for (let y = 0; y < dims.gridH; y++) { let run = 0; for (let x = 0; x < dims.gridW; x++) { if (levels[y * dims.gridW + x] > 0) { run++; rawMax = Math.max(rawMax, run); } else run = 0; } }

  const st = R.buildStitchMap(levels, dims.gridW, dims.gridH);
  const viol = R.verifyFloats(st, dims.gridW, dims.gridH, FLOAT_MAX);
  let splitMax = 0;
  for (let y = 0; y < dims.gridH; y++) { let run = 0; for (let x = 0; x < dims.gridW; x++) { if (st[y * dims.gridW + x] > 0) { run++; splitMax = Math.max(splitMax, run); } else run = 0; } }

  totalViol += viol.length;
  if (viol.length) allOk = false;
  console.log(`${name.padEnd(13)} ${(dims.gridW + 'x' + dims.gridH).padEnd(10)} ${String(rawMax).padEnd(12)} ${String(splitMax).padEnd(14)} ${viol.length}`);
}
console.log(`\nTOTAL violations(float>${FLOAT_MAX}) = ${totalViol}`);
process.exit(allOk ? 0 : 1);
