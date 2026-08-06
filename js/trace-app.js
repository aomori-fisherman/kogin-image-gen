/* trace-app.js
   こぎんトレース台エディタ T0 — 配線層（ツール・ポインタ・キーボード・パネル・保存）。
   マウスイベント方式（desktop優先／ヘッドレスの MouseEvent 合成に対応）。
   描画更新はドラッグ中 requestAnimationFrame でバッチ（§9.3）。
   window.TraceApp を test/デバッグ用に公開。 */
(function () {
  'use strict';

  var CFG = window.TRACE_CONFIG, S = window.TraceState, V = window.TraceValidate,
      R = window.TraceRender, C = window.TraceChart, IL = window.KoginImageLoader, SAMPLE = window.KoginSample,
      LIB = window.TraceLibrary;
  function $(id) { return document.getElementById(id); }

  var AUTOSAVE_KEY = 'kogin-trace-autosave-v1';
  // 末尾に break を追加（キー7）。underlay はキー6のまま（TOOLS[5]）。
  var TOOLS = ['pen', 'diag', 'eraser', 'select', 'rect', 'underlay', 'break'];
  // #12 文字キーのショートカット（P/D/E/R/M/U/B）。数字1〜7も従来どおり有効。
  var TOOL_KEYS = { p: 'pen', d: 'diag', e: 'eraser', r: 'select', m: 'rect', u: 'underlay', b: 'break' };
  var TOOL_NAMES = { pen: 'ペン（塗り）', diag: '斜線（補助）', eraser: '消しゴム', select: 'ラン選択', rect: '矩形選択', underlay: '下絵移動', break: '切れ目' };
  var TOOL_TIPS = {
    pen: '［P］ドラッグで連続塗り（自由方向・隙間なし）。Alt+クリックでスポイト。',
    diag: '［D］ドラッグで傾き±1の階段（1行1目）。',
    eraser: '［E］ドラッグで自由方向に消去（追従・隙間なし）。',
    select: '同色の渡り1本をクリック選択。矢印で移動/伸縮・パレットで再着色。',
    rect: 'ドラッグで矩形→左の「範囲選択の操作」でコピー/一括塗り/連続ペースト。',
    underlay: 'ドラッグで下絵移動・ホイールで拡縮（cellsには影響しません）。',
    break: '同色の渡りのマス境界をクリックで切れ目を打つ/消す（渡りを分割）。'
  };

  // ---- 状態 ----
  var store;
  var tool = CFG.defaultTool || 'pen';
  var activeColor = CFG.PALETTE[0].id;
  var zoom = CFG.zoom.init;
  var oddSnap = !!CFG.oddSnapDefault;
  var showGrid = true, show5 = true, showCenter = false, gridOpacity = 0.18;
  var lastVr = null, lastW = 0, lastH = 0;
  var selection = null, clip = null, rectSel = null, marquee = null;
  var ghostCells = null, ghostColor = null;
  var drag = null;
  var repeatMode = false, repeatParams = null;
  var autosaveTimer = null;
  // #12 デザインツール型の操作コア用の状態
  var spaceDown = false, altDown = false;   // Space=パン / Alt=スポイト の押下状態
  var pan = null;                            // {sx,sy,sl,st} パンドラッグ中
  var hoverCell = null;                      // {x,y,kind} ペン/消しゴムのホバーハイライト
  var underlayVisible = true;                // #14 下絵の表示ON/OFF（非表示でもデータは保持）
  var focusMode = false;                     // #17 全画面（フォーカス）モード
  // #19 ブラウザ内保存（ライブラリ）
  var libraryOpen = false;                   // 保存メニュー（モーダル）の表示状態
  var currentLibId = null;                   // いま開いている保存のid（上書き先の目印）
  var dirty = false;                         // 名前付き保存以後に編集されたか（一覧から開く前の確認に使う）

  // #13 下絵は zoom非依存の world単位で保持し、描画時に uf=zoom/ZREF で一律スケールしてグリッドと一体化する。
  function zref() { return CFG.zoom.init || 10; }
  function ufactor() { return zoom / zref(); }

  var CURSOR_BY_TOOL = { pen: 'pen', diag: 'pen', eraser: 'eraser', select: 'select', rect: 'rect', underlay: 'underlay', break: 'break' };
  var MODE_CLASSES = ['mode-pen', 'mode-eraser', 'mode-select', 'mode-rect', 'mode-underlay', 'mode-break', 'mode-pan', 'mode-panning', 'mode-eyedropper'];
  function setSvgCursor(mode) {
    var svg = $('trace-svg'); if (!svg || !svg.classList) return;
    for (var i = 0; i < MODE_CLASSES.length; i++) svg.classList.remove(MODE_CLASSES[i]);
    svg.classList.add('mode-' + mode);
  }
  function toolCursor() { return CURSOR_BY_TOOL[tool] || 'pen'; }

  function cur() { return store.current(); }
  function colorObj(id) { for (var i = 0; i < CFG.PALETTE.length; i++) if (CFG.PALETTE[i].id === id) return CFG.PALETTE[i]; return null; }
  function colorHex(id) { var c = colorObj(id); return c ? c.hex : '#4FB0C6'; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clampX(x) { return clamp(x, 0, cur().grid.w - 1); }
  function clampY(y) { return clamp(y, 0, cur().grid.h - 1); }
  function nowIso() { var d = new Date(); return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00'); }
  function stamp() { var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }

  // ---- 描画 ----
  function view(extra) {
    var cellW = zoom, cellH = zoom * (cur().grid.cellAspect || 1);
    var v = { cellW: cellW, cellH: cellH, uf: ufactor(), hideUnderlay: !underlayVisible, showGrid: showGrid, show5: show5, showCenter: showCenter, gridOpacity: gridOpacity, palette: CFG.PALETTE, fabrics: CFG.FABRICS, fabricHex: S.fabricHexOf(cur(), CFG) };
    if (extra) for (var k in extra) v[k] = extra[k];
    return v;
  }
  function analyzeNow() { lastVr = V.analyze(cur().cells, { floatMax: CFG.floatMax, breaks: cur().breaks }); return lastVr; }
  function applySvg(built) {
    var svg = $('trace-svg');
    svg.setAttribute('width', built.width); svg.setAttribute('height', built.height);
    svg.setAttribute('viewBox', built.viewBox); svg.innerHTML = built.innerHTML;
    lastW = built.width; lastH = built.height;
  }
  function overlays() { return { selection: selection, ghostCells: ghostCells, ghostColor: ghostColor, marquee: marquee, hoverCell: hoverCell }; }
  function renderFull() {
    analyzeNow();
    var ov = overlays(); ov.violations = lastVr.floatViolations; ov.evenRuns = lastVr.evenRuns;
    applySvg(R.build(cur(), view(ov)));
    updatePanel(); updateButtons();
  }
  function renderPreview() {
    var vr = lastVr || analyzeNow();
    var ov = overlays(); ov.violations = vr.floatViolations; ov.evenRuns = vr.evenRuns;
    applySvg(R.build(cur(), view(ov)));
  }
  var rafPrev = false, rafFull = false;
  function schedulePreview() { if (rafPrev) return; rafPrev = true; requestAnimationFrame(function () { rafPrev = false; renderPreview(); }); }
  function scheduleFull() { if (rafFull) return; rafFull = true; requestAnimationFrame(function () { rafFull = false; renderFull(); }); }

  function updatePanel() {
    var vr = lastVr;
    if ($('stat-cells')) $('stat-cells').textContent = vr.cellCount;
    if ($('stat-runs')) $('stat-runs').textContent = vr.runCount;
    if ($('stat-colors')) $('stat-colors').textContent = vr.usedColorIds.length;
    if ($('stat-maxrun')) $('stat-maxrun').textContent = vr.maxRunLen;
    var nf = vr.floatViolations.length, ne = vr.evenRuns.length;
    var fb = $('float-badge'); if (fb) { fb.textContent = 'float>7: ' + nf + '箇所'; fb.className = 'badge ' + (nf ? 'bad' : 'ok'); }
    var eb = $('even-badge'); if (eb) { eb.textContent = '偶数ラン: ' + ne + '箇所'; eb.className = 'badge ' + (ne ? 'warn' : 'ok'); }
    var pc = $('percolor');
    if (pc) {
      var html = '';
      for (var i = 0; i < vr.usedColorIds.length; i++) {
        var id = vr.usedColorIds[i], o = colorObj(id);
        html += '<span class="chip"><span class="dot" style="background:' + (o ? o.hex : '#888') + '"></span>' + (o ? o.name : id) + ' ' + vr.perColor[id] + '</span>';
      }
      pc.innerHTML = html || '<span style="color:#667">（刺し目なし）</span>';
    }
    var cb = $('btn-chart'), ch = $('chart-hint');
    if (cb) { cb.disabled = nf > 0; }
    if (ch) { ch.textContent = nf > 0 ? ('7目を超える渡りが' + nf + '箇所あります（チャート不可）') : ''; }
  }
  function updateButtons() {
    if ($('btn-undo')) $('btn-undo').disabled = !store.canUndo();
    if ($('btn-redo')) $('btn-redo').disabled = !store.canRedo();
    updateRectButtons();
  }
  // 導線ガード（#11）: rectSel/clip の有無で「押せない見た目」＋ホバーヒントを切替。
  // disabled属性は使わず is-disabled クラス＝click は発火させ、押下時に次の一手を提示する。
  function setDisabledLook(id, disabled, hint) {
    var el = $(id); if (!el) return;
    el.classList.toggle('is-disabled', !!disabled);
    if (hint) el.title = hint;
  }
  function updateRectButtons() {
    var hasRect = !!rectSel, hasClip = !!clip;
    var rectHint = '「矩形選択」(5) でドラッグして範囲を作ると使えます';
    setDisabledLook('btn-copy', !hasRect, rectHint);
    setDisabledLook('btn-rect-fill', !hasRect, rectHint);
    setDisabledLook('btn-rect-erase', !hasRect, rectHint);
    setDisabledLook('btn-repeat', !hasClip, hasRect ? '先に「コピー」してから連続ペースト' : rectHint);
    updateRepeatSteps();
  }
  // 連続ペーストの多段導線を可視化（今どの段か）。
  function updateRepeatSteps() {
    var s1 = document.querySelector('#repeat-steps li[data-step="1"]');
    var s2 = document.querySelector('#repeat-steps li[data-step="2"]');
    var s3 = document.querySelector('#repeat-steps li[data-step="3"]');
    if (!s1 || !s2 || !s3) return;
    var formOpen = $('repeat-form') && !$('repeat-form').classList.contains('hidden');
    s1.className = clip ? 'done' : (formOpen ? 'active' : '');
    s2.className = repeatMode ? 'done' : (clip && formOpen ? 'active' : '');
    s3.className = repeatMode ? 'active' : '';
  }

  // ---- 座標 ----
  function svgCell(e) {
    var svg = $('trace-svg'); var rect = svg.getBoundingClientRect();
    var sx = (e.clientX - rect.left) * (lastW / rect.width);
    var sy = (e.clientY - rect.top) * (lastH / rect.height);
    return R.cellAt(view(), sx, sy);
  }
  // 切れ目ツール用: 最寄りの縦マス境界 bx（x-1↔x の間）と行 y を返す。
  function svgBoundary(e) {
    var svg = $('trace-svg'); var rect = svg.getBoundingClientRect();
    var sx = (e.clientX - rect.left) * (lastW / rect.width);
    var sy = (e.clientY - rect.top) * (lastH / rect.height);
    var cw = zoom, ch = zoom * (cur().grid.cellAspect || 1);
    return { bx: Math.round((sx - R.PAD) / cw), y: Math.floor((sy - R.PAD) / ch) };
  }
  // 切れ目を打つ/消す（同色ランの上のマス境界のみ有効）。
  function toggleBreakAt(bx, y) {
    var w = cur().grid.w, h = cur().grid.h;
    if (y < 0 || y >= h) return;
    if (bx < 1 || bx > w - 1) { setStatus('切れ目はマスとマスの境界に打てます'); return; }
    var row = cur().cells[y];
    if (row[bx - 1] == null || row[bx] == null || row[bx - 1] !== row[bx]) {
      setStatus('同色の渡りの上でマス境界をクリックしてください（切れ目は同色ランを分割します）');
      return;
    }
    var on = S.toggleBreak(cur().breaks, y, bx);
    store.commit('break'); renderFull(); scheduleAutosave();
    setStatus(on ? ('切れ目を追加（行' + y + '・' + (bx - 1) + '↔' + bx + '）') : '切れ目を削除しました');
  }

  // ---- ズーム/パン/スポイト（#12・デザインツール型） ----
  // client座標 → 分数セル（現在のズーム基準）。カーソル中心ズームの基準点。
  function clientToWorld(clientX, clientY) {
    var svg = $('trace-svg'); var rect = svg.getBoundingClientRect();
    var sx = (clientX - rect.left) * (lastW / (rect.width || lastW || 1));
    var sy = (clientY - rect.top) * (lastH / (rect.height || lastH || 1));
    var cw = zoom, ch = zoom * (cur().grid.cellAspect || 1);
    return { wx: (sx - R.PAD) / cw, wy: (sy - R.PAD) / ch };
  }
  // world（分数セル）が client(px) の位置に来るようスクロール＝カーソル固定ズーム。
  function scrollWorldToClient(wx, wy, clientX, clientY) {
    var wrap = $('canvas-wrap'); if (!wrap) return;
    var cw = zoom, ch = zoom * (cur().grid.cellAspect || 1);
    var sx = R.PAD + wx * cw, sy = R.PAD + wy * ch;
    var wr = wrap.getBoundingClientRect();
    wrap.scrollLeft = sx - (clientX - wr.left - (wrap.clientLeft || 0));
    wrap.scrollTop = sy - (clientY - wr.top - (wrap.clientTop || 0));
  }
  function scrollToOrigin() { var wrap = $('canvas-wrap'); if (wrap) { wrap.scrollLeft = 0; wrap.scrollTop = 0; } }
  // ズーム設定。cx,cy を渡すとその client点を固定してズーム（ホイール用）。
  function setZoom(z, cx, cy) {
    var before = (cx != null && cy != null) ? clientToWorld(cx, cy) : null;
    var nz = clamp(Math.round(z), CFG.zoom.min, CFG.zoom.max);
    if (nz === zoom && before) return;   // 端で無変化なら何もしない
    zoom = nz;
    renderFull(); syncGridControls();
    if (before) scrollWorldToClient(before.wx, before.wy, cx, cy);
  }
  function zoomBy(dir, cx, cy) {
    var f = dir > 0 ? 1.15 : 1 / 1.15;
    var target = zoom * f;
    target = dir > 0 ? Math.max(target, zoom + 1) : Math.min(target, zoom - 1); // 端付近でも必ず1目動く
    setZoom(target, cx, cy);
  }
  function zoomReset100() { setZoom(CFG.zoom.init); scrollToOrigin(); }
  function zoomFit() {
    var wrap = $('canvas-wrap'); var g = cur().grid;
    if (!wrap || !wrap.clientWidth) { setZoom(CFG.zoom.init); return; }
    var availW = wrap.clientWidth - R.PAD * 2 - 6;
    var availH = wrap.clientHeight - R.PAD * 2 - 6;
    var zw = availW / g.w, zh = availH / (g.h * (g.cellAspect || 1));
    setZoom(Math.floor(Math.min(zw, zh)));
    scrollToOrigin();
  }
  // パン（Space+ドラッグ / 中ボタンドラッグ）＝どのツールでも効く。
  function startPan(e) {
    var wrap = $('canvas-wrap');
    pan = { sx: e.clientX, sy: e.clientY, sl: wrap ? wrap.scrollLeft : 0, st: wrap ? wrap.scrollTop : 0 };
    setSvgCursor('panning');
  }
  function doPan(e) {
    var wrap = $('canvas-wrap'); if (!wrap) return;
    wrap.scrollLeft = pan.sl - (e.clientX - pan.sx);
    wrap.scrollTop = pan.st - (e.clientY - pan.sy);
  }
  // スポイト（Alt+クリック）: 塗られたマスの色をペン色に取得。常に handled 扱い（塗らせない）。
  function pickColorAt(x, y) {
    if (x < 0 || y < 0 || x >= cur().grid.w || y >= cur().grid.h) return;
    var id = cur().cells[y][x];
    if (id == null) { setStatus('スポイト: 空マスです（塗られたマスを Alt+クリック）'); return; }
    setActiveColor(id);
    var o = colorObj(id); setStatus('スポイト: ' + (o ? o.name : id) + ' を取得しました');
  }

  // ---- 連続塗り/消し（ドラッグ追従・線分補間・#12） ----
  function paintCell(x, y, d) {
    if (x < 0 || y < 0 || x >= cur().grid.w || y >= cur().grid.h) return;
    var k = x + ',' + y; if (d.done[k]) return; d.done[k] = 1;   // 同一セル重複塗り抑止
    cur().cells[y][x] = activeColor;
    if (y !== d.y0) d.singleRow = false;
    else { if (x < d.minX) d.minX = x; if (x > d.maxX) d.maxX = x; }
  }
  function eraseCell(x, y, d) {
    if (x < 0 || y < 0 || x >= cur().grid.w || y >= cur().grid.h) return;
    var k = x + ',' + y; if (d.done[k]) return; d.done[k] = 1;
    S.eraseRange(cur().cells, y, x, x, cur().breaks);
  }
  // 単一行の連続塗りにだけ奇数スナップを適用（端を±1調整）。多行ストロークには不適用。
  function applyOddSnapToStroke(d) {
    var y = d.y0, lo = d.minX, hi = d.maxX, row = cur().cells[y];
    var dir = (d.lastX - d.x0) >= 0 ? 1 : -1;
    var sn = S.oddSnapLen(lo, hi, dir, cur().grid.w, CFG.floatMax);
    if (sn[0] < lo) row[sn[0]] = activeColor; else if (sn[0] > lo) row[lo] = null;
    if (sn[1] > hi) row[sn[1]] = activeColor; else if (sn[1] < hi) row[hi] = null;
  }
  // ホバーハイライト（ペン/消しゴムのみ・「今どこに塗る/消すか」を可視化）。
  function updateHover(e) {
    if (tool !== 'pen' && tool !== 'eraser') { if (hoverCell) { hoverCell = null; schedulePreview(); } return; }
    var c = svgCell(e);
    if (c.x < 0 || c.y < 0 || c.x >= cur().grid.w || c.y >= cur().grid.h) { if (hoverCell) { hoverCell = null; schedulePreview(); } return; }
    if (!hoverCell || hoverCell.x !== c.x || hoverCell.y !== c.y || hoverCell.kind !== tool) {
      hoverCell = { x: c.x, y: c.y, kind: tool }; schedulePreview();
    }
  }

  // ---- ペン ゴースト ----
  function penRange() {
    var lo = Math.min(drag.x1, drag.x2), hi = Math.max(drag.x1, drag.x2);
    if (oddSnap) { var dir = Math.sign(drag.x2 - drag.x1) || 1; var sn = S.oddSnapLen(lo, hi, dir, cur().grid.w, CFG.floatMax); lo = sn[0]; hi = sn[1]; }
    return [lo, hi];
  }
  function setPenGhost() {
    var r = penRange(); ghostCells = []; for (var x = r[0]; x <= r[1]; x++) ghostCells.push({ x: x, y: drag.y }); ghostColor = colorHex(activeColor);
  }
  function setDiagGhost() { ghostCells = S.diagonalCells(drag.x0, drag.y0, drag.dx, drag.dy); ghostColor = colorHex(activeColor); }
  function repeatGhost(ax, ay) {
    var out = [];
    for (var j = 0; j < repeatParams.ny; j++) for (var i = 0; i < repeatParams.nx; i++) {
      var ox = ax + i * (clip.w + repeatParams.gx), oy = ay + j * (clip.h + repeatParams.gy);
      for (var cy = 0; cy < clip.h; cy++) for (var cx = 0; cx < clip.w; cx++) {
        if (clip.cells[cy][cx] == null) continue;
        out.push({ x: ox + cx, y: oy + cy });
      }
    }
    return out;
  }

  // ---- マウス ----
  function onMouseDown(e) {
    // パン（中ボタン or Space）＝どのツールでも最優先
    if (e.button === 1 || spaceDown) { startPan(e); return; }
    // スポイト（Alt+クリック）＝塗られたマスの色を取得（塗らない）
    if (e.altKey) { var pc = svgCell(e); pickColorAt(pc.x, pc.y); return; }
    if (repeatMode) { var c0 = svgCell(e); var wri = S.repeatPaste(cur().cells, clip, c0.x, c0.y, repeatParams.nx, repeatParams.ny, repeatParams.gx, repeatParams.gy); store.commit('repeat'); repeatMode = false; ghostCells = null; renderFull(); scheduleAutosave(); setStatus('連続ペースト: ' + wri + '目を配置'); return; }
    if (tool === 'break') { var b = svgBoundary(e); toggleBreakAt(b.bx, b.y); return; }
    var c = svgCell(e);
    if (c.x < 0 || c.y < 0 || c.x >= cur().grid.w || c.y >= cur().grid.h) { if (tool !== 'underlay') return; }
    hoverCell = null;
    if (tool === 'pen') {
      var px = clampX(c.x), py = clampY(c.y);
      drag = { mode: 'pen', done: {}, lastX: px, lastY: py, x0: px, y0: py, minX: px, maxX: px, singleRow: true };
      paintCell(px, py, drag); scheduleFull();
    }
    else if (tool === 'diag') { drag = { mode: 'diag', x0: clampX(c.x), y0: clampY(c.y), dx: 0, dy: 0 }; setDiagGhost(); schedulePreview(); }
    else if (tool === 'eraser') {
      var ex = clampX(c.x), ey = clampY(c.y);
      drag = { mode: 'eraser', done: {}, lastX: ex, lastY: ey };
      eraseCell(ex, ey, drag); scheduleFull();
    }
    else if (tool === 'select') { selection = S.runAt(cur().cells, clampX(c.x), clampY(c.y), S.breaksRowOf(cur().breaks, clampY(c.y))); renderFull(); }
    else if (tool === 'rect') { drag = { mode: 'rect' }; marquee = { x0: clampX(c.x), y0: clampY(c.y), x1: clampX(c.x), y1: clampY(c.y) }; rectSel = null; schedulePreview(); }
    else if (tool === 'underlay') { if (cur().underlay) drag = { mode: 'underlay', sx: e.clientX, sy: e.clientY, ox: cur().underlay.x, oy: cur().underlay.y }; }
  }
  function onMouseMove(e) {
    if (pan) { doPan(e); return; }
    if (repeatMode) { var cc = svgCell(e); ghostCells = repeatGhost(cc.x, cc.y); ghostColor = '#E3A93D'; schedulePreview(); return; }
    if (!drag) { updateHover(e); return; }
    var c = svgCell(e);
    if (drag.mode === 'pen') {
      var nx = clampX(c.x), ny = clampY(c.y);
      var line = S.lineCells(drag.lastX, drag.lastY, nx, ny);   // 隙間なし補間
      for (var i = 0; i < line.length; i++) paintCell(line[i].x, line[i].y, drag);
      drag.lastX = nx; drag.lastY = ny; scheduleFull();
    }
    else if (drag.mode === 'diag') { drag.dx = clampX(c.x) - drag.x0; drag.dy = clampY(c.y) - drag.y0; setDiagGhost(); schedulePreview(); }
    else if (drag.mode === 'eraser') {
      var eex = clampX(c.x), eey = clampY(c.y);
      var line2 = S.lineCells(drag.lastX, drag.lastY, eex, eey);
      for (var j = 0; j < line2.length; j++) eraseCell(line2[j].x, line2[j].y, drag);
      drag.lastX = eex; drag.lastY = eey; scheduleFull();
    }
    else if (drag.mode === 'rect') { marquee.x1 = clampX(c.x); marquee.y1 = clampY(c.y); schedulePreview(); }
    else if (drag.mode === 'underlay') {
      var svg = $('trace-svg'); var rect = svg.getBoundingClientRect();
      var dx = (e.clientX - drag.sx) * (lastW / rect.width), dy = (e.clientY - drag.sy) * (lastH / rect.height);
      var uf = ufactor();   // #13 world単位で保持＝画面移動量(px)を uf で割って world量へ戻す
      cur().underlay.x = drag.ox + dx / uf; cur().underlay.y = drag.oy + dy / uf; schedulePreview();
    }
  }
  function onMouseUp() {
    if (pan) { pan = null; setSvgCursor(spaceDown ? 'pan' : toolCursor()); return; }
    if (!drag) return;
    if (drag.mode === 'pen') { if (oddSnap && drag.singleRow) applyOddSnapToStroke(drag); store.commit('pen'); ghostCells = null; drag = null; renderFull(); scheduleAutosave(); }
    else if (drag.mode === 'diag') { var cs = S.diagonalCells(drag.x0, drag.y0, drag.dx, drag.dy); for (var i = 0; i < cs.length; i++) { var p = cs[i]; if (p.x >= 0 && p.x < cur().grid.w && p.y >= 0 && p.y < cur().grid.h) cur().cells[p.y][p.x] = activeColor; } store.commit('diag'); ghostCells = null; drag = null; renderFull(); scheduleAutosave(); }
    else if (drag.mode === 'eraser') { store.commit('erase'); drag = null; renderFull(); scheduleAutosave(); }
    else if (drag.mode === 'rect') { var lo = Math.min(marquee.x0, marquee.x1), hi = Math.max(marquee.x0, marquee.x1), tp = Math.min(marquee.y0, marquee.y1), bt = Math.max(marquee.y0, marquee.y1); rectSel = { x: lo, y: tp, w: hi - lo + 1, h: bt - tp + 1 }; drag = null; renderFull(); setStatus('範囲: ' + rectSel.w + '×' + rectSel.h + '目'); }
    else if (drag.mode === 'underlay') { drag = null; scheduleAutosave(); }
  }
  function onWheel(e) {
    // 下絵移動ツール選択中（かつSpace非押下）＝ホイールで下絵拡縮（従来）。分離して衝突回避。
    if (tool === 'underlay' && cur().underlay && !spaceDown) {
      e.preventDefault(); var f = e.deltaY < 0 ? 1.1 : 1 / 1.1; cur().underlay.scale = clamp(cur().underlay.scale * f, 0.1, 10); renderPreview(); syncUnderlayControls(); scheduleAutosave(); return;
    }
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);   // カーソル位置中心ズーム
  }

  // ---- 選択ツール キーボード ----
  function moveSel(dx, dy) {
    var r = selection, w = cur().grid.w, h = cur().grid.h;
    var ny = r.y + dy, ns = r.start + dx, ne = ns + r.len - 1;
    if (ny < 0 || ny >= h || ns < 0 || ne > w - 1) return;
    S.moveRun(cur().cells, r, dx, dy, cur().breaks);   // 切れ目は移動に引き継がない
    selection = { y: ny, start: ns, len: r.len, colorId: r.colorId };
    store.commit('move'); renderFull(); scheduleAutosave();
  }
  function resizeSel(edge, delta) {
    var r = selection, mid = clamp(r.start + Math.floor(r.len / 2), 0, cur().grid.w - 1);
    S.resizeRun(cur().cells, r, edge, delta);
    var nr = S.runAt(cur().cells, mid, r.y, S.breaksRowOf(cur().breaks, r.y)); if (nr) selection = nr;
    store.commit('resize-run'); renderFull(); scheduleAutosave();
  }
  function deleteSel() {
    S.eraseRange(cur().cells, selection.y, selection.start, selection.start + selection.len - 1, cur().breaks);
    selection = null; store.commit('del'); renderFull(); scheduleAutosave();
  }
  function recolorSel(id) {
    S.paintRun(cur().cells, selection.y, selection.start, selection.start + selection.len - 1, id);
    selection.colorId = id; store.commit('recolor'); renderFull(); scheduleAutosave();
  }

  function onKey(e) {
    var t = e.target, tag = (t && t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') { if (e.key === 'Escape' && t.blur) t.blur(); return; }
    // #19 保存メニュー表示中はキャンバス側のショートカットを止める（Esc=メニューを閉じるだけ）
    if (libraryOpen) { if (e.key === 'Escape') { closeLibrary(); e.preventDefault(); } return; }
    // Space=パン押下状態（ページスクロール抑止）
    if (e.key === ' ' || e.code === 'Space') { if (!spaceDown) { spaceDown = true; if (!pan && !drag) setSvgCursor('pan'); } e.preventDefault(); return; }
    // Alt=スポイト（カーソルヒントのみ・機能は mousedown の altKey で判定）
    if (e.key === 'Alt') { if (!altDown) { altDown = true; if (!pan && !drag) setSvgCursor('eyedropper'); } return; }
    // Esc=進行中の操作（矩形選択・連続ペースト・切れ目・パン・選択）をキャンセルして既定ツールへ（#12）
    if (e.key === 'Escape') {
      if (focusMode) { setFocusMode(false); return; }   // #17 全画面中はまず全画面を解除（ツールは保持）。次のEscで通常のキャンセルへ。
      pan = null; drag = null; ghostCells = null; repeatMode = false; marquee = null; rectSel = null; selection = null; hoverCell = null;
      if ($('repeat-form')) $('repeat-form').classList.add('hidden');
      var def = CFG.defaultTool || 'pen';
      if (tool !== def) setTool(def); else setSvgCursor(toolCursor());
      renderFull();
      return;
    }
    // ツールショートカット: 文字キー（P/D/E/R/M/U/B）と数字1〜7
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      var kl = (e.key || '').toLowerCase();
      if (kl === 'h') { toggleUnderlayVisible(); e.preventDefault(); return; }   // #14 下絵の表示ON/OFF
      if (kl === 'f') { toggleFocusMode(); e.preventDefault(); return; }         // #17 全画面（フォーカス）モードのトグル
      if (TOOL_KEYS[kl]) { setTool(TOOL_KEYS[kl]); e.preventDefault(); return; }
      if (e.key >= '1' && e.key <= '7') { var ti = +e.key - 1; if (TOOLS[ti]) setTool(TOOLS[ti]); e.preventDefault(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { doUndo(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { doRedo(); e.preventDefault(); return; }
    if (tool === 'select' && selection) {
      var k = e.key;
      if (k === 'Delete' || k === 'Backspace') { deleteSel(); e.preventDefault(); return; }
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        if (e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { resizeSel('R', k === 'ArrowRight' ? 1 : -1); return; }
        if (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { resizeSel('L', k === 'ArrowLeft' ? 1 : -1); return; }
        var dx = 0, dy = 0;
        if (k === 'ArrowLeft') dx = -1; else if (k === 'ArrowRight') dx = 1; else if (k === 'ArrowUp') dy = -1; else dy = 1;
        moveSel(dx, dy); return;
      }
    }
    // #18(b) 下絵移動ツール中の矢印キー: 下絵位置を world単位で微調整（Shiftで1マス=ZREF）。cellsには影響しない。
    if (tool === 'underlay' && cur().underlay) {
      var uk = e.key;
      if (uk === 'ArrowLeft' || uk === 'ArrowRight' || uk === 'ArrowUp' || uk === 'ArrowDown') {
        e.preventDefault();
        var ustep = e.shiftKey ? zref() : 1;
        var udx = 0, udy = 0;
        if (uk === 'ArrowLeft') udx = -ustep; else if (uk === 'ArrowRight') udx = ustep;
        else if (uk === 'ArrowUp') udy = -ustep; else udy = ustep;
        moveUnderlayBy(udx, udy); return;
      }
    }
  }

  // Space/Alt の解放（押下状態とカーソルを戻す）。
  function onKeyUp(e) {
    if (e.key === ' ' || e.code === 'Space') { spaceDown = false; if (!pan && !drag) setSvgCursor(altDown ? 'eyedropper' : toolCursor()); }
    else if (e.key === 'Alt') { altDown = false; if (!pan && !drag) setSvgCursor(spaceDown ? 'pan' : toolCursor()); }
  }

  function doUndo() { if (store.undo()) { selection = null; renderFull(); scheduleAutosave(); } }
  function doRedo() { if (store.redo()) { selection = null; renderFull(); scheduleAutosave(); } }

  // ---- ツール・パレット ----
  function setTool(t) {
    tool = t; drag = null; ghostCells = null; hoverCell = null;
    if (t !== 'select') selection = selection; // 選択は保持
    for (var i = 0; i < TOOLS.length; i++) { var b = $('tool-' + TOOLS[i]); if (b) b.classList.toggle('active', TOOLS[i] === t); }
    // #20 キャンバス上部バーのツール選択（旧 cur-tool-name の表示役を兼ねる＝選択中がそのまま見える）。
    if ($('tool-picker') && $('tool-picker').value !== t) $('tool-picker').value = t;
    if ($('cur-tool-name')) $('cur-tool-name').textContent = TOOL_NAMES[t] || t;   // 旧表示が残る構成でも壊れないよう保持
    if ($('tool-tip')) $('tool-tip').textContent = TOOL_TIPS[t] || '';
    setSvgCursor(spaceDown ? 'pan' : (altDown ? 'eyedropper' : (CURSOR_BY_TOOL[t] || 'pen')));
    renderPreview();
  }
  function setActiveColor(id) {
    activeColor = id;
    var sws = document.querySelectorAll('.sw');
    for (var i = 0; i < sws.length; i++) sws[i].classList.toggle('active', sws[i].getAttribute('data-id') === id);
    var o = colorObj(id);
    if ($('active-color')) $('active-color').innerHTML = o ? ('選択中: <b>' + o.name + '</b> ' + (o.code || '')) : '—';
  }
  // #20 キャンバス上部バーのツール選択（元は現在ツール名の表示だけだった枠）。
  // 全画面（body.focus-mode）でも .canvas-toolbar は残るので、全画面/通常で同じ場所・同じ操作。
  // 切替は既存 setTool を呼ぶだけ（ツール切替ロジックは新設しない）。選択中は select の値＝現在ツールで見える。
  function buildToolSelect() {
    var el = $('tool-picker'); if (!el) return;
    var keyOf = {};
    for (var k in TOOL_KEYS) keyOf[TOOL_KEYS[k]] = k.toUpperCase();
    var html = '';
    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      html += '<option value="' + t + '">' + (TOOL_NAMES[t] || t) + '［' + (keyOf[t] || (i + 1)) + '］</option>';
    }
    el.innerHTML = html;
    el.value = tool;
    el.addEventListener('change', function () {
      var t = this.value;
      setTool(t);
      // フォーカスを残さない＝P/E/F/Esc などのショートカットが従来どおり効く（入力欄フォーカス中は onKey が無効化するため）。
      if (this.blur) this.blur();
      // ラン選択/矩形選択は全画面中だと「範囲選択の操作」パネルが隠れて次に進めない。
      // 無効化はせず（通常モードでは有効・モードで見た目を変えない）、ステータスバーで次の一手を出す。
      if (focusMode && (t === 'select' || t === 'rect')) setStatus('「' + TOOL_NAMES[t] + '」の範囲操作は Esc で全画面を抜けると左パネルに出ます');
      else setStatus('ツール: ' + (TOOL_NAMES[t] || t));
    });
  }
  function buildPalette() {
    var el = $('palette'); if (!el) return; var html = '';
    for (var i = 0; i < CFG.PALETTE.length; i++) { var p = CFG.PALETTE[i]; html += '<div class="sw" data-id="' + p.id + '" title="' + p.name + ' ' + (p.code || '') + '" style="background:' + p.hex + '"></div>'; }
    el.innerHTML = html;
    var sws = el.querySelectorAll('.sw');
    for (var j = 0; j < sws.length; j++) sws[j].addEventListener('click', function () {
      var id = this.getAttribute('data-id');
      if (tool === 'select' && selection) recolorSel(id); else setActiveColor(id);
    });
  }
  // 地布（R9）: プリセット＋「自由な色」（カラーピッカー）。選んだ色は画面・チャート（印刷/PNG）・サムネに共通で効く。
  var FABRIC_CUSTOM = CFG.FABRIC_CUSTOM_ID || 'custom';
  function buildFabricSelect() {
    var el = $('fabric-select'); if (!el) return; var html = '';
    for (var i = 0; i < CFG.FABRICS.length; i++) html += '<option value="' + CFG.FABRICS[i].id + '">' + CFG.FABRICS[i].name + '</option>';
    html += '<option value="' + FABRIC_CUSTOM + '">自由な色（右のパレットで選ぶ）</option>';
    el.innerHTML = html; el.value = cur().fabricId;
    el.addEventListener('change', function () {
      cur().fabricId = el.value;
      if (el.value === FABRIC_CUSTOM && !cur().fabricHex) cur().fabricHex = S.fabricHexOf(cur(), CFG);
      store.commit('fabric'); renderFull(); syncFabricControls(); scheduleAutosave();
    });
    var pick = $('fabric-color');
    if (pick) pick.addEventListener('input', function () {
      cur().fabricId = FABRIC_CUSTOM; cur().fabricHex = this.value;
      store.commit('fabric'); renderFull(); syncFabricControls(); scheduleAutosave();
    });
    syncFabricControls();
  }
  function syncFabricControls() {
    var hex = S.fabricHexOf(cur(), CFG);
    if ($('fabric-select')) $('fabric-select').value = cur().fabricId;
    if ($('fabric-color')) $('fabric-color').value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#1B2440';
    if ($('fabric-hex')) $('fabric-hex').textContent = hex;
  }
  function buildPresetSelect() {
    var el = $('preset-select'); if (!el) return; var html = '';
    for (var i = 0; i < CFG.PRESETS.length; i++) html += '<option value="' + CFG.PRESETS[i].id + '">' + CFG.PRESETS[i].name + '</option>';
    el.innerHTML = html;
    el.addEventListener('change', function () {
      var p = CFG.PRESETS.filter(function (x) { return x.id === el.value; })[0];
      if (p && p.w && p.h) { applyResize(p.w, p.h); }
    });
  }

  // ---- グリッド ----
  function applyResize(w, h) {
    var res = S.resizeGrid(cur(), w, h);
    if (res.dropped > 0 && !window.confirm(res.dropped + '個の刺し目が範囲外になり消えます。続けますか？')) { syncGridControls(); return; }
    cur().grid = res.doc.grid; cur().cells = res.doc.cells; cur().breaks = res.doc.breaks;
    selection = null; marquee = null; rectSel = null;
    store.commit('resize'); renderFull(); syncGridControls(); scheduleAutosave();
  }
  function syncGridControls() {
    var g = cur().grid;
    if ($('grid-w')) $('grid-w').value = g.w;
    if ($('grid-h')) $('grid-h').value = g.h;
    if ($('grid-w-top')) $('grid-w-top').value = g.w;   // #16 上部リボンの数値入力と同期
    if ($('grid-h-top')) $('grid-h-top').value = g.h;
    if ($('cell-aspect')) $('cell-aspect').value = g.cellAspect;
    if ($('aspect-val')) $('aspect-val').textContent = Number(g.cellAspect).toFixed(2);
    if ($('zoom-val')) $('zoom-val').textContent = zoom;
    if ($('gridop-val')) $('gridop-val').textContent = Math.round(gridOpacity * 100) + '%';
    syncFabricControls();
  }

  // ---- 下絵 ----
  function centerUnderlay() {
    var u = cur().underlay; if (!u) return;
    // #13 world単位（zoom非依存・ZREF基準）で中央寄せ。どのズームでも下絵中心＝グリッド中心が一致。
    var ZR = zref(), asp = cur().grid.cellAspect || 1;
    u.x = (cur().grid.w * ZR) / 2 - (u.w * u.scale) / 2;
    u.y = (cur().grid.h * asp * ZR) / 2 - (u.h * u.scale) / 2;
  }
  function setUnderlay(canvas, w, h) {
    var op = $('underlay-opacity') ? ($('underlay-opacity').value / 100) : 0.5;
    cur().underlay = { dataURL: canvas.toDataURL('image/png'), x: 0, y: 0, scale: 1, rotateDeg: 0, opacity: op, grayscale: $('chk-grayscale') ? $('chk-grayscale').checked : false, w: w, h: h };
    centerUnderlay(); renderFull(); syncUnderlayControls(); scheduleAutosave();
  }
  function loadUnderlayFile(file) {
    var cv = document.createElement('canvas');
    IL.loadFileToCanvas(file, cv, 480).then(function (r) { setUnderlay(cv, r.width, r.height); }).catch(function (e) { alert('画像読込失敗: ' + e.message); });
  }
  function loadUnderlaySample() {
    var url = SAMPLE.makeSampleDataUrl(400); var cv = document.createElement('canvas');
    IL.loadUrlToCanvas(url, cv, 480).then(function (r) { setUnderlay(cv, r.width, r.height); }).catch(function (e) { alert('サンプル読込失敗: ' + e.message); });
  }
  // #15 キャンバス板そのものへ画像D&Dで下絵投入（右パネルのドロップゾーン/ファイル選択は併存）。
  // D&D中は「ここにドロップで下絵を読み込み」オーバーレイ(#canvas-dnd-hint)を表示する。
  function dndHasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types; if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
    return false;
  }
  function wireCanvasDnd() {
    var zone = $('ws-canvas'), hint = $('canvas-dnd-hint');
    if (!zone) return;
    function show() { if (hint) hint.classList.remove('hidden'); }
    function hide() { if (hint) hint.classList.add('hidden'); }
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { if (!dndHasFiles(e)) return; e.preventDefault(); e.stopPropagation(); show(); });
    });
    zone.addEventListener('dragleave', hide);
    zone.addEventListener('dragend', hide);
    zone.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); hide();
      var dt = e.dataTransfer; if (dt && dt.files && dt.files.length) loadUnderlayFile(dt.files[0]);
    });
  }
  // #2 下絵をマス目指定で一発フィット。scale = (N × cellPx) / underlay寸法。
  // 単一スケール（縦横比は常に維持）。axis='w' は横N目・'h' は縦N目基準。
  function fitUnderlay(n, axis) {
    var u = cur().underlay; if (!u) { setStatus('先に下絵を読み込んでください'); return; }
    n = clamp(Math.round(n) || 1, 1, 200);
    // #13 world単位（ZREF基準）でスケール算出＝現在ズームに依存しない（ズームは描画時 uf で反映）。
    var ZR = zref(), asp = cur().grid.cellAspect || 1;
    if (axis === 'h') u.scale = (n * asp * ZR) / u.h; else u.scale = (n * ZR) / u.w;
    centerUnderlay(); renderFull(); syncUnderlayControls(); scheduleAutosave();
    setStatus('下絵を' + (axis === 'h' ? '縦' : '横') + n + '目に合わせました（縦横比維持）');
  }
  // #14 下絵の表示ON/OFF（H キー / リボンのチェックボックス）。非表示でも underlay データは保持。
  function setUnderlayVisible(v) {
    underlayVisible = !!v;
    if ($('chk-underlay')) $('chk-underlay').checked = underlayVisible;
    renderFull();
    if (cur().underlay) setStatus(underlayVisible ? '下絵を表示しました' : '下絵を非表示にしました（データは保持・H で戻す）');
  }
  function toggleUnderlayVisible() { setUnderlayVisible(!underlayVisible); }

  // #17 全画面（フォーカス）モード: リボン・左右パネルを隠しキャンバス最大化（body.focus-mode）。
  // ショートカット/ズーム/パン/undo は document/svg 直バインドなので全画面中も従来どおり有効。
  function setFocusMode(on) {
    focusMode = !!on;
    if (document.body && document.body.classList) document.body.classList.toggle('focus-mode', focusMode);
    var b = $('btn-focus-toggle');
    if (b) { b.textContent = focusMode ? '⛶ 全画面を終了 (Esc)' : '⛶ 全画面'; b.classList.toggle('active-focus', focusMode); }
    renderFull();   // レイアウト変化後の再描画（スクロール領域の再計算・パネル値の反映）
    setStatus(focusMode ? '全画面モード（Esc または F で戻る）' : '全画面を終了しました');
  }
  function toggleFocusMode() { setFocusMode(!focusMode); }

  // #18(a) 下絵の大きさをスライダーで連続調整（world単位・zoom非依存）。「横N目相当」を数値表示。
  function underlayWidthCells() { var u = cur().underlay; if (!u) return 0; return (u.w * (u.scale || 1)) / zref(); }
  function updateUnderlayScaleLabel() {
    var lbl = $('uscale-val'); if (!lbl) return;
    lbl.textContent = cur().underlay ? ('横 ' + clamp(Math.round(underlayWidthCells()), 1, 200) + ' 目') : '—';
  }
  // スライダー位置・ラベル・活殺を現在の下絵スケールへ同期（読込/フィット/ホイール/中心合わせ/クリア時に呼ぶ）。
  function syncUnderlayControls() {
    var sl = $('underlay-scale'), u = cur().underlay;
    if (sl) { if (u) { sl.disabled = false; sl.value = clamp(Math.round(underlayWidthCells()), 1, 200); } else { sl.disabled = true; } }
    updateUnderlayScaleLabel();
  }
  // 中心を保って world単位スケールへ（位置微調整と両立＝拡縮で下絵が飛ばない）。wheel と同じ [0.1,10] クランプ。
  function setUnderlayScaleWorld(ns) {
    var u = cur().underlay; if (!u) return;
    ns = clamp(ns, 0.1, 10);
    var s = u.scale || 1;
    u.x = (u.x || 0) + (u.w * (s - ns)) / 2;
    u.y = (u.y || 0) + (u.h * (s - ns)) / 2;
    u.scale = ns;
    renderPreview(); updateUnderlayScaleLabel(); scheduleAutosave();
  }
  // スライダー値（横N目相当）→ world単位スケール（fitと同一式・ズーム非依存）。
  function setUnderlayWidthCells(n) {
    var u = cur().underlay; if (!u) { setStatus('先に下絵を読み込んでください'); return; }
    n = clamp(Math.round(n) || 1, 1, 200);
    setUnderlayScaleWorld((n * zref()) / u.w);
    setStatus('下絵の大きさ: 横' + clamp(Math.round(underlayWidthCells()), 1, 200) + '目相当（縦横比維持）');
  }
  // #18(b) 下絵移動ツール中の矢印キー微移動。world単位（zoom非依存）＝描画時 uf で反映。
  function moveUnderlayBy(dx, dy) {
    var u = cur().underlay; if (!u) return;
    u.x = (u.x || 0) + dx; u.y = (u.y || 0) + dy;
    renderPreview(); scheduleAutosave();
    setStatus('下絵を移動（' + (dx ? (dx > 0 ? '右' : '左') : (dy > 0 ? '下' : '上')) + '・world単位）');
  }

  // #9(b) 全消去（確認ダイアログ付き）。cells 全 null＋breaks クリア。undoで戻せる。
  function clearAll() {
    var vr = lastVr || analyzeNow();
    if (vr.cellCount === 0 && Object.keys(cur().breaks).length === 0) { setStatus('すでに空です'); return; }
    if (!window.confirm('すべての刺し目と切れ目を消去します。よろしいですか？（取り消しで戻せます）')) return;
    var c = cur().cells;
    for (var y = 0; y < c.length; y++) for (var x = 0; x < c[y].length; x++) c[y][x] = null;
    cur().breaks = {};
    selection = null; marquee = null; rectSel = null; clip = null; repeatMode = false; ghostCells = null;
    if ($('repeat-form')) $('repeat-form').classList.add('hidden');
    store.commit('clear-all'); renderFull(); scheduleAutosave();
    setStatus('全消去しました');
  }

  // ---- 保存（ファイル=バックアップ/端末間共有・ブラウザ内=この端末での続き） ----
  function saveJson() {
    cur().updatedAt = nowIso();
    var blob = new Blob([S.serialize(cur())], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kogin-trace-' + stamp() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
    dirty = false;
    setStatus('JSONファイルに保存しました（バックアップ・端末間の持ち出し用）');
  }
  function loadJsonFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = S.deserialize(rd.result); store.replace(d); selection = null; marquee = null; rectSel = null; clip = null; repeatMode = false;
        currentLibId = null; dirty = false;
        syncGridControls(); syncUnderlayControls(); renderFull(); setStatus('読込完了');
      }
      catch (e) { alert('JSON読込失敗: ' + e.message); }
    };
    rd.readAsText(file);
  }

  /* ===== #19 ブラウザ内保存メニュー（localStorage・この端末のこのブラウザだけ） ===== */
  var QUOTA_MSG = '保存できませんでした（容量不足）。古い保存を削除するかJSONファイル保存を使ってください';
  var NOSTORE_MSG = 'このブラウザでは内部保存が使えません（プライベートモード等）。「JSONで保存」を使ってください';

  function libStorage() { try { return window.localStorage; } catch (e) { return null; } }
  function libReady() { var st = libStorage(); return !!(LIB && st && LIB.available(st)); }
  function libMsg(text, ok) {
    var el = $('library-msg'); if (!el) return;
    if (!text) { el.className = 'lib-msg hidden'; el.textContent = ''; return; }
    el.className = 'lib-msg' + (ok ? ' ok' : ''); el.textContent = text;
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmtSavedAt(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return String(iso || '');
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function defaultSaveName() {
    var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 一覧用の小サムネイル（既定64px・cellAspect考慮）。localStorage容量を食わないよう最小限で作る。
  function buildThumb(doc, maxPx) {
    try {
      var g = doc.grid, asp = g.cellAspect || 1, px = maxPx || 64;
      var cvs = document.createElement('canvas'); if (!cvs.getContext) return '';
      var vw = g.w, vh = g.h * asp, sc = px / Math.max(vw, vh);
      var cw = Math.max(8, Math.round(vw * sc)), ch = Math.max(8, Math.round(vh * sc));
      cvs.width = cw; cvs.height = ch;
      var ctx = cvs.getContext('2d'); if (!ctx) return '';
      ctx.fillStyle = S.fabricHexOf(doc, CFG);   // R9: 自由色（custom）も含めて1関数で解決
      ctx.fillRect(0, 0, cw, ch);
      var sx = cw / g.w, sy = ch / g.h, dw = Math.max(1, Math.ceil(sx)), dh = Math.max(1, Math.ceil(sy));
      for (var y = 0; y < g.h; y++) {
        var row = doc.cells[y]; if (!row) continue;
        for (var x = 0; x < g.w; x++) {
          var v = row[x]; if (v == null) continue;
          ctx.fillStyle = colorHex(v);
          ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), dw, dh);
        }
      }
      var url = cvs.toDataURL('image/png');
      return url.length > 24000 ? '' : url;   // 想定外に大きければサムネ無しで保存（容量優先）
    } catch (e) { return ''; }
  }

  function renderLibraryList() {
    var ul = $('library-list'); if (!ul) return;
    var st = libStorage();
    var items = (LIB && st) ? LIB.list(st) : [];
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i], id = escHtml(it.id);
      var thumb = it.thumb
        ? '<img class="lib-thumb" src="' + escHtml(it.thumb) + '" alt="" data-act="open" data-id="' + id + '" title="クリックで開く">'
        : '<div class="lib-thumb empty" data-act="open" data-id="' + id + '" title="クリックで開く">画像なし</div>';
      html += '<li class="lib-item" data-id="' + id + '">' + thumb +
        '<div class="lib-meta">' +
          '<div class="lib-name" data-act="open" data-id="' + id + '" title="クリックで開く">' + escHtml(it.name) +
            (it.id === currentLibId ? ' <span class="lib-sub">（開いています）</span>' : '') + '</div>' +
          '<div class="lib-sub">' + fmtSavedAt(it.savedAt) + '　' + (it.w || '?') + '×' + (it.h || '?') + '目　塗り' + (it.cellCount || 0) + '目</div>' +
        '</div>' +
        '<div class="lib-acts">' +
          '<button class="btn-small" data-act="open" data-id="' + id + '">開く</button>' +
          '<button class="btn-small" data-act="over" data-id="' + id + '" title="いまの作業でこの保存を上書きします">上書き保存</button>' +
          '<button class="btn-small danger-outline" data-act="del" data-id="' + id + '">削除</button>' +
        '</div></li>';
    }
    ul.innerHTML = html;
    if ($('library-empty')) $('library-empty').classList.toggle('hidden', items.length > 0);
    if ($('library-count')) {
      var kb = (LIB && st) ? Math.round(LIB.usageBytes(st) / 1024) : 0;
      $('library-count').textContent = items.length + '件・約' + kb + 'KB';
    }
  }
  function openLibrary() {
    var m = $('library-modal'); if (!m) return;
    libMsg('', false);
    renderLibraryList();
    m.classList.remove('hidden');
    libraryOpen = true;
    if (!libReady()) libMsg(NOSTORE_MSG, false);
  }
  function closeLibrary() {
    var m = $('library-modal'); if (m) m.classList.add('hidden');
    libraryOpen = false;
  }

  // 保存（id 省略=新規／id 指定=上書き）。容量超過は握りつぶさずメニューにメッセージ表示。
  function saveToLibrary(name, id) {
    if (!libReady()) { openLibrary(); libMsg(NOSTORE_MSG, false); setStatus(NOSTORE_MSG); return { ok: false, reason: 'unavailable' }; }
    cur().updatedAt = nowIso();
    var vr = lastVr || analyzeNow();
    var res = LIB.save(libStorage(), {
      id: id || null,
      name: name,
      docStr: S.serialize(cur()),
      savedAt: new Date().toISOString(),
      w: cur().grid.w, h: cur().grid.h,
      cellCount: vr.cellCount,
      thumb: buildThumb(cur(), 64)
    });
    if (!res.ok) {
      var msg = res.reason === 'quota' ? QUOTA_MSG : ('保存できませんでした（' + (res.message || res.reason) + '）');
      openLibrary(); libMsg(msg, false); setStatus(msg);
      return res;
    }
    currentLibId = res.id; dirty = false;
    var it = LIB.find(libStorage(), res.id);
    var nm = it ? it.name : String(name);
    renderLibraryList(); libMsg('保存しました: ' + nm, true);
    setStatus('ブラウザ内に保存しました: ' + nm + '（この端末のこのブラウザだけに残ります）');
    return res;
  }
  function promptSaveNew() {
    if (!libReady()) { openLibrary(); libMsg(NOSTORE_MSG, false); return null; }
    var name = window.prompt('保存する名前（このブラウザの中に保存されます）', defaultSaveName());
    if (name === null) { setStatus('保存をやめました'); return null; }
    return saveToLibrary(name, null);
  }
  function overwriteLibrary(id) {
    if (!libReady()) { openLibrary(); libMsg(NOSTORE_MSG, false); return false; }
    var it = LIB.find(libStorage(), id);
    if (!it) { libMsg('保存先が見つかりません（削除済みかもしれません）', false); renderLibraryList(); return false; }
    if (!window.confirm('「' + it.name + '」を、いまの作業で上書きします。よろしいですか？')) { setStatus('上書きをやめました'); return false; }
    var res = saveToLibrary(it.name, id);
    return !!(res && res.ok);
  }
  function openFromLibrary(id) {
    if (!libReady()) { openLibrary(); libMsg(NOSTORE_MSG, false); return false; }
    var it = LIB.find(libStorage(), id);
    if (dirty && !window.confirm('いまの作業は「名前を付けて保存」されていません。\n開くと、いまの内容は' + (it ? '「' + it.name + '」' : '保存済みデザイン') + 'に置き換わります。開きますか？')) {
      setStatus('読込をやめました'); return false;
    }
    var str = LIB.load(libStorage(), id);
    if (!str) { libMsg('この保存データが見つかりませんでした（削除済みかもしれません）', false); renderLibraryList(); return false; }
    var d = null;
    try { d = S.deserialize(str); }
    catch (e) { libMsg('読み込めませんでした: ' + e.message, false); return false; }
    store.replace(d);
    selection = null; marquee = null; rectSel = null; clip = null; repeatMode = false; ghostCells = null;
    if ($('repeat-form')) $('repeat-form').classList.add('hidden');
    currentLibId = id; dirty = false;
    syncGridControls(); syncUnderlayControls(); renderFull(); closeLibrary();
    setStatus('開きました: ' + (it ? it.name : id));
    return true;
  }
  function deleteFromLibrary(id) {
    if (!libReady()) { openLibrary(); libMsg(NOSTORE_MSG, false); return false; }
    var it = LIB.find(libStorage(), id);
    if (!window.confirm('「' + (it ? it.name : id) + '」を削除します。元に戻せません。よろしいですか？')) { setStatus('削除をやめました'); return false; }
    var res = LIB.remove(libStorage(), id);
    if (currentLibId === id) currentLibId = null;
    renderLibraryList();
    libMsg(res.ok ? ('削除しました: ' + (it ? it.name : id)) : '削除できませんでした', res.ok);
    return !!res.ok;
  }

  function scheduleAutosave() {
    dirty = true;   // #19 名前付き保存に対する未保存フラグ（すべての編集がここを通る）
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      try { cur().updatedAt = nowIso(); localStorage.setItem(AUTOSAVE_KEY, S.serialize(cur())); if ($('autosave-status')) $('autosave-status').textContent = '自動保存 ' + new Date().toLocaleTimeString('ja-JP'); } catch (e) {}
    }, CFG.autosaveDebounceMs || 800);
  }
  function setStatus(msg) { if ($('canvas-status')) $('canvas-status').textContent = msg; }

  // ---- 配線 ----
  function bindCanvas() {
    var svg = $('trace-svg');
    svg.addEventListener('mousedown', function (e) { e.preventDefault(); onMouseDown(e); });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('mouseleave', function () { if (hoverCell) { hoverCell = null; schedulePreview(); } });
    svg.addEventListener('contextmenu', function (e) { if (spaceDown) e.preventDefault(); }); // Space中の右クリックメニュー抑止
  }
  function bindKeyboard() { document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp); }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function bindControls() {
    for (var i = 0; i < TOOLS.length; i++) (function (t) { on('tool-' + t, 'click', function () { setTool(t); }); })(TOOLS[i]);
    on('btn-undo', 'click', doUndo); on('btn-redo', 'click', doRedo);
    on('chk-oddsnap', 'change', function () { oddSnap = this.checked; });
    on('btn-zoom-in', 'click', function () { setZoom(zoom + 2); });
    on('btn-zoom-out', 'click', function () { setZoom(zoom - 2); });
    on('btn-zoom-100', 'click', zoomReset100);
    on('btn-zoom-fit', 'click', zoomFit);
    on('grid-w', 'change', function () { applyResize(parseInt(this.value, 10), cur().grid.h); });
    on('grid-h', 'change', function () { applyResize(cur().grid.w, parseInt(this.value, 10)); });
    on('cell-aspect', 'input', function () { if ($('aspect-val')) $('aspect-val').textContent = Number(this.value).toFixed(2); });
    on('cell-aspect', 'change', function () { cur().grid.cellAspect = clamp(parseFloat(this.value) || 1, 0.5, 2.0); store.commit('aspect'); renderFull(); scheduleAutosave(); });
    on('chk-grid', 'change', function () { showGrid = this.checked; renderFull(); });
    on('chk-5', 'change', function () { show5 = this.checked; renderFull(); });
    on('chk-center', 'change', function () { showCenter = this.checked; renderFull(); });
    on('chk-underlay', 'change', function () { setUnderlayVisible(this.checked); });   // #14 下絵の表示ON/OFF
    // #16 マス目数の数値設定（上部リボン・右パネルの grid-w/grid-h と併存・双方向同期）
    on('btn-grid-apply', 'click', function () { applyResize(clampInput('grid-w-top', 3, 200), clampInput('grid-h-top', 3, 200)); });
    on('grid-w-top', 'change', function () { applyResize(clampInput('grid-w-top', 3, 200), cur().grid.h); });
    on('grid-h-top', 'change', function () { applyResize(cur().grid.w, clampInput('grid-h-top', 3, 200)); });
    on('grid-opacity', 'input', function () { gridOpacity = this.value / 100; if ($('gridop-val')) $('gridop-val').textContent = this.value + '%'; renderFull(); });
    // 下絵
    if ($('underlay-dz') && IL) IL.wireDropzone($('underlay-dz'), loadUnderlayFile);
    on('underlay-file', 'change', function () { if (this.files && this.files[0]) loadUnderlayFile(this.files[0]); });
    on('btn-underlay-sample', 'click', loadUnderlaySample);
    on('underlay-opacity', 'input', function () { if ($('uop-val')) $('uop-val').textContent = this.value + '%'; if (cur().underlay) { cur().underlay.opacity = this.value / 100; renderPreview(); scheduleAutosave(); } });
    on('chk-grayscale', 'change', function () { if (cur().underlay) { cur().underlay.grayscale = this.checked; renderFull(); scheduleAutosave(); } });
    on('btn-rot-l', 'click', function () { rotateUnderlay(-90); });
    on('btn-rot-r', 'click', function () { rotateUnderlay(90); });
    on('underlay-rot', 'input', function () { if ($('urot-val')) $('urot-val').textContent = this.value + '°'; if (cur().underlay) { var coarse = Math.round(cur().underlay.rotateDeg / 90) * 90; cur().underlay.rotateDeg = coarse + parseInt(this.value, 10); renderPreview(); scheduleAutosave(); } });
    on('btn-underlay-center', 'click', function () { centerUnderlay(); renderFull(); syncUnderlayControls(); scheduleAutosave(); });
    on('btn-underlay-clear', 'click', function () { cur().underlay = null; renderFull(); syncUnderlayControls(); scheduleAutosave(); });
    on('underlay-scale', 'input', function () { setUnderlayWidthCells(parseInt(this.value, 10)); });   // #18(a) 下絵の大きさスライダー（world単位・中心保持）
    on('btn-focus-toggle', 'click', toggleFocusMode);   // #17 全画面（フォーカス）モードのトグル
    // 範囲選択（導線ガードは alert でなく次の一手を提示＝#11）
    on('btn-copy', 'click', function () { if (!guardRect()) return; clip = S.copyRect(cur().cells, rectSel.x, rectSel.y, rectSel.w, rectSel.h); updateRectButtons(); setStatus('コピー: ' + clip.w + '×' + clip.h + '目（連続ペーストが使えます）'); });
    on('btn-rect-fill', 'click', function () { if (!guardRect()) return; for (var y = rectSel.y; y < rectSel.y + rectSel.h; y++) S.paintRun(cur().cells, y, rectSel.x, rectSel.x + rectSel.w - 1, activeColor); store.commit('rect-fill'); renderFull(); scheduleAutosave(); });
    on('btn-rect-erase', 'click', function () { if (!guardRect()) return; for (var y = rectSel.y; y < rectSel.y + rectSel.h; y++) S.eraseRange(cur().cells, y, rectSel.x, rectSel.x + rectSel.w - 1, cur().breaks); store.commit('rect-erase'); renderFull(); scheduleAutosave(); });
    on('btn-repeat', 'click', function () { if (!guardClip()) return; if ($('repeat-form')) $('repeat-form').classList.remove('hidden'); updateRepeatSteps(); setStatus('連続ペースト: 回数・間隔を入れて「配置モードへ」'); });
    on('rep-cancel', 'click', function () { if ($('repeat-form')) $('repeat-form').classList.add('hidden'); repeatMode = false; ghostCells = null; renderFull(); });
    on('rep-place', 'click', function () {
      if (!guardClip()) return;
      repeatParams = { nx: clampInput('rep-nx', 1, 50), ny: clampInput('rep-ny', 1, 50), gx: clampInput('rep-gapx', 0, 20), gy: clampInput('rep-gapy', 0, 20) };
      repeatMode = true; setStatus('連続ペースト: キャンバスをクリックして配置'); if ($('repeat-form')) $('repeat-form').classList.add('hidden'); updateRepeatSteps();
    });
    // #2 下絵フィット・#9 全消去
    on('btn-underlay-fit-w', 'click', function () { fitUnderlay(clampInput('underlay-fit-n', 1, 200), 'w'); });
    on('btn-underlay-fit-h', 'click', function () { fitUnderlay(clampInput('underlay-fit-n', 1, 200), 'h'); });
    on('btn-clear-all', 'click', clearAll);
    // リボン格納・右パネル折りたたみ
    on('btn-ribbon-toggle', 'click', function () { if ($('ribbon')) $('ribbon').classList.toggle('collapsed'); });
    on('btn-toggle-right', 'click', function () {
      if ($('ws')) $('ws').classList.toggle('right-collapsed');
      if ($('ws-right')) $('ws-right').classList.toggle('collapsed');
      renderFull();
    });
    // 検証・保存
    on('btn-chart', 'click', function () { if (lastVr.floatViolations.length > 0) return; C.open(cur(), lastVr, CFG); });
    on('btn-save', 'click', saveJson);
    on('load-file', 'change', function () { if (this.files && this.files[0]) loadJsonFile(this.files[0]); });
    // #19 ブラウザ内保存メニュー（名前を付けて保存／一覧から開く・上書き・削除）
    on('btn-save-named', 'click', function () { promptSaveNew(); });
    on('btn-open-library', 'click', openLibrary);
    on('btn-library-close', 'click', closeLibrary);
    on('btn-library-save-new', 'click', function () { promptSaveNew(); });
    on('library-modal', 'click', function (e) { if (e.target === this) closeLibrary(); });   // 背景クリックで閉じる
    on('library-list', 'click', function (e) {
      var t = e.target;
      while (t && t !== this && !(t.getAttribute && t.getAttribute('data-act'))) t = t.parentNode;
      if (!t || t === this || !t.getAttribute) return;
      var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
      if (!act || !id) return;
      if (act === 'open') openFromLibrary(id);
      else if (act === 'over') overwriteLibrary(id);
      else if (act === 'del') deleteFromLibrary(id);
    });
  }
  function clampInput(id, lo, hi) { var el = $(id); var v = el ? parseInt(el.value, 10) : lo; return clamp(isNaN(v) ? lo : v, lo, hi); }
  // 導線ガード（#11）: 未達なら alert でなく「次の一手」を提示し false を返す。
  function flashTool(id) { var b = $(id); if (b) { b.classList.add('active'); setTimeout(function () { for (var i = 0; i < TOOLS.length; i++) { var e = $('tool-' + TOOLS[i]); if (e) e.classList.toggle('active', TOOLS[i] === tool); } }, 900); } }
  function guardRect() {
    if (rectSel) return true;
    setStatus('「矩形選択」(5) でキャンバスをドラッグして範囲を作ってください →その後この操作が使えます');
    flashTool('tool-rect');
    return false;
  }
  function guardClip() {
    if (clip) return true;
    setStatus(rectSel ? '先に「コピー」を押してから連続ペーストできます' : '「矩形選択」(5) で範囲→「コピー」の順で連続ペーストが使えます');
    if (!rectSel) flashTool('tool-rect');
    return false;
  }
  function rotateUnderlay(deg) {
    if (!cur().underlay) return;
    cur().underlay.rotateDeg += deg;
    if ($('underlay-rot')) { var fine = cur().underlay.rotateDeg - Math.round(cur().underlay.rotateDeg / 90) * 90; $('underlay-rot').value = fine; if ($('urot-val')) $('urot-val').textContent = fine + '°'; }
    renderFull(); scheduleAutosave();
  }

  // ---- テスト用API ----
  function exposeTestApi() {
    window.TraceApp = {
      reset: function (w, h) { store.replace(S.newDoc(w, h)); selection = null; marquee = null; rectSel = null; clip = null; repeatMode = false; underlayVisible = true; currentLibId = null; dirty = false; setActiveColor(activeColor); syncGridControls(); renderFull(); },
      getDoc: function () { return cur(); },
      getVr: function () { return lastVr; },
      cellCount: function () { return lastVr ? lastVr.cellCount : 0; },
      chartDisabled: function () { return !!(lastVr && lastVr.floatViolations.length > 0); },
      setTool: setTool, getTool: function () { return tool; },
      setOddSnap: function (b) { oddSnap = b; if ($('chk-oddsnap')) $('chk-oddsnap').checked = b; },
      setActiveColor: setActiveColor,
      // #12 テスト用: ズーム/スポイト/ホバー/パンの観測
      getZoom: function () { return zoom; },
      setZoom: function (z) { setZoom(z); },
      zoomFit: zoomFit, zoomReset100: zoomReset100,
      // #13/#14 テスト用: 下絵ジオメトリ（実描画された <image> の px）と表示トグルの観測
      underlayVisible: function () { return underlayVisible; },
      setUnderlayVisible: setUnderlayVisible,
      setUnderlayTest: function (w, h, scale) {
        underlayVisible = true;
        cur().underlay = { dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', x: 0, y: 0, scale: scale || 1, rotateDeg: 0, opacity: 0.5, grayscale: false, w: w, h: h };
        centerUnderlay(); renderFull();
      },
      underlayRenderedPx: function () {
        var svg = $('trace-svg'); var img = svg && svg.querySelector('image');
        if (!img) return null;
        return { x: +img.getAttribute('x'), y: +img.getAttribute('y'), w: +img.getAttribute('width'), h: +img.getAttribute('height') };
      },
      // #17/#18 テスト用: 全画面状態・下絵の world幾何・横目数相当
      focusMode: function () { return focusMode; },
      underlayWorld: function () { var u = cur().underlay; return u ? { x: u.x, y: u.y, w: u.w, h: u.h, scale: u.scale } : null; },
      underlayWidthCells: underlayWidthCells,
      activeColorId: function () { return activeColor; },
      hoverCell: function () { return hoverCell; },
      isPanning: function () { return !!pan; },
      cellAt: function (x, y) { var g = cur().grid; return (x < 0 || y < 0 || x >= g.w || y >= g.h) ? null : cur().cells[y][x]; },
      undo: doUndo, redo: doRedo,
      svg: function () { return $('trace-svg'); },
      cellClientPoint: function (cx, cy) {
        var svg = $('trace-svg'), rect = svg.getBoundingClientRect();
        var cw = zoom, ch = zoom * cur().grid.cellAspect;
        var sx = R.PAD + (cx + 0.5) * cw, sy = R.PAD + (cy + 0.5) * ch;
        return { clientX: rect.left + sx * (rect.width / lastW), clientY: rect.top + sy * (rect.height / lastH) };
      },
      setRect: function (x, y, w, h) { rectSel = { x: x, y: y, w: w, h: h }; marquee = { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }; renderFull(); },
      copyRect: function () { if (rectSel) clip = S.copyRect(cur().cells, rectSel.x, rectSel.y, rectSel.w, rectSel.h); return clip; },
      getClip: function () { return clip; },
      repeatPasteAt: function (ax, ay, nx, ny, gx, gy) { var wri = S.repeatPaste(cur().cells, clip, ax, ay, nx, ny, gx, gy); store.commit('repeat'); renderFull(); return wri; },
      openChart: function (opts) { return C.buildChartSVG(cur(), lastVr, CFG, opts); },  // opts省略=既定カラー
      serialize: function () { return S.serialize(cur()); },
      load: function (str) { store.replace(S.deserialize(str)); renderFull(); },
      // break（切れ目）テスト用
      addBreak: function (y, x) { var r = S.addBreak(cur().breaks, y, x); store.commit('break'); renderFull(); return r; },
      toggleBreak: function (y, x) { var r = S.toggleBreak(cur().breaks, y, x); store.commit('break'); renderFull(); return r; },
      getBreaks: function () { return cur().breaks; },
      hasBreak: function (y, x) { return S.hasBreakAt(cur().breaks, y, x); },
      violations: function () { return lastVr ? lastVr.floatViolations.length : 0; },
      clearAll: clearAll,
      setActiveColorForce: setActiveColor,
      rectSel: function () { return rectSel; },
      isDisabledLook: function (id) { var el = $(id); return !!(el && el.classList.contains('is-disabled')); },
      statusText: function () { return $('canvas-status') ? $('canvas-status').textContent : ''; },
      // #19 ブラウザ内保存（ライブラリ）テスト用
      saveToLibrary: function (name) { return saveToLibrary(name, null); },
      overwriteLibrary: overwriteLibrary,
      openFromLibrary: openFromLibrary,
      deleteFromLibrary: deleteFromLibrary,
      libraryList: function () { var st = libStorage(); return (LIB && st) ? LIB.list(st) : []; },
      libraryIsOpen: function () { return libraryOpen; },
      openLibrary: openLibrary,
      closeLibrary: closeLibrary,
      libraryMsg: function () { var el = $('library-msg'); return el ? { text: el.textContent, hidden: el.className.indexOf('hidden') >= 0 } : null; },
      libraryReady: libReady,
      isDirty: function () { return dirty; },
      currentLibId: function () { return currentLibId; },
      thumbDataURL: function () { return buildThumb(cur(), 64); },
      saveJson: saveJson
    };
  }

  // ---- 初期化 ----
  function init() {
    var start = null;
    try { var saved = localStorage.getItem(AUTOSAVE_KEY); if (saved && window.confirm('前回の続きを開きますか？（キャンセルで新規）')) start = S.deserialize(saved); } catch (e) { start = null; }
    if (!start) { var p = CFG.PRESETS.filter(function (x) { return x.id === 'meishiire'; })[0] || CFG.PRESETS[0]; start = S.newDoc(p.w || 80, p.h || 100); }
    store = S.DocStore(start);
    buildToolSelect(); buildPalette(); buildFabricSelect(); buildPresetSelect(); bindControls(); bindCanvas(); bindKeyboard(); wireCanvasDnd();
    setTool(tool); setActiveColor(activeColor); syncGridControls(); syncUnderlayControls();
    renderLibraryList(); dirty = false;   // #19 保存済み一覧を先に描く（メニューは閉じたまま）／起動直後は未編集扱い
    renderFull(); setStatus('準備完了（すべて仮値・実測後に差し替え）');
    exposeTestApi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
