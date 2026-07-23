/* trace-validate.js
   こぎんトレース台エディタ T0 — 多色ラン抽出・float/偶数ランの位置つき検出・集計。
   ★ DOM / window を一切参照しない（Node単体テスト対象）。
   検証意味論=「同色連続＝1本の渡り」。色境界でランを切る（heartspot validator と同じ分割）。
   裏渡り検査は無し。奇数目則は警告のみ（ブロックしない）。
   ブラウザ: window.TraceValidate / Node: module.exports。 */
(function () {
  'use strict';

  function brkSet(breaksRow) {
    if (!breaksRow || !breaksRow.length) return null;
    var s = {}; for (var i = 0; i < breaksRow.length; i++) s[breaksRow[i]] = 1; return s;
  }

  // 1行から多色ランを抽出。色が変わったらランを切る。null で途切れる。
  // breaksRow を渡すと、切れ目エッジ（x-1↔x）でも同色ランを分割する（後方互換: 省略時は従来通り）。
  function extractRunsMulti(row, breaksRow) {
    var brk = brkSet(breaksRow);
    var runs = [];
    var x = 0, n = row.length;
    while (x < n) {
      var c = row[x];
      if (c == null) { x++; continue; }
      var start = x;
      x++;
      while (x < n && row[x] === c && !(brk && brk[x])) x++;
      runs.push({ colorId: c, start: start, len: x - start });
    }
    return runs;
  }

  // cells 全体を集計。opts.floatMax 超を floatViolations、偶数長を evenRuns に位置つきで列挙。
  // opts.breaks（{y:[x,...]}）を渡すと切れ目でランを分割して集計する（float違反の解消に効く）。
  function analyze(cells, opts) {
    opts = opts || {};
    var floatMax = (opts.floatMax != null) ? opts.floatMax : 7; // app は常に TRACE_CONFIG.floatMax を渡す
    var breaks = opts.breaks || null;
    var cellCount = 0, runCount = 0, maxRunLen = 0;
    var perColor = {};
    var usedColorIds = [];
    var floatViolations = [];
    var evenRuns = [];

    for (var y = 0; y < cells.length; y++) {
      var runs = extractRunsMulti(cells[y], breaks ? breaks[y] : null);
      for (var r = 0; r < runs.length; r++) {
        var run = runs[r];
        runCount++;
        cellCount += run.len;
        if (run.len > maxRunLen) maxRunLen = run.len;
        if (perColor[run.colorId] == null) { perColor[run.colorId] = 0; usedColorIds.push(run.colorId); }
        perColor[run.colorId] += run.len;
        if (run.len > floatMax) floatViolations.push({ y: y, start: run.start, len: run.len, colorId: run.colorId });
        if (run.len % 2 === 0) evenRuns.push({ y: y, start: run.start, len: run.len, colorId: run.colorId });
      }
    }

    return {
      cellCount: cellCount,
      runCount: runCount,
      perColor: perColor,
      usedColorIds: usedColorIds,
      maxRunLen: maxRunLen,
      floatViolations: floatViolations,
      evenRuns: evenRuns
    };
  }

  var api = { extractRunsMulti: extractRunsMulti, analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.TraceValidate = api; }
})();
