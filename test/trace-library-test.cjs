/* trace-library-test.cjs
   #19（R5）js/trace-library.js の純ロジックを Node で検証。
   localStorage は fake storage を注入（DOM不要）。容量超過・索引破損・巻き戻しまで確認する。 */
'use strict';
const LIB = require('../js/trace-library.js');

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } }

// --- fake storage（quota上限つき・localStorage互換の最小実装） ---
function FakeStorage(limitChars) {
  const map = new Map();
  const limit = limitChars || Infinity;
  return {
    map: map,
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: function (k, v) {
      k = String(k); v = String(v);
      let total = 0;
      map.forEach((val, key) => { if (key !== k) total += key.length + val.length; });
      if (total + k.length + v.length > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem: k => { map.delete(String(k)); },
    get length() { return map.size; }
  };
}
const DOC = (n) => JSON.stringify({ version: 1, tag: n, grid: { w: 12, h: 4, cellAspect: 1 }, cells: [], breaks: {} });

// 1. 空 storage → 空一覧・索引は空・load は null
(() => {
  const st = FakeStorage();
  assert(LIB.list(st).length === 0, 'empty storage -> list 0');
  assert(LIB.readIndex(st).items.length === 0, 'empty storage -> index items 0');
  assert(LIB.load(st, 'nope') === null, 'load unknown id -> null');
  assert(LIB.available(st) === true, 'fake storage available');
})();

// 2. 新規保存 → 一覧1件・本体が読める・メタが載る
(() => {
  const st = FakeStorage();
  const r = LIB.save(st, { name: 'ねこ図案', docStr: DOC('a'), savedAt: '2026-07-30T01:00:00.000Z', w: 12, h: 4, cellCount: 5, thumb: 'data:image/png;base64,AAA' });
  assert(r.ok === true && typeof r.id === 'string' && r.id.length > 1, 'save new -> ok + id');
  const items = LIB.list(st);
  assert(items.length === 1, 'after save -> list 1 (' + items.length + ')');
  assert(items[0].name === 'ねこ図案' && items[0].w === 12 && items[0].h === 4 && items[0].cellCount === 5, 'meta stored (name/w/h/cellCount)');
  assert(items[0].thumb === 'data:image/png;base64,AAA', 'thumb stored in index');
  assert(LIB.load(st, r.id) === DOC('a'), 'body roundtrip');
  assert(st.getItem(LIB.docKey(r.id)) === DOC('a'), 'body key = kogin-trace-doc-v1:<id>');
  assert(LIB.find(st, r.id).id === r.id, 'find by id');
})();

// 3. 上書き保存: 同idで本体差し替え・件数は増えない・createdAtは維持・savedAt更新
(() => {
  const st = FakeStorage();
  const a = LIB.save(st, { name: '初回', docStr: DOC('v1'), savedAt: '2026-07-30T01:00:00.000Z' });
  const b = LIB.save(st, { id: a.id, name: '初回', docStr: DOC('v2'), savedAt: '2026-07-30T02:00:00.000Z' });
  assert(b.ok === true && b.id === a.id, 'overwrite keeps id');
  assert(LIB.list(st).length === 1, 'overwrite does not add item');
  assert(LIB.load(st, a.id) === DOC('v2'), 'overwrite replaces body');
  const it = LIB.find(st, a.id);
  assert(it.createdAt === '2026-07-30T01:00:00.000Z', 'createdAt kept on overwrite');
  assert(it.savedAt === '2026-07-30T02:00:00.000Z', 'savedAt updated on overwrite');
  // 存在しないidの上書きは bad（黙って新規作成しない）
  const c = LIB.save(st, { id: 'ghost', name: 'x', docStr: DOC('x') });
  assert(c.ok === false && c.reason === 'bad', 'overwrite unknown id -> bad');
  assert(LIB.list(st).length === 1, 'unknown-id overwrite did not add');
})();

// 4. 一覧は新しい順（savedAt 降順）
(() => {
  const st = FakeStorage();
  LIB.save(st, { name: '古い', docStr: DOC('1'), savedAt: '2026-07-01T00:00:00.000Z' });
  LIB.save(st, { name: '新しい', docStr: DOC('2'), savedAt: '2026-07-30T00:00:00.000Z' });
  LIB.save(st, { name: '中', docStr: DOC('3'), savedAt: '2026-07-15T00:00:00.000Z' });
  const names = LIB.list(st).map(i => i.name);
  assert(names.join(',') === '新しい,中,古い', 'list sorted newest first (' + names.join(',') + ')');
})();

// 5. 削除: 索引・本体の両方が消える／他は残る
(() => {
  const st = FakeStorage();
  const a = LIB.save(st, { name: 'A', docStr: DOC('a'), savedAt: '2026-07-01T00:00:00.000Z' });
  const b = LIB.save(st, { name: 'B', docStr: DOC('b'), savedAt: '2026-07-02T00:00:00.000Z' });
  const r = LIB.remove(st, a.id);
  assert(r.ok === true && r.items.length === 1, 'remove -> ok + 1 left');
  assert(LIB.load(st, a.id) === null, 'removed body gone');
  assert(st.getItem(LIB.docKey(a.id)) === null, 'removed body key gone');
  assert(LIB.load(st, b.id) === DOC('b'), 'other body kept');
})();

// 6. 容量超過: reason='quota'・索引は増えない・孤児の本体キーを残さない（巻き戻し）
(() => {
  const st = FakeStorage(400);   // 極小上限
  const first = LIB.save(st, { name: 'A', docStr: DOC('a'), savedAt: '2026-07-01T00:00:00.000Z' });
  assert(first.ok === true, 'small save fits');
  const big = 'x'.repeat(5000);
  const r = LIB.save(st, { name: 'B', docStr: JSON.stringify({ version: 1, big: big }), savedAt: '2026-07-02T00:00:00.000Z' });
  assert(r.ok === false, 'quota save -> not ok');
  assert(r.reason === 'quota', "quota save -> reason 'quota' (" + r.reason + ')');
  assert(LIB.list(st).length === 1, 'quota save did not add to index');
  let orphan = 0;
  st.map.forEach((v, k) => { if (k.indexOf(LIB.DOC_PREFIX) === 0) orphan++; });
  assert(orphan === 1, 'no orphan body key after quota failure (' + orphan + ')');
  assert(LIB.load(st, first.id) === DOC('a'), 'existing body intact after quota failure');
})();

// 7. 索引だけ書けない場合の巻き戻し（上書き時は旧本体に戻す）
(() => {
  const st = FakeStorage();
  const a = LIB.save(st, { name: 'A', docStr: DOC('v1'), savedAt: '2026-07-01T00:00:00.000Z' });
  const realSet = st.setItem;
  st.setItem = function (k, v) { if (k === LIB.INDEX_KEY) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return realSet.call(st, k, v); };
  const r = LIB.save(st, { id: a.id, name: 'A', docStr: DOC('v2'), savedAt: '2026-07-02T00:00:00.000Z' });
  st.setItem = realSet;
  assert(r.ok === false && r.reason === 'quota', 'index write failure -> quota');
  assert(LIB.load(st, a.id) === DOC('v1'), 'body rolled back to previous on index failure');
  // 新規時は本体キーを消す
  const st2 = FakeStorage();
  const realSet2 = st2.setItem;
  st2.setItem = function (k, v) { if (k === LIB.INDEX_KEY) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return realSet2.call(st2, k, v); };
  const r2 = LIB.save(st2, { name: 'N', docStr: DOC('n') });
  st2.setItem = realSet2;
  let bodies = 0; st2.map.forEach((v, k) => { if (k.indexOf(LIB.DOC_PREFIX) === 0) bodies++; });
  assert(r2.ok === false && bodies === 0, 'new save rolled back (no body key left)');
})();

// 8. 索引が壊れていても死なない（空扱い）・保存で作り直せる
(() => {
  const st = FakeStorage();
  st.setItem(LIB.INDEX_KEY, '{壊れたJSON');
  assert(LIB.list(st).length === 0, 'broken index -> list 0 (no throw)');
  const r = LIB.save(st, { name: '復旧', docStr: DOC('r') });
  assert(r.ok === true && LIB.list(st).length === 1, 'save rebuilds index after corruption');
})();

// 9. 名前の正規化（空→無題・改行除去・上限60字）・保存内容が無ければ bad
(() => {
  const st = FakeStorage();
  assert(LIB.cleanName('  ') === '無題', 'blank name -> 無題');
  assert(LIB.cleanName('あ\nい\tう') === 'あ い う', 'newline/tab -> space');
  assert(LIB.cleanName('x'.repeat(80)).length === LIB.MAX_NAME, 'name truncated to MAX_NAME');
  const bad = LIB.save(st, { name: 'x', docStr: '' });
  assert(bad.ok === false && bad.reason === 'bad', 'empty docStr -> bad');
})();

// 10. usageBytes は保存で増え削除で減る／available は例外storageで false
(() => {
  const st = FakeStorage();
  const u0 = LIB.usageBytes(st);
  const a = LIB.save(st, { name: 'A', docStr: DOC('a') });
  const u1 = LIB.usageBytes(st);
  assert(u1 > u0, 'usageBytes grows after save');
  LIB.remove(st, a.id);
  assert(LIB.usageBytes(st) < u1, 'usageBytes shrinks after remove');
  const broken = { getItem: () => { throw new Error('nope'); }, setItem: () => { throw new Error('nope'); }, removeItem: () => {} };
  assert(LIB.available(broken) === false, 'throwing storage -> available false');
  assert(LIB.available(null) === false, 'null storage -> available false');
  assert(LIB.list(broken).length === 0, 'throwing storage -> list 0 (no throw)');
  const qe = new Error('The quota has been exceeded.'); qe.name = 'QuotaExceededError';
  assert(LIB.isQuotaError(qe) === true, 'isQuotaError detects QuotaExceededError');
  assert(LIB.isQuotaError(new Error('other')) === false, 'isQuotaError ignores other errors');
})();

console.log('\ntrace-library-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
