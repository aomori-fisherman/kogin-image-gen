/* trace-app.js
   こぎんトレース台エディタ T0 — 配線層（ツール・ポインタ・キーボード・パネル・保存）。
   マウスイベント方式（desktop優先／ヘッドレスの MouseEvent 合成に対応）。
   描画更新はドラッグ中 requestAnimationFrame でバッチ（§9.3）。
   window.TraceApp を test/デバッグ用に公開。 */
(function () {
  'use strict';

  var CFG = window.TRACE_CONFIG, S = window.TraceState, V = window.TraceValidate,
      R = window.TraceRender, C = window.TraceChart, IL = window.KoginImageLoader, SAMPLE = window.KoginSample;
  function $(id) { return document.getElementById(id); }

  var AUTOSAVE_KEY = 'kogin-trace-autosave-v1';
  var TOOLS = ['pen', 'diag', 'eraser', 'select', 'rect', 'underlay'];
  var TOOL_NAMES = { pen: 'ペン（塗り）', diag: '斜線（補助）', eraser: '消しゴム', select: '選択', rect: '範囲選択', underlay: '下絵移動' };

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
    var v = { cellW: cellW, cellH: cellH, showGrid: showGrid, show5: show5, showCenter: showCenter, gridOpacity: gridOpacity, palette: CFG.PALETTE, fabrics: CFG.FABRICS };
    if (extra) for (var k in extra) v[k] = extra[k];
    return v;
  }
  function analyzeNow() { lastVr = V.analyze(cur().cells, { floatMax: CFG.floatMax }); return lastVr; }
  function applySvg(built) {
    var svg = $('trace-svg');
    svg.setAttribute('width', built.width); svg.setAttribute('height', built.height);
    svg.setAttribute('viewBox', built.viewBox); svg.innerHTML = built.innerHTML;
    lastW = built.width; lastH = built.height;
  }
  function overlays() { return { selection: selection, ghostCells: ghostCells, ghostColor: ghostColor, marquee: marquee }; }
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
  }

  // ---- 座標 ----
  function svgCell(e) {
    var svg = $('trace-svg'); var rect = svg.getBoundingClientRect();
    var sx = (e.clientX - rect.left) * (lastW / rect.width);
    var sy = (e.clientY - rect.top) * (lastH / rect.height);
    return R.cellAt(view(), sx, sy);
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
    if (repeatMode) { var c0 = svgCell(e); var wri = S.repeatPaste(cur().cells, clip, c0.x, c0.y, repeatParams.nx, repeatParams.ny, repeatParams.gx, repeatParams.gy); store.commit('repeat'); repeatMode = false; ghostCells = null; renderFull(); scheduleAutosave(); setStatus('連続ペースト: ' + wri + '目を配置'); return; }
    var c = svgCell(e);
    if (c.x < 0 || c.y < 0 || c.x >= cur().grid.w || c.y >= cur().grid.h) { if (tool !== 'underlay') return; }
    if (tool === 'pen') { drag = { mode: 'pen', y: clampY(c.y), x1: clampX(c.x), x2: clampX(c.x) }; setPenGhost(); schedulePreview(); }
    else if (tool === 'diag') { drag = { mode: 'diag', x0: clampX(c.x), y0: clampY(c.y), dx: 0, dy: 0 }; setDiagGhost(); schedulePreview(); }
    else if (tool === 'eraser') { drag = { mode: 'eraser', y: clampY(c.y) }; S.eraseRange(cur().cells, drag.y, clampX(c.x), clampX(c.x)); scheduleFull(); }
    else if (tool === 'select') { selection = S.runAt(cur().cells, clampX(c.x), clampY(c.y)); renderFull(); }
    else if (tool === 'rect') { drag = { mode: 'rect' }; marquee = { x0: clampX(c.x), y0: clampY(c.y), x1: clampX(c.x), y1: clampY(c.y) }; rectSel = null; schedulePreview(); }
    else if (tool === 'underlay') { if (cur().underlay) drag = { mode: 'underlay', sx: e.clientX, sy: e.clientY, ox: cur().underlay.x, oy: cur().underlay.y }; }
  }
  function onMouseMove(e) {
    if (repeatMode) { var cc = svgCell(e); ghostCells = repeatGhost(cc.x, cc.y); ghostColor = '#E3A93D'; schedulePreview(); return; }
    if (!drag) return;
    var c = svgCell(e);
    if (drag.mode === 'pen') { drag.x2 = clampX(c.x); setPenGhost(); schedulePreview(); }
    else if (drag.mode === 'diag') { drag.dx = clampX(c.x) - drag.x0; drag.dy = clampY(c.y) - drag.y0; setDiagGhost(); schedulePreview(); }
    else if (drag.mode === 'eraser') { S.eraseRange(cur().cells, drag.y, clampX(c.x), clampX(c.x)); scheduleFull(); }
    else if (drag.mode === 'rect') { marquee.x1 = clampX(c.x); marquee.y1 = clampY(c.y); schedulePreview(); }
    else if (drag.mode === 'underlay') {
      var svg = $('trace-svg'); var rect = svg.getBoundingClientRect();
      var dx = (e.clientX - drag.sx) * (lastW / rect.width), dy = (e.clientY - drag.sy) * (lastH / rect.height);
      cur().underlay.x = drag.ox + dx; cur().underlay.y = drag.oy + dy; schedulePreview();
    }
  }
  function onMouseUp() {
    if (!drag) return;
    if (drag.mode === 'pen') { var r = penRange(); S.paintRun(cur().cells, drag.y, r[0], r[1], activeColor); store.commit('pen'); ghostCells = null; drag = null; renderFull(); scheduleAutosave(); }
    else if (drag.mode === 'diag') { var cs = S.diagonalCells(drag.x0, drag.y0, drag.dx, drag.dy); for (var i = 0; i < cs.length; i++) { var p = cs[i]; if (p.x >= 0 && p.x < cur().grid.w && p.y >= 0 && p.y < cur().grid.h) cur().cells[p.y][p.x] = activeColor; } store.commit('diag'); ghostCells = null; drag = null; renderFull(); scheduleAutosave(); }
    else if (drag.mode === 'eraser') { store.commit('erase'); drag = null; renderFull(); scheduleAutosave(); }
    else if (drag.mode === 'rect') { var lo = Math.min(marquee.x0, marquee.x1), hi = Math.max(marquee.x0, marquee.x1), tp = Math.min(marquee.y0, marquee.y1), bt = Math.max(marquee.y0, marquee.y1); rectSel = { x: lo, y: tp, w: hi - lo + 1, h: bt - tp + 1 }; drag = null; renderFull(); setStatus('範囲: ' + rectSel.w + '×' + rectSel.h + '目'); }
    else if (drag.mode === 'underlay') { drag = null; scheduleAutosave(); }
  }
  function onWheel(e) {
    if (tool === 'underlay' && cur().underlay) { e.preventDefault(); var f = e.deltaY < 0 ? 1.1 : 1 / 1.1; cur().underlay.scale = clamp(cur().underlay.scale * f, 0.1, 10); renderPreview(); scheduleAutosave(); }
  }

  // ---- 選択ツール キーボード ----
  function moveSel(dx, dy) {
    var r = selection, w = cur().grid.w, h = cur().grid.h;
    var ny = r.y + dy, ns = r.start + dx, ne = ns + r.len - 1;
    if (ny < 0 || ny >= h || ns < 0 || ne > w - 1) return;
    S.moveRun(cur().cells, r, dx, dy);
    selection = { y: ny, start: ns, len: r.len, colorId: r.colorId };
    store.commit('move'); renderFull(); scheduleAutosave();
  }
  function resizeSel(edge, delta) {
    var r = selection, mid = clamp(r.start + Math.floor(r.len / 2), 0, cur().grid.w - 1);
    S.resizeRun(cur().cells, r, edge, delta);
    var nr = S.runAt(cur().cells, mid, r.y); if (nr) selection = nr;
    store.commit('resize-run'); renderFull(); scheduleAutosave();
  }
  function deleteSel() {
    S.eraseRange(cur().cells, selection.y, selection.start, selection.start + selection.len - 1);
    selection = null; store.commit('del'); renderFull(); scheduleAutosave();
  }
  function recolorSel(id) {
    S.paintRun(cur().cells, selection.y, selection.start, selection.start + selection.len - 1, id);
    selection.colorId = id; store.commit('recolor'); renderFull(); scheduleAutosave();
  }

  function onKey(e) {
    var t = e.target, tag = (t && t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') { if (e.key === 'Escape' && t.blur) t.blur(); return; }
    if (e.key === 'Escape') {
      if (repeatMode) { repeatMode = false; ghostCells = null; renderFull(); }
      else if (marquee) { marquee = null; rectSel = null; renderFull(); }
      else if (selection) { selection = null; renderFull(); }
      return;
    }
    if (!e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '6') { setTool(TOOLS[+e.key - 1]); e.preventDefault(); return; }
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
  }

  function doUndo() { if (store.undo()) { selection = null; renderFull(); scheduleAutosave(); } }
  function doRedo() { if (store.redo()) { selection = null; renderFull(); scheduleAutosave(); } }

  // ---- ツール・パレット ----
  function setTool(t) {
    tool = t; drag = null; ghostCells = null;
    if (t !== 'select') selection = selection; // 選択は保持
    for (var i = 0; i < TOOLS.length; i++) { var b = $('tool-' + TOOLS[i]); if (b) b.classList.toggle('active', TOOLS[i] === t); }
    if ($('cur-tool-name')) $('cur-tool-name').textContent = TOOL_NAMES[t] || t;
    renderPreview();
  }
  function setActiveColor(id) {
    activeColor = id;
    var sws = document.querySelectorAll('.sw');
    for (var i = 0; i < sws.length; i++) sws[i].classList.toggle('active', sws[i].getAttribute('data-id') === id);
    var o = colorObj(id);
    if ($('active-color')) $('active-color').innerHTML = o ? ('選択中: <b>' + o.name + '</b> ' + (o.code || '')) : '—';
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
  function buildFabricSelect() {
    var el = $('fabric-select'); if (!el) return; var html = '';
    for (var i = 0; i < CFG.FABRICS.length; i++) html += '<option value="' + CFG.FABRICS[i].id + '">' + CFG.FABRICS[i].name + '</option>';
    el.innerHTML = html; el.value = cur().fabricId;
    el.addEventListener('change', function () { cur().fabricId = el.value; store.commit('fabric'); renderFull(); scheduleAutosave(); });
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
    cur().grid = res.doc.grid; cur().cells = res.doc.cells;
    selection = null; marquee = null; rectSel = null;
    store.commit('resize'); renderFull(); syncGridControls(); scheduleAutosave();
  }
  function syncGridControls() {
    var g = cur().grid;
    if ($('grid-w')) $('grid-w').value = g.w;
    if ($('grid-h')) $('grid-h').value = g.h;
    if ($('cell-aspect')) $('cell-aspect').value = g.cellAspect;
    if ($('aspect-val')) $('aspect-val').textContent = Number(g.cellAspect).toFixed(2);
    if ($('zoom-val')) $('zoom-val').textContent = zoom;
    if ($('gridop-val')) $('gridop-val').textContent = Math.round(gridOpacity * 100) + '%';
    if ($('fabric-select')) $('fabric-select').value = cur().fabricId;
  }

  // ---- 下絵 ----
  function centerUnderlay() {
    var u = cur().underlay; if (!u) return;
    var cellW = zoom, cellH = zoom * cur().grid.cellAspect;
    u.x = (cur().grid.w * cellW) / 2 - (u.w * u.scale) / 2;
    u.y = (cur().grid.h * cellH) / 2 - (u.h * u.scale) / 2;
  }
  function setUnderlay(canvas, w, h) {
    var op = $('underlay-opacity') ? ($('underlay-opacity').value / 100) : 0.5;
    cur().underlay = { dataURL: canvas.toDataURL('image/png'), x: 0, y: 0, scale: 1, rotateDeg: 0, opacity: op, grayscale: $('chk-grayscale') ? $('chk-grayscale').checked : false, w: w, h: h };
    centerUnderlay(); renderFull(); scheduleAutosave();
  }
  function loadUnderlayFile(file) {
    var cv = document.createElement('canvas');
    IL.loadFileToCanvas(file, cv, 480).then(function (r) { setUnderlay(cv, r.width, r.height); }).catch(function (e) { alert('画像読込失敗: ' + e.message); });
  }
  function loadUnderlaySample() {
    var url = SAMPLE.makeSampleDataUrl(400); var cv = document.createElement('canvas');
    IL.loadUrlToCanvas(url, cv, 480).then(function (r) { setUnderlay(cv, r.width, r.height); }).catch(function (e) { alert('サンプル読込失敗: ' + e.message); });
  }

  // ---- 保存 ----
  function saveJson() {
    cur().updatedAt = nowIso();
    var blob = new Blob([S.serialize(cur())], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kogin-trace-' + stamp() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }
  function loadJsonFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try { var d = S.deserialize(rd.result); store.replace(d); selection = null; marquee = null; rectSel = null; clip = null; repeatMode = false; syncGridControls(); renderFull(); setStatus('読込完了'); }
      catch (e) { alert('JSON読込失敗: ' + e.message); }
    };
    rd.readAsText(file);
  }
  function scheduleAutosave() {
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
  }
  function bindKeyboard() { document.addEventListener('keydown', onKey); }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function bindControls() {
    for (var i = 0; i < TOOLS.length; i++) (function (t) { on('tool-' + t, 'click', function () { setTool(t); }); })(TOOLS[i]);
    on('btn-undo', 'click', doUndo); on('btn-redo', 'click', doRedo);
    on('chk-oddsnap', 'change', function () { oddSnap = this.checked; });
    on('btn-zoom-in', 'click', function () { zoom = clamp(zoom + 2, CFG.zoom.min, CFG.zoom.max); syncGridControls(); renderFull(); });
    on('btn-zoom-out', 'click', function () { zoom = clamp(zoom - 2, CFG.zoom.min, CFG.zoom.max); syncGridControls(); renderFull(); });
    on('grid-w', 'change', function () { applyResize(parseInt(this.value, 10), cur().grid.h); });
    on('grid-h', 'change', function () { applyResize(cur().grid.w, parseInt(this.value, 10)); });
    on('cell-aspect', 'input', function () { if ($('aspect-val')) $('aspect-val').textContent = Number(this.value).toFixed(2); });
    on('cell-aspect', 'change', function () { cur().grid.cellAspect = clamp(parseFloat(this.value) || 1, 0.5, 2.0); store.commit('aspect'); renderFull(); scheduleAutosave(); });
    on('chk-grid', 'change', function () { showGrid = this.checked; renderFull(); });
    on('chk-5', 'change', function () { show5 = this.checked; renderFull(); });
    on('chk-center', 'change', function () { showCenter = this.checked; renderFull(); });
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
    on('btn-underlay-center', 'click', function () { centerUnderlay(); renderFull(); scheduleAutosave(); });
    on('btn-underlay-clear', 'click', function () { cur().underlay = null; renderFull(); scheduleAutosave(); });
    // 範囲選択
    on('btn-copy', 'click', function () { if (!rectSel) { alert('先に範囲選択(5)で矩形を選んでください'); return; } clip = S.copyRect(cur().cells, rectSel.x, rectSel.y, rectSel.w, rectSel.h); setStatus('コピー: ' + clip.w + '×' + clip.h + '目'); });
    on('btn-rect-fill', 'click', function () { if (!rectSel) { alert('先に範囲選択してください'); return; } for (var y = rectSel.y; y < rectSel.y + rectSel.h; y++) S.paintRun(cur().cells, y, rectSel.x, rectSel.x + rectSel.w - 1, activeColor); store.commit('rect-fill'); renderFull(); scheduleAutosave(); });
    on('btn-rect-erase', 'click', function () { if (!rectSel) { alert('先に範囲選択してください'); return; } for (var y = rectSel.y; y < rectSel.y + rectSel.h; y++) S.eraseRange(cur().cells, y, rectSel.x, rectSel.x + rectSel.w - 1); store.commit('rect-erase'); renderFull(); scheduleAutosave(); });
    on('btn-repeat', 'click', function () { if (!clip) { alert('先にコピーしてください'); return; } if ($('repeat-form')) $('repeat-form').classList.remove('hidden'); });
    on('rep-cancel', 'click', function () { if ($('repeat-form')) $('repeat-form').classList.add('hidden'); repeatMode = false; ghostCells = null; renderFull(); });
    on('rep-place', 'click', function () {
      if (!clip) { alert('先にコピーしてください'); return; }
      repeatParams = { nx: clampInput('rep-nx', 1, 50), ny: clampInput('rep-ny', 1, 50), gx: clampInput('rep-gapx', 0, 20), gy: clampInput('rep-gapy', 0, 20) };
      repeatMode = true; setStatus('連続ペースト: キャンバスをクリックして配置'); if ($('repeat-form')) $('repeat-form').classList.add('hidden');
    });
    // 検証・保存
    on('btn-chart', 'click', function () { if (lastVr.floatViolations.length > 0) return; C.open(cur(), lastVr, CFG); });
    on('btn-save', 'click', saveJson);
    on('load-file', 'change', function () { if (this.files && this.files[0]) loadJsonFile(this.files[0]); });
  }
  function clampInput(id, lo, hi) { var el = $(id); var v = el ? parseInt(el.value, 10) : lo; return clamp(isNaN(v) ? lo : v, lo, hi); }
  function rotateUnderlay(deg) {
    if (!cur().underlay) return;
    cur().underlay.rotateDeg += deg;
    if ($('underlay-rot')) { var fine = cur().underlay.rotateDeg - Math.round(cur().underlay.rotateDeg / 90) * 90; $('underlay-rot').value = fine; if ($('urot-val')) $('urot-val').textContent = fine + '°'; }
    renderFull(); scheduleAutosave();
  }

  // ---- テスト用API ----
  function exposeTestApi() {
    window.TraceApp = {
      reset: function (w, h) { store.replace(S.newDoc(w, h)); selection = null; marquee = null; rectSel = null; clip = null; repeatMode = false; setActiveColor(activeColor); syncGridControls(); renderFull(); },
      getDoc: function () { return cur(); },
      getVr: function () { return lastVr; },
      cellCount: function () { return lastVr ? lastVr.cellCount : 0; },
      chartDisabled: function () { return !!(lastVr && lastVr.floatViolations.length > 0); },
      setTool: setTool, getTool: function () { return tool; },
      setOddSnap: function (b) { oddSnap = b; if ($('chk-oddsnap')) $('chk-oddsnap').checked = b; },
      setActiveColor: setActiveColor,
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
      openChart: function () { return C.buildChartSVG(cur(), lastVr, CFG); },
      serialize: function () { return S.serialize(cur()); },
      load: function (str) { store.replace(S.deserialize(str)); renderFull(); }
    };
  }

  // ---- 初期化 ----
  function init() {
    var start = null;
    try { var saved = localStorage.getItem(AUTOSAVE_KEY); if (saved && window.confirm('前回の続きを開きますか？（キャンセルで新規）')) start = S.deserialize(saved); } catch (e) { start = null; }
    if (!start) { var p = CFG.PRESETS.filter(function (x) { return x.id === 'meishiire'; })[0] || CFG.PRESETS[0]; start = S.newDoc(p.w || 80, p.h || 100); }
    store = S.DocStore(start);
    buildPalette(); buildFabricSelect(); buildPresetSelect(); bindControls(); bindCanvas(); bindKeyboard();
    setTool(tool); setActiveColor(activeColor); syncGridControls();
    renderFull(); setStatus('準備完了（すべて仮値・実測後に差し替え）');
    exposeTestApi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
