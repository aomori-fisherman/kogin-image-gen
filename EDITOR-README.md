# こぎんトレース台エディタ T0.5（editor.html）

> 作成: 2026-07-22 ／ T0.5改修: 2026-07-23 ／ スコープ: 「デジタルトレース台」
> 実装スペック正本: `ops/notes/kogin-editor-t0-spec-2026-07-22.md`（夢波リポ側）／ 改修方針: `FEEDBACK.md`
> ※ 既存 `index.html`（画像→こぎん変換MVP）とは**独立の別ページ**。README.md・既存jsは不変。

## これは何か

グリッド紙をデジタルにした「トレース台」。下絵（写真・図案）を敷いて、その上をマス目単位で
糸色を塗り、実際に刺せる（渡り≤7目）か検証して、記号チャートを印刷/PNG出力するツール。

- vanilla JS・依存ゼロ・ビルド不要・ネット接続不要。`file://` でダブルクリックで動く。
- **糸色・寸法・記法・セル縦横比はすべて「仮」**。実測後に `js/trace-config.js` の該当行だけ差し替える。
- 自動グリッド化・モドコスタンプ・仕上がりビューは T1（この版には無い）。

## T0.5 改修サマリー（2026-07-23・FEEDBACK.md の T0.5行き）

- **UIレイアウト刷新**（#1/#5/#10）: 上部リボン=低頻度（ファイル/表示/検証・格納可能）／左サイド=高頻度（ツール・パレット・取消/やり直し・範囲選択の操作）／右サイド=グリッド設定/下絵は**折りたたみ既定**／中央キャンバス可変幅で最大化。
- **切れ目（break）**（#3/#5）: 同色隣接ランを意図的に分割する疎オーバーレイ `doc.breaks={y:[x,...]}` を新設。8目以上の同色面を切れ目で分割して producible（渡り≤7）化できる。
- **ツール名称・導線**（#11）: 「ラン選択」/「矩形選択」に差別化。範囲操作ボタンは rectSel/clip 無し時に disabled 表示＋ヒント、押下時は次の一手を提示（alertにしない）。連続ペーストはステップ表示。
- **下絵マス目フィット**（#2）: 「横N目/縦N目に合わせる」で一発フィット（単一スケール=縦横比維持）。
- **消しゴム両対応**（#9）: 自由方向消し（行ロックなし）＋全消去ボタン（確認付き）。
- **パレット**（#4）: 実色は未追加（池田さん実測待ち）。`trace-config.js` 1ファイル差し替えで拡充できる構造は維持。
- スコープ外（T1のまま）: モドコスタンプ(#7)・自動グリッド化(#8)・パレット実色・紙チャートへの切れ目表示（画面表示とfloat検証のみ）。`floatMax=7` は不変。

## 開き方

```
C:\dev\kogin-image-gen\editor.html をブラウザでダブルクリック。
```

- 起動時、前回の自動保存があれば「続きを開くか」聞かれる（キャンセルで新規）。
- 既定グリッド = 名刺入れプリセット 80×100目（仮・要実測）。

## 画面レイアウト（T0.5）

- **上部リボン**（低頻度・「▾ メニュー」で格納可）: ファイル（保存/読込）・表示（ズーム/グリッド線/5目/中心線/濃さ）・検証（統計/float・偶数バッジ/チャート出力）。
- **左サイド**（高頻度）: ツール一覧・ツール別ヒント・取消/やり直し・全消去・糸色/布地・範囲選択の操作（コピー/一括塗り/一括消し/連続ペースト）。
- **右サイド**（グリッド設定・下絵）: **折りたたみ既定**。キャンバス上の「⚙ 設定パネル」で開閉。
- **中央キャンバス**: 右パネルの開閉に応じて可変幅で最大化。

## 操作（ツールはキー1〜7でも切替）

| キー | ツール | 操作 |
|---|---|---|
| 1 | ペン（塗り・既定） | セルからドラッグで水平ラン（開始行にY固定）。放すと確定 |
| 2 | 斜線（補助） | ドラッグで傾き±1の階段（1行1目）。控え機能 |
| 3 | 消しゴム | クリック/ドラッグで**自由方向消去**（行ロックなし・T0.5で変更） |
| 4 | ラン選択 | 非nullセルをクリックでラン選択（切れ目でも分割）。←/→移動・↑/↓行移動・Shift+←/→右端伸縮・Alt+←/→左端伸縮・Delete削除・Esc解除・パレットクリックで再着色 |
| 5 | 矩形選択 | ドラッグで矩形→左「範囲選択の操作」の[コピー]/[一括塗り]/[一括消し]/[連続ペースト…] |
| 6 | 下絵移動 | ドラッグで移動・ホイールで拡縮（cellsには影響しない） |
| 7 | 切れ目 | 同色ランの**マス境界**をクリックで切れ目をトグル（渡りを分割／再クリックで解除） |

- 取消/やり直し: Ctrl+Z / Ctrl+Y（ボタンも有り）。入力欄フォーカス中はショートカット無効。
- 奇数スナップ（既定OFF）: 偶数長ランを1目伸縮して奇数に寄せる補助。
- 検証パネル: 総目数/渡り本数/使用色/最長渡り/`float>7`箇所（赤・**チャート不可**）/偶数ラン箇所（黄・警告のみ）。**切れ目で分割したランは分割後の長さで判定**（8目→切れ目→4+4で違反解消）。
- チャート出力: 記号グリッド＋凡例＋注記を1枚のSVGで生成→印刷（A4縦）/PNG保存。**紙チャートは従来のセル記号のまま**（切れ目は画面表示とfloat検証のみ・要確認事項として保留）。
- 全消去: 左パネルの「全消去（クリア）」＝確認ダイアログ後に cells と切れ目を全消去（undoで戻せる）。
- 下絵フィット: 右パネル下絵の「横N目/縦N目に合わせる」＝下絵を指定マス目幅にスケール（縦横比維持）。
- 保存: 手動=JSONダウンロード、自動=localStorage（各操作後800msデバウンス）。`doc.breaks` も保存/復元（旧JSONは切れ目なしとして後方互換）。

## 切れ目（break）の仕組み（#3/#5・データモデル）

- **課題**: `doc.cells[y][x]` は `null|colorId` のスカラーのみで、同色隣接ラン（3目＋隣接4目＝7目1本）を物理的に区別できない。幅7目超の同色面は複数の渡りに分けて留める＝この「分割」を表現する場所が無かった。
- **解**: `cells` は不変のまま、別レイヤ `doc.breaks = { "y": [x, ...] }`（疎オーバーレイ・`x` は x-1↔x の間の強制ラン境界）を追加。
- 3つのラン導出関数が切れ目でも分割する: `TraceValidate.extractRunsMulti(row, breaksRow)` / `TraceRender.rowRuns(row, breaksRow)` / `TraceState.runAt(cells, x, y, breaksRow)`（いずれも第2/第4引数省略時は従来動作＝後方互換）。
- 既定挙動は**従来通り統合**。ユーザーが「切れ目」ツールで明示的に分割する（自動では切らない）。
- 掃除規則（簡易）: セル消去で片側が null になった切れ目は削除。ラン移動（moveRun）に切れ目は引き継がない。寸法変更で範囲外の切れ目は落ちる。
- undo/redo・serialize/deserialize は切れ目を保持。画面ではバーが分割描画＋境界に仕切りマーカー。

## 仮値の差し替え（`js/trace-config.js` の該当行だけで完結）

- `cellAspect`: 実測（10目分の縦mm÷横mm）で数値1つ更新。
- `PALETTE`: 在庫写真から hex・名称・実糸番号を上書き。
- `PRESETS`: 御守り等を実測後に追加。
- `floatMax = 7` は**変更禁止**（所長確認済みの producible 制約）。

## テスト再現

純関数（Node・DOM不要）:

```
node test/trace-state-test.cjs      # 92 passed（T0.5でbreak層+27）
node test/trace-validate-test.cjs   # 27 passed（T0.5でbreak分割+12）
```

ヘッドレスUI（実アプリを MouseEvent 合成＋公開APIで駆動）:

```
# 実editor.html DOMのスモークは editor.html から毎回生成してから開く（構造変更に追従）
node test/gen-editor-smoke.cjs      # → test/trace-editor-smoke.html を生成

"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu ^
  --window-size=1400,1000 --user-data-dir=%TEMP%\kogin-trace-chrome --virtual-time-budget=8000 ^
  --dump-dom "file:///C:/dev/kogin-image-gen/test/trace-harness.html"
# 出力DOMの <div id="trace-harness-result"> の RESULT:{...} で "ok":true を確認
#   trace-harness.html        機能ハーネス（ペン/斜線/矩形/チャート/roundtrip＋break E2E）
#   trace-ui-path-probe.html  範囲操作の導線（T0.5=disabled表示＋ガイド提示・alertゼロ／20チェック）
#   trace-editor-smoke.html   実editor.html DOMを生成して駆動（レイアウト/切れ目/消し/全消し・24チェック）
```

既存テスト（改修後も green を維持）:

```
node test/algo-test.cjs             # 12 passed
node test/producible-test.cjs       # 3320 passed
node test/pipeline-producible.cjs   # TOTAL violations = 0
# test/harness.html を headless Chrome で開くと画像パイプラインが ok:true
```

## ファイル（T0=新規／T0.5=改修）

```
editor.html                エディタページ（独立・T0.5でリボン＋3列レイアウトに刷新）
css/editor.css             エディタ専用CSS（style.css は触らない・T0.5レイアウト対応）
js/trace-config.js         全設定・仮値の集約（TRACE_CONFIG）※実色差し替えはここ1ファイル
js/trace-state.js          ドキュメントモデル・編集純関数・undo/redo・保存・breaks（Node両用）
js/trace-validate.js       多色ラン抽出（breaks分割）・float/偶数ラン検出・集計（Node両用）
js/trace-render.js         cells → SVGレイヤ文字列（breaks分割描画＋切れ目マーカー）
js/trace-chart.js          チャートSVG生成・印刷・PNG書き出し（T0.5では不変）
js/trace-app.js            配線層（ツール7種・切れ目/消し/フィット/導線ガード・保存）
test/trace-state-test.cjs      純関数テスト（92）
test/trace-validate-test.cjs   純関数テスト（27）
test/trace-harness.html        機能ハーネス（break E2E含む）
test/trace-ui-path-probe.html  範囲操作の導線プローブ（T0.5導線・20チェック）
test/gen-editor-smoke.cjs      実editor.html→スモークHTML生成器
test/trace-editor-smoke.html   生成物（実DOMスモーク・24チェック）
```
