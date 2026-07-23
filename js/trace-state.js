/* trace-state.js
   こぎんトレース台エディタ T0 — ドキュメントモデル・編集純関数・undo/redo・シリアライズ。
   ★ DOM / window / document / canvas を一切参照しない（Node単体テスト対象）。
   ブラウザ: window.TraceState / Node: module.exports。 */
(function () {
  'use strict';

  // --- 設定解決（Node=require / ブラウザ=window.TRACE_CONFIG） -------------
  var CFG;
  if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
    CFG = require('./trace-config.js');
  } else if (typeof window !== 'undefined' && window.TRACE_CONFIG) {
    CFG = window.TRACE_CONFIG;
  } else {
    CFG = { gridLimit: { min: 3, max: 200 }, undoDepth: 50, cellAspect: 1.0, FABRICS: [{ id: 'navy' }] };
  }

  var GMIN = CFG.gridLimit.min, GMAX = CFG.gridLimit.max;

  // --- 小道具 -------------------------------------------------------------
  function clampInt(v, lo, hi) {
    v = Math.round(Number(v));
    if (!isFinite(v)) v = lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }
  function sign(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }
  function emptyCells(w, h) {
    var rows = new Array(h);
    for (var y = 0; y < h; y++) {
      var row = new Array(w);
      for (var x = 0; x < w; x++) row[x] = null;
      rows[y] = row;
    }
    return rows;
  }
  function cloneCells(cells) {
    var out = new Array(cells.length);
    for (var y = 0; y < cells.length; y++) out[y] = cells[y].slice();
    return out;
  }
  function cloneGrid(g) { return { w: g.w, h: g.h, cellAspect: g.cellAspect }; }
  function cloneUnderlay(u) { return u ? JSON.parse(JSON.stringify(u)) : null; }
  // breaks = { "y": [x, ...] }（疎オーバーレイ）。x は「x-1 と x の間の切れ目」＝強制ラン開始の左端。
  function cloneBreaks(b) {
    var out = {};
    if (b) for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k) && b[k] && b[k].length) out[k] = b[k].slice();
    return out;
  }
  function cloneDoc(d) {
    return {
      version: d.version,
      updatedAt: d.updatedAt,
      grid: cloneGrid(d.grid),
      fabricId: d.fabricId,
      cells: cloneCells(d.cells),
      underlay: cloneUnderlay(d.underlay),
      breaks: cloneBreaks(d.breaks)
    };
  }
  function nowIso() {
    // JST(+09:00) の ISO 文字列。表示・保存用（updatedAt）。
    var d = new Date();
    var t = new Date(d.getTime() + 9 * 3600 * 1000);
    return t.toISOString().replace('Z', '+09:00');
  }

  // --- ドキュメント生成 ----------------------------------------------------
  function newDoc(w, h, cellAspect) {
    w = clampInt(w, GMIN, GMAX);   // 奇数丸めはしない（偶数寸法が実在）
    h = clampInt(h, GMIN, GMAX);
    if (cellAspect == null) cellAspect = CFG.cellAspect;
    var fabricId = (CFG.FABRICS && CFG.FABRICS[0]) ? CFG.FABRICS[0].id : 'navy';
    return {
      version: 1,
      updatedAt: nowIso(),
      grid: { w: w, h: h, cellAspect: cellAspect },
      fabricId: fabricId,
      cells: emptyCells(w, h),
      underlay: null,
      breaks: {}
    };
  }

  // --- break（切れ目）ヘルパ -------------------------------------------------
  // breaksRow を高速判定用の集合（{x:1}）へ。無ければ null。3導出関数が共有。
  function brkSet(breaksRow) {
    if (!breaksRow || !breaksRow.length) return null;
    var s = {}; for (var i = 0; i < breaksRow.length; i++) s[breaksRow[i]] = 1; return s;
  }
  function breaksRowOf(breaks, y) { var a = breaks && breaks[y]; return (a && a.length) ? a : null; }
  function hasBreakAt(breaks, y, x) { var a = breaks && breaks[y]; return !!(a && a.indexOf(x) >= 0); }
  function addBreak(breaks, y, x) {
    if (x < 1) return false;                       // x=0（行頭）には切れ目を置けない
    var a = breaks[y] || (breaks[y] = []);
    if (a.indexOf(x) >= 0) return false;
    a.push(x); a.sort(function (p, q) { return p - q; });
    return true;
  }
  function removeBreak(breaks, y, x) {
    var a = breaks[y]; if (!a) return false;
    var i = a.indexOf(x); if (i < 0) return false;
    a.splice(i, 1); if (!a.length) delete breaks[y];
    return true;
  }
  function toggleBreak(breaks, y, x) {
    if (hasBreakAt(breaks, y, x)) { removeBreak(breaks, y, x); return false; }
    addBreak(breaks, y, x); return true;
  }
  // 簡易掃除: 行 y の切れ目のうち、両隣どちらかが null（＝分割対象の渡りが無い）や
  // 枠外の x を削除する。セル消去・移動・寸法変更後に呼ぶ。
  function cleanBreaksRow(cells, breaks, y) {
    var a = breaks[y]; if (!a) return;
    var row = cells[y]; if (!row) { delete breaks[y]; return; }
    var w = row.length, kept = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x >= 1 && x <= w - 1 && row[x - 1] != null && row[x] != null) kept.push(x);
    }
    if (kept.length) breaks[y] = kept; else delete breaks[y];
  }
  // 寸法変更で範囲外になった切れ目を落とす（左上基準・行キーと x を new 範囲に丸める）。
  function clampBreaks(breaks, w, h) {
    var out = {};
    if (breaks) for (var k in breaks) if (Object.prototype.hasOwnProperty.call(breaks, k)) {
      var y = +k; if (y < 0 || y >= h) continue;
      var a = breaks[k], keep = [];
      for (var i = 0; i < a.length; i++) { var x = a[i]; if (x >= 1 && x <= w - 1) keep.push(x); }
      if (keep.length) out[k] = keep;
    }
    return out;
  }

  // 左上基準でセルを保持しつつ寸法変更。落ちた非nullセル数を dropped で返す。
  function resizeGrid(doc, w, h) {
    w = clampInt(w, GMIN, GMAX);
    h = clampInt(h, GMIN, GMAX);
    var oldCells = doc.cells;
    var oldH = oldCells.length;
    var oldW = oldH ? oldCells[0].length : 0;
    var next = emptyCells(w, h);
    var dropped = 0;
    for (var y = 0; y < oldH; y++) {
      for (var x = 0; x < oldW; x++) {
        var v = oldCells[y][x];
        if (v == null) continue;
        if (y < h && x < w) next[y][x] = v;
        else dropped++;
      }
    }
    var nd = cloneDoc(doc);
    nd.grid = { w: w, h: h, cellAspect: doc.grid.cellAspect };
    nd.cells = next;
    nd.breaks = clampBreaks(doc.breaks, w, h);
    // 縮小で片側が null になった切れ目も掃除
    for (var cy in nd.breaks) if (Object.prototype.hasOwnProperty.call(nd.breaks, cy)) cleanBreaksRow(nd.cells, nd.breaks, +cy);
    return { doc: nd, dropped: dropped };
  }

  // --- 編集（cells をその場で書き換える純手続き） -------------------------
  function paintRun(cells, y, x1, x2, colorId) {
    if (y < 0 || y >= cells.length) return;
    var w = cells[y].length;
    var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    if (lo < 0) lo = 0;
    if (hi > w - 1) hi = w - 1;
    for (var x = lo; x <= hi; x++) cells[y][x] = colorId;
  }

  // breaks を渡すと、消去で片側が null になった切れ目を同時に掃除する（後方互換: 省略時は cells のみ）。
  function eraseRange(cells, y, x1, x2, breaks) {
    if (y < 0 || y >= cells.length) return;
    var w = cells[y].length;
    var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    if (lo < 0) lo = 0;
    if (hi > w - 1) hi = w - 1;
    for (var x = lo; x <= hi; x++) cells[y][x] = null;
    if (breaks) cleanBreaksRow(cells, breaks, y);
  }

  // 長さ偶数のとき dir 方向へ1目伸ばす。枠外 or 長さ>floatMax なら1目縮める。奇数はそのまま。
  function oddSnapLen(x1, x2, dir, w, floatMax) {
    var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    var len = hi - lo + 1;
    if (len % 2 === 1) return [lo, hi];      // 奇数はそのまま
    if (dir >= 0) {
      var nhi = hi + 1;                       // 右へ伸ばす
      if (nhi <= w - 1 && (nhi - lo + 1) <= floatMax) return [lo, nhi];
      return [lo, hi - 1];                    // 伸ばせない→右を1目縮める
    } else {
      var nlo = lo - 1;                       // 左へ伸ばす
      if (nlo >= 0 && (hi - nlo + 1) <= floatMax) return [nlo, hi];
      return [lo + 1, hi];                    // 伸ばせない→左を1目縮める
    }
  }

  // 1行1目・傾き±1固定の階段セル列。長さ = min(|dx|,|dy|)+1。
  function diagonalCells(x0, y0, dx, dy) {
    var n = Math.min(Math.abs(dx), Math.abs(dy));
    var sx = sign(dx), sy = sign(dy);
    var out = [];
    for (var i = 0; i <= n; i++) out.push({ x: x0 + i * sx, y: y0 + i * sy });
    return out;
  }

  // (x,y) を含む同色連続ラン。null なら null を返す。
  // breaksRow を渡すと、切れ目エッジでもランを切る（後方互換: 省略時は色/null のみで切る）。
  function runAt(cells, x, y, breaksRow) {
    if (y < 0 || y >= cells.length) return null;
    var row = cells[y];
    if (x < 0 || x >= row.length) return null;
    var colorId = row[x];
    if (colorId == null) return null;
    var brk = brkSet(breaksRow);
    var start = x;
    while (start - 1 >= 0 && row[start - 1] === colorId && !(brk && brk[start])) start--;
    var end = x;
    while (end + 1 < row.length && row[end + 1] === colorId && !(brk && brk[end + 1])) end++;
    return { y: y, start: start, len: end - start + 1, colorId: colorId };
  }

  // ラン全体を dx,dy 平行移動。はみ出す移動は拒否（無変化）。
  // breaks を渡すと移動後に旧行/新行の切れ目を掃除（切れ目は移動に引き継がない＝簡易規則）。
  function moveRun(cells, run, dx, dy, breaks) {
    var ny = run.y + dy;
    var nStart = run.start + dx;
    var nEnd = nStart + run.len - 1;
    if (ny < 0 || ny >= cells.length) return;
    if (nStart < 0 || nEnd > cells[ny].length - 1) return;
    // 旧区間クリア → 新区間書込（同一行の重なりでも順序上正しく残る）
    for (var x = run.start; x < run.start + run.len; x++) cells[run.y][x] = null;
    for (var nx = nStart; nx <= nEnd; nx++) cells[ny][nx] = run.colorId;
    if (breaks) { cleanBreaksRow(cells, breaks, run.y); if (ny !== run.y) cleanBreaksRow(cells, breaks, ny); }
  }

  // ラン端の伸縮。edge='L'|'R'、delta=±1。長さ1未満になる縮小は無視。枠外への伸長は無視。
  function resizeRun(cells, run, edge, delta) {
    var row = cells[run.y];
    var start = run.start, end = run.start + run.len - 1;
    if (edge === 'R') {
      if (delta > 0) {
        if (end + 1 <= row.length - 1) row[end + 1] = run.colorId;
      } else {
        if (run.len > 1) row[end] = null;
      }
    } else { // 'L'
      if (delta > 0) {
        if (start - 1 >= 0) row[start - 1] = run.colorId;
      } else {
        if (run.len > 1) row[start] = null;
      }
    }
  }

  // 矩形を切り出す。範囲外は null。
  function copyRect(cells, x, y, w, h) {
    var clip = { w: w, h: h, cells: [] };
    for (var j = 0; j < h; j++) {
      var row = new Array(w);
      for (var i = 0; i < w; i++) {
        var gy = y + j, gx = x + i;
        if (gy >= 0 && gy < cells.length && gx >= 0 && gx < cells[gy].length) row[i] = cells[gy][gx];
        else row[i] = null;
      }
      clip.cells.push(row);
    }
    return clip;
  }

  // アンカー(ax,ay)左上に nx×ny 回スタンプ。offset=(i*(w+gapX), j*(h+gapY))。
  // clip の非nullセルのみ書く（null透過）。グリッド外は黙って捨てる。written=書いたセル数。
  function repeatPaste(cells, clip, ax, ay, nx, ny, gapX, gapY) {
    var written = 0;
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var ox = ax + i * (clip.w + gapX);
        var oy = ay + j * (clip.h + gapY);
        for (var cy = 0; cy < clip.h; cy++) {
          for (var cx = 0; cx < clip.w; cx++) {
            var v = clip.cells[cy][cx];
            if (v == null) continue;
            var gx = ox + cx, gy = oy + cy;
            if (gy < 0 || gy >= cells.length) continue;
            if (gx < 0 || gx >= cells[gy].length) continue;
            cells[gy][gx] = v;
            written++;
          }
        }
      }
    }
    return written;
  }

  // --- シリアライズ --------------------------------------------------------
  function serialize(doc) { return JSON.stringify(doc); }
  function deserialize(str) {
    var obj = JSON.parse(str); // 不正JSONは JSON.parse が throw
    if (!obj || typeof obj !== 'object') throw new Error('不正なドキュメントです');
    if (obj.version !== 1) throw new Error('未対応のバージョンです: ' + obj.version);
    if (!obj.grid || !Array.isArray(obj.cells)) throw new Error('grid/cells がありません');
    if (obj.underlay === undefined) obj.underlay = null;
    if (!obj.fabricId) obj.fabricId = (CFG.FABRICS && CFG.FABRICS[0]) ? CFG.FABRICS[0].id : 'navy';
    if (!obj.breaks || typeof obj.breaks !== 'object') obj.breaks = {};  // 後方互換: 無ければ空
    return obj;
  }

  // --- undo/redo（{grid, cells} のスナップショット） ----------------------
  // underlay の移動/透過は undo 対象外（cells 編集のみ記録）。
  function DocStore(doc) {
    var cur = cloneDoc(doc);        // 作業コピー（呼び出し側の入力を破壊しない）
    var past = [];                  // [{grid, cells}]
    var future = [];
    var baseline = snap(cur);       // 直近コミット時点のスナップショット
    var depth = CFG.undoDepth || 50;

    function snap(d) { return { grid: cloneGrid(d.grid), cells: cloneCells(d.cells), breaks: cloneBreaks(d.breaks) }; }
    function apply(s) { cur.grid = cloneGrid(s.grid); cur.cells = cloneCells(s.cells); cur.breaks = cloneBreaks(s.breaks); }

    return {
      commit: function (/* label */) {
        past.push(baseline);
        if (past.length > depth) past.shift();
        baseline = snap(cur);
        future = [];
      },
      undo: function () {
        if (!past.length) return false;
        future.push(snap(cur));
        apply(past.pop());
        baseline = snap(cur);
        return true;
      },
      redo: function () {
        if (!future.length) return false;
        past.push(snap(cur));
        apply(future.pop());
        baseline = snap(cur);
        return true;
      },
      canUndo: function () { return past.length > 0; },
      canRedo: function () { return future.length > 0; },
      current: function () { return cur; },
      // 明示的に doc 全体を置き換える（読込・寸法変更・新規時）。履歴はリセット。
      replace: function (nextDoc) {
        cur = cloneDoc(nextDoc);
        past = []; future = []; baseline = snap(cur);
      }
    };
  }

  var api = {
    newDoc: newDoc,
    resizeGrid: resizeGrid,
    paintRun: paintRun,
    eraseRange: eraseRange,
    oddSnapLen: oddSnapLen,
    diagonalCells: diagonalCells,
    runAt: runAt,
    moveRun: moveRun,
    resizeRun: resizeRun,
    copyRect: copyRect,
    repeatPaste: repeatPaste,
    serialize: serialize,
    deserialize: deserialize,
    DocStore: DocStore,
    // break（切れ目）API
    addBreak: addBreak,
    removeBreak: removeBreak,
    toggleBreak: toggleBreak,
    hasBreakAt: hasBreakAt,
    breaksRowOf: breaksRowOf,
    cleanBreaksRow: cleanBreaksRow,
    clampBreaks: clampBreaks,
    // 補助（app/render 用）
    cloneDoc: cloneDoc,
    cloneCells: cloneCells,
    cloneBreaks: cloneBreaks,
    emptyCells: emptyCells
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.TraceState = api; }
})();
