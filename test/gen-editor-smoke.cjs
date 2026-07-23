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
