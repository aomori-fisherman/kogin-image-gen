/* trace-validate-test.cjs
   trace-validate.js の純関数を Node で検証。受け入れ条件 §6.A の validate 分（9,10）。 */
'use strict';
const V = require('../js/trace-validate.js');

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 9. extractRunsMulti：色境界でラン分割
(() => {
  const r = 'r01', w = 'w01';
  const got = V.extractRunsMulti([r, r, w, r, null, r]);
  const exp = [
    { colorId: r, start: 0, len: 2 },
    { colorId: w, start: 2, len: 1 },
    { colorId: r, start: 3, len: 1 },
    { colorId: r, start: 5, len: 1 }
  ];
  assert(eq(got, exp), 'extractRunsMulti color-boundary split (' + JSON.stringify(got) + ')');
  // 全 null は空
  assert(eq(V.extractRunsMulti([null, null]), []), 'all-null -> no runs');
})();

// 10. analyze：長さ8→floatViolations 1件・長さ7→0件・長さ2→evenRuns 1件
(() => {
  const row8 = new Array(8).fill('r01');
  const a8 = V.analyze([row8], { floatMax: 7 });
  assert(a8.floatViolations.length === 1, 'len8 -> 1 violation (' + a8.floatViolations.length + ')');
  assert(eq(a8.floatViolations[0], { y: 0, start: 0, len: 8, colorId: 'r01' }), 'violation y/start/len/color');
  assert(a8.maxRunLen === 8, 'maxRunLen 8');

  const row7 = new Array(7).fill('r01');
  const a7 = V.analyze([row7], { floatMax: 7 });
  assert(a7.floatViolations.length === 0, 'len7 -> 0 violation');

  // 長さ2 → evenRuns 1件
  const row2 = ['b01', 'b01', null, 'b01']; // len2 + len1
  const a2 = V.analyze([row2], { floatMax: 7 });
  assert(a2.evenRuns.length === 1, 'len2 -> 1 evenRun (' + a2.evenRuns.length + ')');
  assert(eq(a2.evenRuns[0], { y: 0, start: 0, len: 2, colorId: 'b01' }), 'evenRun position');
  assert(a2.runCount === 2, 'runCount 2');
  assert(a2.cellCount === 3, 'cellCount 3');
})();

// 追加：多色集計 perColor / usedColorIds
(() => {
  const cells = [
    ['r01', 'r01', 'w01', null],
    [null, 'w01', 'w01', 'w01']
  ];
  const a = V.analyze(cells, { floatMax: 7 });
  assert(a.perColor['r01'] === 2, 'perColor r01=2');
  assert(a.perColor['w01'] === 4, 'perColor w01=4');
  assert(eq(a.usedColorIds.sort(), ['r01', 'w01']), 'usedColorIds');
  assert(a.runCount === 3, 'runCount 3 (r01x1, w01x2 separated by null then color)');
  assert(a.cellCount === 6, 'cellCount 6');
})();

// 11. break（切れ目）分割: extractRunsMulti が切れ目エッジでも同色ランを切る
(() => {
  const row8 = new Array(8).fill('r01');
  // 切れ目なし → 1本 len8
  const noBrk = V.extractRunsMulti(row8);
  assert(noBrk.length === 1 && noBrk[0].len === 8, 'no-break: single len8 run');
  // 切れ目 x=4（3↔4 の間） → 4+4 の2本
  const withBrk = V.extractRunsMulti(row8, [4]);
  assert(eq(withBrk, [
    { colorId: 'r01', start: 0, len: 4 },
    { colorId: 'r01', start: 4, len: 4 }
  ]), 'break at 4 splits 8 into 4+4 (' + JSON.stringify(withBrk) + ')');
  // 複数切れ目 x=[2,4] → 2+2+4
  const multi = V.extractRunsMulti(row8, [2, 4]);
  assert(eq(multi.map(r => r.len), [2, 2, 4]), 'breaks [2,4] -> 2+2+4');
  // 空/未指定 breaksRow は従来通り
  assert(V.extractRunsMulti(row8, []).length === 1, 'empty break array = no split');
})();

// 12. analyze with breaks: 8目同色ラン＋breakで4+4→ float違反(>7)が解消
(() => {
  const row8 = new Array(8).fill('r01');
  const before = V.analyze([row8], { floatMax: 7 });
  assert(before.floatViolations.length === 1, 'len8 without break -> 1 float violation');
  assert(before.runCount === 1 && before.maxRunLen === 8, 'len8 single run, maxRun 8');
  // breaks: 行0 の x=4 に切れ目
  const after = V.analyze([row8], { floatMax: 7, breaks: { 0: [4] } });
  assert(after.floatViolations.length === 0, 'len8 with break at 4 -> 0 violation (producible)');
  assert(after.runCount === 2, 'break splits into 2 runs');
  assert(after.maxRunLen === 4, 'maxRunLen now 4');
  assert(after.cellCount === 8, 'cellCount unchanged 8');
  assert(after.perColor['r01'] === 8, 'perColor total unchanged');
  // 集計は色境界と切れ目の両方で切る（多色＋break）
  const mixed = V.analyze([['r01', 'r01', 'r01', 'r01', 'w01', 'w01']], { floatMax: 7, breaks: { 0: [2] } });
  assert(mixed.runCount === 3, 'color-change + break -> 3 runs (' + mixed.runCount + ')');
})();

console.log('\ntrace-validate-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
