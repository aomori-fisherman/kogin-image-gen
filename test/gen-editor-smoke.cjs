/* gen-editor-smoke.cjs
   実 editor.html の DOM そのままの UIスモークテスト test/trace-editor-smoke.html を生成する。
   DOMコピーの陳腐化を避けるため、editor.html を毎回変換して作り直す（構造変更に自動追従）。
   使い方: node test/gen-editor-smoke.cjs → その後ヘッドレスChromeで trace-editor-smoke.html を開く。
   - css リンク除去（ロジック非依存・404ノイズ回避）
   - js の相対パス js/ → ../js/
   - confirm/alert/localStorage をモックし、末尾にドライバ＋結果divを注入 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(REPO, 'editor.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*>\s*/g, '');
html = html.replace(/src="js\//g, 'src="../js/');

const driver = `
<div id="trace-harness-result">PENDING</div>
<script>
  window.__alerts = [];
  window.alert = function (m) { window.__alerts.push(String(m)); };
  window.confirm = function () { return true; };
  try { window.localStorage.removeItem('kogin-trace-autosave-v1'); } catch (e) {}
  window.__initErr = null;
  window.addEventListener('error', function (ev) { if (!window.__initErr) window.__initErr = (ev.message || '') + ' @ ' + (ev.filename || '') + ':' + (ev.lineno || ''); });
</script>
<script>
function runSmoke() {
  var out = document.getElementById('trace-harness-result');
  function done(o) { out.textContent = 'RESULT:' + JSON.stringify(o); }
  function $(id){ return document.getElementById(id); }
  function md(cx, cy) { var p = TraceApp.cellClientPoint(cx, cy); TraceApp.svg().dispatchEvent(new MouseEvent('mousedown', { clientX: p.clientX, clientY: p.clientY, bubbles: true, cancelable: true })); }
  function mm(cx, cy) { var p = TraceApp.cellClientPoint(cx, cy); window.dispatchEvent(new MouseEvent('mousemove', { clientX: p.clientX, clientY: p.clientY, bubbles: true })); }
  function mu(cx, cy) { var p = TraceApp.cellClientPoint(cx, cy); window.dispatchEvent(new MouseEvent('mouseup', { clientX: p.clientX, clientY: p.clientY, bubbles: true })); }
  function click(id){ var e=$(id); if(e) e.dispatchEvent(new MouseEvent('click',{bubbles:true})); }
  function key(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true})); }
  function keyShift(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,shiftKey:true,bubbles:true,cancelable:true})); }
  function keyup(k){ document.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true})); }
  function mdAlt(cx,cy){ var p=TraceApp.cellClientPoint(cx,cy); TraceApp.svg().dispatchEvent(new MouseEvent('mousedown',{clientX:p.clientX,clientY:p.clientY,altKey:true,bubbles:true,cancelable:true})); }
  function wheelAt(cx,cy,dy){ var p=TraceApp.cellClientPoint(cx,cy); TraceApp.svg().dispatchEvent(new WheelEvent('wheel',{deltaY:dy,clientX:p.clientX,clientY:p.clientY,bubbles:true,cancelable:true})); }
  try {
    if (typeof TraceApp === 'undefined') { done({ ok:false, error:'TraceApp未定義(初期化失敗)', initErr: window.__initErr }); return; }
    var checks = {};

    // A. 実DOMで初期化・グリッド描画された（SVGに子要素あり）
    checks.a_init_noErr = window.__initErr === null;
    checks.a_svg_rendered = TraceApp.svg().childElementCount > 0;

    // B. 新レイアウト要素が実在する（リボン/左/右/新ツール/フィット/ステップ）
    checks.b_ribbon = !!$('ribbon');
    checks.b_ws_right = !!$('ws-right');
    checks.b_tool_break = !!$('tool-break');
    checks.b_clear_all = !!$('btn-clear-all');
    checks.b_fit_n = !!$('underlay-fit-n') && !!$('btn-underlay-fit-w') && !!$('btn-underlay-fit-h');
    checks.b_repeat_steps = !!$('repeat-steps');
    checks.b_help_button = !!$('btn-help');   // 「？使い方」ボタン（help.html へのリンク）
    // C. ツール名称の差別化（#11）
    checks.c_name_run = /ラン選択/.test($('tool-select').textContent);
    checks.c_name_rect = /矩形選択/.test($('tool-rect').textContent);

    // D. 右パネル既定は折りたたみ（collapsed）
    checks.d_right_collapsed_default = $('ws-right').classList.contains('collapsed') && $('ws').classList.contains('right-collapsed');
    click('btn-toggle-right');
    checks.d_right_toggles_open = !$('ws-right').classList.contains('collapsed');
    click('btn-toggle-right'); // 元へ

    // E. リボン格納トグル
    checks.e_ribbon_open_default = !$('ribbon').classList.contains('collapsed');
    click('btn-ribbon-toggle');
    checks.e_ribbon_collapses = $('ribbon').classList.contains('collapsed');
    click('btn-ribbon-toggle');

    // F. 導線ガード: rectSel無し→操作ボタンが is-disabled 表示（#11）
    TraceApp.reset(12, 4);
    checks.f_fill_disabledLook = TraceApp.isDisabledLook('btn-rect-fill');
    checks.f_repeat_disabledLook = TraceApp.isDisabledLook('btn-repeat');

    // G. 切れ目ツール: 実キャンバスのmousedownで境界に切れ目→float違反解消（#3/#5・実導線）
    TraceApp.reset(12, 2);
    TraceApp.setTool('pen'); TraceApp.setOddSnap(false); TraceApp.setActiveColor('r01');
    md(0,0); mm(7,0); mu(7,0);                 // 行0に8目 同色
    checks.g_pre_violation1 = TraceApp.violations() === 1;
    TraceApp.setTool('break');
    md(3,0);                                    // セル3中心→境界bx=round(3.5)=4 に切れ目
    checks.g_break_placed = TraceApp.hasBreak(0,4) === true;
    checks.g_post_violation0 = TraceApp.violations() === 0;
    md(3,0);                                    // 同じ境界を再クリック→切れ目トグルOFF→違反復活
    checks.g_break_toggled_off = TraceApp.hasBreak(0,4) === false && TraceApp.violations() === 1;

    // H. 消しゴム自由方向（行ロックなし・#9a）: 2行に塗り→跨いでドラッグ消去で両行が減る
    TraceApp.reset(12, 3);
    TraceApp.setTool('pen'); TraceApp.setActiveColor('b01');
    md(1,0); mm(5,0); mu(5,0);
    md(1,1); mm(5,1); mu(5,1);
    var beforeErase = TraceApp.cellCount();
    TraceApp.setTool('eraser');
    md(3,0); mm(3,1); mu(3,1);                  // 行0→行1 を跨いでドラッグ
    checks.h_eraser_crossed_rows = TraceApp.cellCount() < beforeErase;

    // I. 全消去（確認ダイアログ→true）→ cells 0・#9b
    TraceApp.reset(12, 2);
    TraceApp.setTool('pen'); TraceApp.setActiveColor('r01');
    md(0,0); mm(4,0); mu(4,0);
    checks.i_pre_cells = TraceApp.cellCount() === 5;
    click('btn-clear-all');
    checks.i_cleared = TraceApp.cellCount() === 0;

    // J. 下絵フィット導線: 下絵無しでフィット→クラッシュせずガイド提示（同期パス）
    TraceApp.reset(12, 2);
    $('underlay-fit-n').value = '10';
    click('btn-underlay-fit-w');
    checks.j_fit_guard = /下絵/.test(TraceApp.statusText());

    // ===== #12 デザインツール型の操作コア（ラウンド2） =====
    // K. ツール文字ショートカット（P/D/E/R/M/U/B）
    TraceApp.reset(12, 4); TraceApp.setTool('pen');
    key('e'); checks.k_key_e_eraser = TraceApp.getTool() === 'eraser';
    key('m'); checks.k_key_m_rect = TraceApp.getTool() === 'rect';
    key('b'); checks.k_key_b_break = TraceApp.getTool() === 'break';
    key('r'); checks.k_key_r_select = TraceApp.getTool() === 'select';
    key('u'); checks.k_key_u_underlay = TraceApp.getTool() === 'underlay';
    key('p'); checks.k_key_p_pen = TraceApp.getTool() === 'pen';

    // L. 自由方向ペン（縦ドラッグを線分補間で連続塗り＝グラフィティ挙動）
    TraceApp.reset(12, 6); TraceApp.setTool('pen'); TraceApp.setActiveColor('r01');
    md(2, 0); mm(2, 3); mu(2, 3);          // 縦4マス
    checks.l_pen_vertical4 = TraceApp.cellCount() === 4;
    checks.l_pen_vertical_cells = TraceApp.cellAt(2, 0) === 'r01' && TraceApp.cellAt(2, 1) === 'r01' && TraceApp.cellAt(2, 2) === 'r01' && TraceApp.cellAt(2, 3) === 'r01';

    // M. 消しゴム補間（1移動の大ジャンプでも隙間なく消える）
    TraceApp.reset(12, 6); TraceApp.setTool('pen'); TraceApp.setActiveColor('b01');
    md(4, 0); mm(4, 4); mu(4, 4);          // 縦5マス
    var beforeErase2 = TraceApp.cellCount();
    TraceApp.setTool('eraser');
    md(4, 0); mm(4, 4); mu(4, 4);          // 端から端まで1移動
    checks.m_eraser_gapfree = beforeErase2 === 5 && TraceApp.cellCount() === 0;

    // N. スポイト（Alt+クリックで塗られた色を取得・塗らない）
    TraceApp.reset(12, 4); TraceApp.setTool('pen'); TraceApp.setActiveColor('r01');
    md(1, 1); mm(3, 1); mu(3, 1);          // r01 を3マス
    TraceApp.setActiveColor('b01');
    checks.n_before_b01 = TraceApp.activeColorId() === 'b01';
    mdAlt(2, 1);                            // r01 のマスを Alt+クリック
    checks.n_eyedrop_picked = TraceApp.activeColorId() === 'r01';
    checks.n_eyedrop_noPaint = TraceApp.cellCount() === 3;

    // O. ホイールでカーソル中心ズーム（拡大/縮小・min/maxクランプ）
    TraceApp.reset(12, 4); TraceApp.setTool('pen');
    var z0 = TraceApp.getZoom();
    wheelAt(6, 2, -100); var zIn = TraceApp.getZoom(); checks.o_wheel_in = zIn > z0;
    wheelAt(6, 2, 100); checks.o_wheel_out = TraceApp.getZoom() < zIn;
    for (var wi = 0; wi < 40; wi++) wheelAt(6, 2, 100);
    checks.o_zoom_clamped_min = TraceApp.getZoom() >= 4;
    for (var wj = 0; wj < 40; wj++) wheelAt(6, 2, -100);
    checks.o_zoom_clamped_max = TraceApp.getZoom() <= 28;

    // P. Esc で既定ツール（ペン）へ戻る
    TraceApp.reset(12, 4); TraceApp.setTool('rect');
    key('Escape');
    checks.p_esc_to_pen = TraceApp.getTool() === 'pen';

    // Q. パン（Space+ドラッグ）はどのツールでも塗らずに移動（塗り介入なし）
    TraceApp.reset(12, 4); TraceApp.setTool('pen'); TraceApp.setActiveColor('r01');
    key(' ');
    md(2, 2); var wasPanning = TraceApp.isPanning(); mm(5, 2); mu(5, 2);
    keyup(' ');
    checks.q_pan_intercepts = wasPanning === true && TraceApp.cellCount() === 0;

    // R. ホバーハイライト（ペン/消しゴムで現在セルを指す・他ツールでは消える）
    TraceApp.reset(12, 4); TraceApp.setTool('pen');
    mm(3, 2);
    var hc = TraceApp.hoverCell();
    checks.r_hover_pen = !!hc && hc.x === 3 && hc.y === 2 && hc.kind === 'pen';
    TraceApp.setTool('select'); mm(4, 2);
    checks.r_hover_cleared_nonpaint = TraceApp.hoverCell() === null;

    // ===== #13 ズームと下絵の一体化（R3・最優先） =====
    // 実描画された下絵<image>のpxをセル単位へ換算し、ズーム変更で下絵-グリッドの
    // 相対位置(left/top)・相対スケール(w/h)が不変（1pxもずれない）ことを数値検証。
    TraceApp.reset(40, 30); TraceApp.zoomReset100();      // zoom=init(10)
    TraceApp.setUnderlayTest(200, 120, 1);                // 下絵注入＋中央寄せ
    checks.s13_underlay_rendered = !!TraceApp.underlayRenderedPx();
    function ucellbox() {
      var u = TraceApp.underlayRenderedPx(); if (!u) return null;
      var PAD = TraceRender.PAD, z = TraceApp.getZoom(), asp = TraceApp.getDoc().grid.cellAspect;
      return { left: (u.x - PAD) / z, top: (u.y - PAD) / (z * asp), w: u.w / z, h: u.h / (z * asp) };
    }
    var ub1 = ucellbox();                                 // zoom=10 での下絵ボックス（セル単位）
    TraceApp.setZoom(22);
    var ub2 = ucellbox();                                 // zoom=22 での下絵ボックス（セル単位）
    function near(a, b) { return Math.abs(a - b) < 0.02; }
    checks.s13_left_fixed = near(ub1.left, ub2.left);
    checks.s13_top_fixed = near(ub1.top, ub2.top);
    checks.s13_w_fixed = near(ub1.w, ub2.w);
    checks.s13_h_fixed = near(ub1.h, ub2.h);

    // ===== #14 下絵の表示ON/OFF（H キー・データ保持） =====
    TraceApp.reset(20, 10); TraceApp.zoomReset100(); TraceApp.setUnderlayTest(100, 60, 1);
    checks.s14_visible_default = TraceApp.underlayVisible() === true && !!TraceApp.underlayRenderedPx();
    key('h');                                             // 非表示へ
    checks.s14_hidden_after_h = TraceApp.underlayVisible() === false && TraceApp.underlayRenderedPx() === null;
    checks.s14_data_kept = !!TraceApp.getDoc().underlay;  // データ・位置・スケールは保持
    key('h');                                             // 再表示
    checks.s14_reshow = TraceApp.underlayVisible() === true && !!TraceApp.underlayRenderedPx();

    // ===== #15 キャンバス直接D&D（オーバーレイ＋ハンドラ存在） =====
    TraceApp.reset(20, 10);
    checks.s15_hint_exists = !!$('canvas-dnd-hint');
    checks.s15_hint_hidden_default = $('canvas-dnd-hint').classList.contains('hidden');
    var wsc = $('ws-canvas');
    var over = new Event('dragover', { bubbles: true, cancelable: true }); over.dataTransfer = { types: ['Files'], files: [] };
    wsc.dispatchEvent(over);
    checks.s15_hint_shows_on_dragover = !$('canvas-dnd-hint').classList.contains('hidden');
    var lv = new Event('dragleave', { bubbles: true, cancelable: true }); lv.dataTransfer = { types: ['Files'] };
    wsc.dispatchEvent(lv);
    checks.s15_hint_hides_on_leave = $('canvas-dnd-hint').classList.contains('hidden');

    // ===== #16 マス目数の数値設定UI（上部リボン・右パネルと双方向同期） =====
    TraceApp.reset(12, 4);
    checks.s16_top_inputs_exist = !!$('grid-w-top') && !!$('grid-h-top') && !!$('btn-grid-apply');
    $('grid-w-top').value = '30'; $('grid-h-top').value = '20';
    click('btn-grid-apply');
    checks.s16_grid_applied = TraceApp.getDoc().grid.w === 30 && TraceApp.getDoc().grid.h === 20;
    checks.s16_synced_right = $('grid-w').value === '30' && $('grid-h').value === '20';

    // ===== #17 全画面（フォーカス）モード（R4・F/Esc/ボタン・全画面中もツール/ズーム有効） =====
    TraceApp.reset(12, 4); TraceApp.setTool('pen');
    checks.s17_toggle_exists = !!$('btn-focus-toggle');
    checks.s17_off_default = document.body.className.indexOf('focus-mode') < 0 && TraceApp.focusMode() === false;
    key('f');                                             // 全画面ON
    checks.s17_on_after_f = document.body.className.indexOf('focus-mode') >= 0 && TraceApp.focusMode() === true;
    key('e'); checks.s17_tool_in_focus = TraceApp.getTool() === 'eraser';        // 全画面中もツールショートカット有効
    var zf0 = TraceApp.getZoom(); wheelAt(6, 2, -100);
    checks.s17_zoom_in_focus = TraceApp.getZoom() > zf0;                          // 全画面中もホイールズーム有効
    key('Escape');                                        // Esc=全画面解除のみ・ツールは保持
    checks.s17_off_after_esc = TraceApp.focusMode() === false;
    checks.s17_tool_kept_after_esc = TraceApp.getTool() === 'eraser';
    click('btn-focus-toggle'); checks.s17_on_after_btn = TraceApp.focusMode() === true;
    click('btn-focus-toggle'); checks.s17_off_after_btn = TraceApp.focusMode() === false;

    // ===== #18(a) 下絵の大きさスライダー（R4・world単位・中心保持・zoom非依存） =====
    TraceApp.reset(40, 30); TraceApp.zoomReset100(); TraceApp.setUnderlayTest(200, 120, 1);
    checks.s18a_slider_exists = !!$('underlay-scale');
    var uw0 = TraceApp.underlayWorld();
    var wcx0 = uw0.x + uw0.w * uw0.scale / 2, wcy0 = uw0.y + uw0.h * uw0.scale / 2;   // world中心
    $('underlay-scale').value = '60';
    $('underlay-scale').dispatchEvent(new Event('input', { bubbles: true }));
    checks.s18a_width60 = Math.abs(TraceApp.underlayWidthCells() - 60) < 1;            // 横60目相当へ拡縮
    var uw1 = TraceApp.underlayWorld();
    var wcx1 = uw1.x + uw1.w * uw1.scale / 2, wcy1 = uw1.y + uw1.h * uw1.scale / 2;
    checks.s18a_center_kept = Math.abs(wcx1 - wcx0) < 0.01 && Math.abs(wcy1 - wcy0) < 0.01;   // 中心を保って拡縮
    checks.s18a_label = /60/.test($('uscale-val').textContent);

    // ===== #18(b) 下絵移動ツール中の矢印キー微移動（R4・world単位・Shift=1マス・cells不変） =====
    TraceApp.reset(40, 30); TraceApp.zoomReset100(); var ZREF = TraceApp.getZoom(); TraceApp.setUnderlayTest(200, 120, 1);
    TraceApp.setTool('underlay');
    var b0 = TraceApp.underlayWorld();
    key('ArrowRight');                                    // +1 world（x）
    var b1 = TraceApp.underlayWorld();
    checks.s18b_arrow_right_1world = Math.abs((b1.x - b0.x) - 1) < 0.001 && b1.y === b0.y;
    keyShift('ArrowRight');                               // +ZREF world（Shift=1マス）
    var b2 = TraceApp.underlayWorld();
    checks.s18b_shift_arrow_1cell = Math.abs((b2.x - b1.x) - ZREF) < 0.001;
    key('ArrowUp');                                       // -1 world（y）
    var b3 = TraceApp.underlayWorld();
    checks.s18b_arrow_up_1world = Math.abs((b3.y - b2.y) + 1) < 0.001;
    checks.s18b_cells_unaffected = TraceApp.cellCount() === 0;   // 下絵移動はcellsに影響しない

    var ok = Object.keys(checks).every(function (k) { return checks[k]; });
    done({ ok: ok, checks: checks, alerts: window.__alerts, initErr: window.__initErr });
  } catch (e) {
    done({ ok:false, error:(e&&e.message)||String(e), stack:(e&&e.stack)||'' });
  }
}
if (document.readyState === 'complete') runSmoke();
else window.addEventListener('load', runSmoke);
</script>
`;

html = html.replace('</body>', driver + '\n</body>');
fs.writeFileSync(path.join(REPO, 'test', 'trace-editor-smoke.html'), html, 'utf8');
console.log('generated test/trace-editor-smoke.html (' + html.length + ' bytes)');
