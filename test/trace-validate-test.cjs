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

console.log('\ntrace-validate-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
