/* trace-state-test.cjs
   trace-state.js の純関数を Node で検証（DOM不要）。受け入れ条件 §6.A の state 分。 */
'use strict';
const S = require('../js/trace-state.js');

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 1. newDoc(80,100) → w=80 のまま（偶数が丸められない）・cells 全 null
(() => {
  const d = S.newDoc(80, 100);
  assert(d.grid.w === 80, 'newDoc w stays 80 (not odd-rounded) (' + d.grid.w + ')');
  assert(d.grid.h === 100, 'newDoc h stays 100 (' + d.grid.h + ')');
  assert(d.cells.length === 100 && d.cells[0].length === 80, 'cells 100x80');
  let allNull = true;
  for (const row of d.cells) for (const c of row) if (c !== null) allNull = false;
  assert(allNull, 'cells all null');
  assert(d.version === 1, 'version 1');
  // clamp のみ（3..200）。奇数丸めしない
  assert(S.newDoc(1, 4).grid.w === 3, 'clamp low 1->3');
  assert(S.newDoc(999, 4).grid.w === 200, 'clamp high 999->200');
  assert(S.newDoc(6, 6).grid.w === 6, 'even 6 kept');
})();

// 2. paintRun 右→左（x1>x2）でも同結果・上書き
(() => {
  const a = S.newDoc(10, 3);
  S.paintRun(a.cells, 1, 2, 6, 'r01');
  const b = S.newDoc(10, 3);
  S.paintRun(b.cells, 1, 6, 2, 'r01'); // 逆向き
  assert(deepEqual(a.cells, b.cells), 'paintRun x1>x2 same as x1<x2');
  for (let x = 2; x <= 6; x++) assert(a.cells[1][x] === 'r01', 'painted ' + x);
  assert(a.cells[1][1] === null && a.cells[1][7] === null, 'edges untouched');
  // 上書き
  S.paintRun(a.cells, 1, 3, 4, 'b01');
  assert(a.cells[1][3] === 'b01' && a.cells[1][2] === 'r01', 'overwrite works');
  // clamp（枠外指定）
  const c = S.newDoc(5, 2);
  S.paintRun(c.cells, 0, -3, 99, 'w01');
  assert(c.cells[0].every(v => v === 'w01'), 'paintRun clamps to grid');
})();

// 3. oddSnapLen
(() => {
  const FM = 7;
  assert(eq(S.oddSnapLen(0, 3, 1, 100, FM), [0, 4]), 'len4 -> 5 extend right');   // 4->5
  assert(eq(S.oddSnapLen(96, 99, 1, 100, FM), [96, 98]), 'edge: cannot extend -> shrink to 3'); // 4->3 at right edge (w=100 => max idx 99)
  assert(eq(S.oddSnapLen(0, 7, 1, 100, FM), [0, 6]), 'len8 extend would exceed floatMax -> shrink to 7'); // 8->7
  assert(eq(S.oddSnapLen(2, 6, 1, 100, FM), [2, 6]), 'odd len5 unchanged');       // 5 stays
  assert(eq(S.oddSnapLen(4, 4, 1, 100, FM), [4, 4]), 'len1 unchanged');           // 1 stays
  // 左方向
  assert(eq(S.oddSnapLen(3, 6, -1, 100, FM), [2, 6]), 'len4 dir -1 extend left');  // 4->5 left
  assert(eq(S.oddSnapLen(0, 3, -1, 100, FM), [1, 3]), 'left edge cannot extend -> shrink left'); // 4->3
})();

// 4. diagonalCells(0,0,4,4) → 5 セル・各行 x,y +1
(() => {
  const cells = S.diagonalCells(0, 0, 4, 4);
  assert(cells.length === 5, 'diag length 5 (' + cells.length + ')');
  for (let i = 0; i < 5; i++) assert(cells[i].x === i && cells[i].y === i, 'diag step ' + i);
  // 逆方向・非正方
  const c2 = S.diagonalCells(5, 5, -3, 6);
  assert(c2.length === 4, 'diag min(3,6)+1=4');
  assert(c2[1].x === 4 && c2[1].y === 6, 'diag sign dir');
})();

// 5. copyRect -> repeatPaste
(() => {
  const src = S.newDoc(20, 20);
  S.paintRun(src.cells, 0, 0, 1, 'r01'); // 2x1 の L 字風（(0,0),(1,0),(0,1)）
  src.cells[1][0] = 'b01';
  const clip = S.copyRect(src.cells, 0, 0, 2, 2);
  assert(clip.w === 2 && clip.h === 2, 'clip size');
  assert(clip.cells[0][0] === 'r01' && clip.cells[1][0] === 'b01' && clip.cells[1][1] === null, 'clip content');

  const dst = S.newDoc(20, 20);
  const nx = 2, ny = 2, gapX = 1, gapY = 1;
  const written = S.repeatPaste(dst.cells, clip, 3, 4, nx, ny, gapX, gapY);
  // 非null数 = clip 非null(3) * 4 = 12
  assert(written === 12, 'written = 12 (' + written + ')');
  // 位置式 (ax+i*(w+gapX), ay+j*(h+gapY))
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ox = 3 + i * (clip.w + gapX), oy = 4 + j * (clip.h + gapY);
    assert(dst.cells[oy][ox] === 'r01', 'stamp r01 at ' + ox + ',' + oy);
    assert(dst.cells[oy + 1][ox] === 'b01', 'stamp b01');
  }
  // 枠外clip：例外を出さず written が減る
  const small = S.newDoc(5, 5);
  const w2 = S.repeatPaste(small.cells, clip, 4, 4, 3, 3, 0, 0); // 大半が枠外
  assert(w2 < 12 && w2 >= 0, 'out-of-grid clipped, no throw (' + w2 + ')');
})();

// 6. resizeGrid：縮小 dropped 正確・拡大保持
(() => {
  const d = S.newDoc(10, 10);
  S.paintRun(d.cells, 9, 8, 9, 'r01'); // 右下 2 セル
  S.paintRun(d.cells, 0, 0, 2, 'b01'); // 左上 3 セル
  const shr = S.resizeGrid(d, 5, 5);   // 右下2セルが落ちる
  assert(shr.dropped === 2, 'dropped = 2 (' + shr.dropped + ')');
  assert(shr.doc.cells[0][0] === 'b01', 'kept top-left after shrink');
  assert(shr.doc.grid.w === 5 && shr.doc.grid.h === 5, 'shrunk dims');
  const grow = S.resizeGrid(shr.doc, 12, 12);
  assert(grow.dropped === 0, 'grow drops nothing');
  assert(grow.doc.cells[0][0] === 'b01', 'kept after grow');
  assert(grow.doc.cells[11][11] === null, 'grow fills null');
})();

// 7. DocStore：3操作→undo×3で初期→redo×3で再現→新規コミットでredo不可
(() => {
  const d0 = S.newDoc(8, 4);
  const initial = JSON.parse(JSON.stringify(d0));
  const store = S.DocStore(d0);
  S.paintRun(store.current().cells, 0, 0, 2, 'r01'); store.commit('op1');
  S.paintRun(store.current().cells, 1, 1, 3, 'b01'); store.commit('op2');
  S.paintRun(store.current().cells, 2, 0, 5, 'g01'); store.commit('op3');
  assert(store.canUndo() && !store.canRedo(), 'after 3 commits canUndo, !canRedo');
  store.undo(); store.undo(); store.undo();
  assert(deepEqual(store.current().cells, initial.cells), 'undo x3 == initial cells');
  assert(!store.canUndo(), '!canUndo at initial');
  store.redo(); store.redo(); store.redo();
  assert(store.current().cells[2][5] === 'g01', 'redo x3 reproduces op3');
  assert(!store.canRedo(), '!canRedo after full redo');
  // 新規コミットで future クリア
  store.undo();
  S.paintRun(store.current().cells, 3, 0, 1, 'y01'); store.commit('op4');
  assert(!store.canRedo(), 'new commit clears redo');
})();

// 8. serialize -> deserialize roundtrip・version=1
(() => {
  const d = S.newDoc(6, 6);
  S.paintRun(d.cells, 2, 1, 4, 'r01');
  d.underlay = { dataURL: 'data:image/png;base64,AAAA', x: 1, y: 2, scale: 1.5, rotateDeg: 90, opacity: 0.5, grayscale: true, w: 100, h: 80 };
  const round = S.deserialize(S.serialize(d));
  assert(deepEqual(round, d), 'serialize roundtrip deep-equal');
  assert(round.version === 1, 'version 1');
  // 不正 version は throw
  let threw = false;
  try { S.deserialize(JSON.stringify({ version: 2, grid: {}, cells: [] })); } catch (e) { threw = true; }
  assert(threw, 'bad version throws');
  // 不正JSONは throw
  let threw2 = false;
  try { S.deserialize('{not json'); } catch (e) { threw2 = true; }
  assert(threw2, 'bad json throws');
})();

// 追加：moveRun / resizeRun / runAt
(() => {
  const d = S.newDoc(10, 3);
  S.paintRun(d.cells, 1, 2, 5, 'r01'); // len4 run
  const run = S.runAt(d.cells, 3, 1);
  assert(run && run.start === 2 && run.len === 4 && run.colorId === 'r01', 'runAt finds run');
  S.moveRun(d.cells, run, 1, 0); // 右へ1
  assert(d.cells[1][2] === null && d.cells[1][6] === 'r01', 'moveRun shifts right');
  // はみ出す移動は拒否
  const run2 = S.runAt(d.cells, 6, 1);
  const before = JSON.stringify(d.cells);
  S.moveRun(d.cells, run2, 99, 0);
  assert(JSON.stringify(d.cells) === before, 'moveRun out-of-grid rejected');
  // resizeRun R+1 / R-1 / 長さ1未満無視
  const d2 = S.newDoc(10, 1);
  S.paintRun(d2.cells, 0, 0, 0, 'b01'); // len1
  let r = S.runAt(d2.cells, 0, 0);
  S.resizeRun(d2.cells, r, 'R', -1); // 縮小不可
  assert(d2.cells[0][0] === 'b01', 'resizeRun shrink below 1 ignored');
  S.resizeRun(d2.cells, r, 'R', 1);  // 右へ伸長
  assert(d2.cells[0][1] === 'b01', 'resizeRun R+1 extends');
})();

console.log('\ntrace-state-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
