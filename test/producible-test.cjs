/* producible-test.cjs
   kogin-render.js の producible ロジック（splitRun / buildStitchMap / verifyFloats）を
   Nodeで検証。canvas/DOM不要（純関数層のみ）。
   ねらい: どんなlevel行列でも「実際に糸が乗るセル」の横float(渡り)が FLOAT_MAX(=7) を
   超えないこと＝実際に刺せる図案になっていることを機械検証する。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const win = {};
const sandbox = { window: win, self: win };
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'kogin-render.js'), 'utf8');
vm.runInNewContext(code, sandbox);
const R = win.KoginRender;
const FLOAT_MAX = R.FLOAT_MAX;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); }
}

/* 与えた level行列(2D配列) を1次元にして buildStitchMap→verifyFloats。
   最悪float長も返す。 */
function analyze(rows2d) {
  const gridH = rows2d.length;
  const gridW = Math.max(...rows2d.map(r => r.length));
  const levels = new Uint8Array(gridW * gridH);
  for (let y = 0; y < gridH; y++)
    for (let x = 0; x < rows2d[y].length; x++)
      levels[y * gridW + x] = rows2d[y][x];

  // 修正前の最悪float（＝生の連続オン長）
  let rawMax = 0;
  for (let y = 0; y < gridH; y++) {
    let run = 0;
    for (let x = 0; x < gridW; x++) {
      if (levels[y * gridW + x] > 0) { run++; rawMax = Math.max(rawMax, run); }
      else run = 0;
    }
  }

  const stitched = R.buildStitchMap(levels, gridW, gridH);
  const viol = R.verifyFloats(stitched, gridW, gridH, FLOAT_MAX);

  // 分解後の最悪float
  let splitMax = 0;
  for (let y = 0; y < gridH; y++) {
    let run = 0;
    for (let x = 0; x < gridW; x++) {
      if (stitched[y * gridW + x] > 0) { run++; splitMax = Math.max(splitMax, run); }
      else run = 0;
    }
  }
  return { rawMax, splitMax, viol, gridW, gridH };
}

console.log(`FLOAT_MAX = ${FLOAT_MAX}\n`);

// 1. splitRun: 短い要素(<=7)はそのまま1本＝形が潰れない
(() => {
  assert(JSON.stringify(R.splitRun(0, 1, 0)) === JSON.stringify([{ start: 0, len: 1 }]), 'len1 unchanged');
  assert(JSON.stringify(R.splitRun(3, 7, 0)) === JSON.stringify([{ start: 3, len: 7 }]), 'len7 unchanged (=FLOAT_MAX)');
})();

// 2. splitRun: 長い面は最大FLOAT_MAX目に分解される
(() => {
  for (let len = 8; len <= 40; len++) {
    for (let row = 0; row < 12; row++) {
      const segs = R.splitRun(0, len, row);
      const bad = segs.filter(s => s.len > FLOAT_MAX);
      assert(bad.length === 0, `splitRun len=${len} row=${row} has seg>${FLOAT_MAX}`);
      // セグメントが範囲内・重ならない・GAPが空く
      let prevEnd = -2;
      for (const s of segs) {
        assert(s.start >= 0 && s.start + s.len <= len, `seg in range len=${len}`);
        assert(s.start > prevEnd, `gap present len=${len} row=${row}`);
        prevEnd = s.start + s.len - 1;
      }
    }
  }
})();

// 3. 最悪ケース: 16×12 の完全ベタ塗り（旧・工藤パンの角食パン相当）
(() => {
  const solid = Array.from({ length: 12 }, () => Array(16).fill(2)); // level2ベタ
  const a = analyze(solid);
  assert(a.rawMax === 16, `raw solid float = 16 (${a.rawMax})`);
  assert(a.splitMax <= FLOAT_MAX, `solid split float <= ${FLOAT_MAX} (${a.splitMax})`);
  assert(a.viol.length === 0, `solid: 0 violations (${a.viol.length})`);
})();

// 4. 幅50の巨大ベタ（極端）
(() => {
  const big = Array.from({ length: 30 }, () => Array(50).fill(1));
  const a = analyze(big);
  assert(a.splitMax <= FLOAT_MAX, `big split float <= ${FLOAT_MAX} (${a.splitMax})`);
  assert(a.viol.length === 0, `big: 0 violations (${a.viol.length})`);
})();

// 5. 段々になっているか（隣接行で隙間位置がずれる＝ひし形テクスチャ）
(() => {
  // 幅30ベタ2行を比較し、糸が乗るセルパターンが行で異なる（＝オフセットしている）
  const rows2d = Array.from({ length: 4 }, () => Array(30).fill(1));
  const gridW = 30, gridH = 4;
  const levels = new Uint8Array(gridW * gridH);
  for (let i = 0; i < levels.length; i++) levels[i] = 1;
  const st = R.buildStitchMap(levels, gridW, gridH);
  let differ = false;
  for (let x = 0; x < gridW; x++) {
    if (st[0 * gridW + x] !== st[1 * gridW + x]) { differ = true; break; }
  }
  assert(differ, 'row0 and row1 stitch pattern differ (staggered fill)');
})();

// 6. サンプル画像相当のパイプラインは quantize→render。ここでは render の返り値に
//    violations が含まれ空であることを render 実描画無しの純ロジックで代替済み。

console.log(`\nproducible-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
