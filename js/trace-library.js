/* trace-library.js
   #19（R5）ブラウザ内保存ライブラリの純ロジック層。
   localStorage を「注入されるstorage」として扱い（getItem/setItem/removeItem のみ使用）、
   Node からも fake storage でテストできる。DOM・canvas には一切触らない（サムネ生成は app 側）。

   キー構成:
     kogin-trace-library-v1        索引 { v:1, items:[ {id,name,savedAt,w,h,cellCount,thumb} ] }
     kogin-trace-doc-v1:<id>       本体（TraceState.serialize の文字列）
   索引と本体を分けるのは、保存1件ごとに全件を書き直さないため（容量・速度）。
   サムネは索引側に持つ（一覧描画で本体を読まない＝軽い）。 */
(function () {
  'use strict';

  var INDEX_KEY = 'kogin-trace-library-v1';
  var DOC_PREFIX = 'kogin-trace-doc-v1:';
  var MAX_NAME = 60;

  function isQuotaError(e) {
    if (!e) return false;
    var n = e.name || '';
    if (n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
    if (e.code === 22 || e.code === 1014) return true;
    return /quota|exceeded|容量/i.test(e.message || '');
  }

  function emptyIndex() { return { v: 1, items: [] }; }

  // 索引の読み出し。壊れていても throw せず空索引を返す（保存機能ごと死なせない）。
  function readIndex(storage) {
    try {
      var raw = storage.getItem(INDEX_KEY);
      if (!raw) return emptyIndex();
      var o = JSON.parse(raw);
      if (!o || !Array.isArray(o.items)) return emptyIndex();
      var items = [];
      for (var i = 0; i < o.items.length; i++) {
        var it = o.items[i];
        if (it && typeof it.id === 'string') items.push(it);
      }
      return { v: 1, items: items };
    } catch (e) { return emptyIndex(); }
  }

  function writeIndex(storage, idx) { storage.setItem(INDEX_KEY, JSON.stringify({ v: 1, items: idx.items })); }

  function docKey(id) { return DOC_PREFIX + id; }

  // 新しい順（savedAt 降順）の一覧。索引の生配列は書き換えない。
  function list(storage) {
    var items = readIndex(storage).items.slice();
    items.sort(function (a, b) { return String(b.savedAt || '').localeCompare(String(a.savedAt || '')); });
    return items;
  }

  function find(storage, id) {
    var items = readIndex(storage).items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function newId(seed) {
    var t = (seed || Date.now()).toString(36);
    return 'd' + t + Math.floor(Math.random() * 1679616).toString(36);
  }

  function cleanName(name, fallback) {
    var s = (name == null ? '' : String(name)).replace(/[\r\n\t]/g, ' ').trim();
    if (!s) s = fallback || '無題';
    if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME);
    return s;
  }

  /* 保存（新規 or 上書き）。
     entry = { id?, name, docStr, savedAt, w, h, cellCount, thumb }
     戻り: { ok:true, id, items } / { ok:false, reason:'quota'|'error'|'bad', message }
     容量超過は握りつぶさず reason:'quota' を返す（UI側でメッセージ表示）。
     途中失敗時は書きかけを巻き戻す（孤児の本体キー・不整合な索引を残さない）。 */
  function save(storage, entry) {
    if (!entry || typeof entry.docStr !== 'string' || !entry.docStr) return { ok: false, reason: 'bad', message: '保存する内容がありません' };
    var idx = readIndex(storage);
    var isNew = !entry.id;
    var id = entry.id || newId();
    var pos = -1;
    for (var i = 0; i < idx.items.length; i++) if (idx.items[i].id === id) { pos = i; break; }
    if (!isNew && pos < 0) return { ok: false, reason: 'bad', message: '保存先が見つかりません（削除済みかもしれません）' };

    var prevBody = pos >= 0 ? storage.getItem(docKey(id)) : null;
    var prevItem = pos >= 0 ? idx.items[pos] : null;
    var meta = {
      id: id,
      name: cleanName(entry.name, prevItem ? prevItem.name : '無題'),
      savedAt: entry.savedAt || new Date().toISOString(),
      createdAt: (prevItem && prevItem.createdAt) || entry.savedAt || new Date().toISOString(),
      w: entry.w || 0, h: entry.h || 0,
      cellCount: entry.cellCount || 0,
      thumb: entry.thumb || ''
    };
    if (pos >= 0) idx.items[pos] = meta; else idx.items.push(meta);

    try {
      storage.setItem(docKey(id), entry.docStr);
    } catch (e) {
      return { ok: false, reason: isQuotaError(e) ? 'quota' : 'error', message: e.message || String(e) };
    }
    try {
      writeIndex(storage, idx);
    } catch (e2) {
      // 索引が書けない＝この保存は成立しない。本体を元に戻す（新規なら消す）。
      try { if (prevBody == null) storage.removeItem(docKey(id)); else storage.setItem(docKey(id), prevBody); } catch (e3) {}
      return { ok: false, reason: isQuotaError(e2) ? 'quota' : 'error', message: e2.message || String(e2) };
    }
    return { ok: true, id: id, items: list(storage) };
  }

  // 本体の読み出し（無ければ null）。
  function load(storage, id) {
    if (!id) return null;
    try { return storage.getItem(docKey(id)); } catch (e) { return null; }
  }

  // 削除（本体＋索引）。索引に無い id でも本体キーは消す。
  function remove(storage, id) {
    var idx = readIndex(storage);
    var next = [];
    for (var i = 0; i < idx.items.length; i++) if (idx.items[i].id !== id) next.push(idx.items[i]);
    try { storage.removeItem(docKey(id)); } catch (e) {}
    try { writeIndex(storage, { v: 1, items: next }); }
    catch (e2) { return { ok: false, reason: isQuotaError(e2) ? 'quota' : 'error', message: e2.message || String(e2) }; }
    return { ok: true, items: list(storage) };
  }

  // 概算バイト数（索引＋本体の文字数合計・UI表示用の目安）。
  function usageBytes(storage) {
    var total = 0;
    try {
      var raw = storage.getItem(INDEX_KEY); total += raw ? raw.length : 0;
      var items = readIndex(storage).items;
      for (var i = 0; i < items.length; i++) { var b = storage.getItem(docKey(items[i].id)); total += b ? b.length : 0; }
    } catch (e) {}
    return total;
  }

  // storage が実際に使えるか（プライベートモード・容量0・例外環境の判定）。
  function available(storage) {
    if (!storage) return false;
    var k = '__kogin_probe__';
    try { storage.setItem(k, '1'); storage.removeItem(k); return true; } catch (e) { return false; }
  }

  var api = {
    INDEX_KEY: INDEX_KEY,
    DOC_PREFIX: DOC_PREFIX,
    MAX_NAME: MAX_NAME,
    readIndex: readIndex,
    list: list,
    find: find,
    save: save,
    load: load,
    remove: remove,
    usageBytes: usageBytes,
    available: available,
    isQuotaError: isQuotaError,
    cleanName: cleanName,
    newId: newId,
    docKey: docKey
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.TraceLibrary = api; }
})();
