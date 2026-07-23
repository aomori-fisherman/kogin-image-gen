# こぎんトレース台エディタ T0（editor.html）

> 作成: 2026-07-22 ／ スコープ: T0「デジタルトレース台」のみ
> 実装スペック正本: `ops/notes/kogin-editor-t0-spec-2026-07-22.md`（夢波リポ側）
> ※ 既存 `index.html`（画像→こぎん変換MVP）とは**独立の別ページ**。README.md・既存jsは不変。

## これは何か

グリッド紙をデジタルにした「トレース台」。下絵（写真・図案）を敷いて、その上をマス目単位で
糸色を塗り、実際に刺せる（渡り≤7目）か検証して、記号チャートを印刷/PNG出力するツール。

- vanilla JS・依存ゼロ・ビルド不要・ネット接続不要。`file://` でダブルクリックで動く。
- **糸色・寸法・記法・セル縦横比はすべて「仮」**。実測後に `js/trace-config.js` の該当行だけ差し替える。
- 自動グリッド化・モドコスタンプ・仕上がりビューは T1（この版には無い）。

## 開き方

```
C:\dev\kogin-image-gen\editor.html をブラウザでダブルクリック。
```

- 起動時、前回の自動保存があれば「続きを開くか」聞かれる（キャンセルで新規）。
- 既定グリッド = 名刺入れプリセット 80×100目（仮・要実測）。

## 操作（ツールはキー1〜6でも切替）

| キー | ツール | 操作 |
|---|---|---|
| 1 | ペン（塗り・既定） | セルからドラッグで水平ラン（開始行にY固定）。放すと確定 |
| 2 | 斜線（補助） | ドラッグで傾き±1の階段（1行1目）。控え機能 |
| 3 | 消しゴム | クリック/ドラッグで行固定消去 |
| 4 | 選択（ラン） | 非nullセルをクリックでラン選択。←/→移動・↑/↓行移動・Shift+←/→右端伸縮・Alt+←/→左端伸縮・Delete削除・Esc解除・パレットクリックで再着色 |
| 5 | 範囲選択 | ドラッグで矩形→[コピー]/[一括塗り]/[一括消し]/[連続ペースト…] |
| 6 | 下絵移動 | ドラッグで移動・ホイールで拡縮（cellsには影響しない） |

- 取消/やり直し: Ctrl+Z / Ctrl+Y（ボタンも有り）。入力欄フォーカス中はショートカット無効。
- 奇数スナップ（既定OFF）: 偶数長ランを1目伸縮して奇数に寄せる補助。
- 検証パネル: 総目数/渡り本数/使用色/最長渡り/`float>7`箇所（赤・**チャート不可**）/偶数ラン箇所（黄・警告のみ）。
- チャート出力: 記号グリッド＋凡例＋注記を1枚のSVGで生成→印刷（A4縦）/PNG保存。
- 保存: 手動=JSONダウンロード、自動=localStorage（各操作後800msデバウンス）。

## 仮値の差し替え（`js/trace-config.js` の該当行だけで完結）

- `cellAspect`: 実測（10目分の縦mm÷横mm）で数値1つ更新。
- `PALETTE`: 在庫写真から hex・名称・実糸番号を上書き。
- `PRESETS`: 御守り等を実測後に追加。
- `floatMax = 7` は**変更禁止**（所長確認済みの producible 制約）。

## テスト再現

純関数（Node・DOM不要）:

```
node test/trace-state-test.cjs      # 65 passed
node test/trace-validate-test.cjs   # 15 passed
```

ヘッドレスUI（実アプリを MouseEvent 合成＋公開APIで駆動）:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu ^
  --window-size=1400,1000 --user-data-dir=%TEMP%\kogin-trace-chrome --virtual-time-budget=8000 ^
  --dump-dom "file:///C:/dev/kogin-image-gen/test/trace-harness.html"
# 出力DOMの <div id="trace-harness-result"> の RESULT:{...} で "ok":true を確認
```

既存テスト（改修後も green を維持）:

```
node test/algo-test.cjs             # 12 passed
node test/producible-test.cjs       # 3320 passed
node test/pipeline-producible.cjs   # TOTAL violations = 0
# test/harness.html を headless Chrome で開くと画像パイプラインが ok:true
```

## ファイル（すべて新規・既存は不変）

```
editor.html                エディタページ（独立）
css/editor.css             エディタ専用CSS（style.css は触らない）
js/trace-config.js         全設定・仮値の集約（TRACE_CONFIG）
js/trace-state.js          ドキュメントモデル・編集純関数・undo/redo・保存（Node両用）
js/trace-validate.js       多色ラン抽出・float/偶数ラン検出・集計（Node両用）
js/trace-render.js         cells → SVGレイヤ文字列
js/trace-chart.js          チャートSVG生成・印刷・PNG書き出し
js/trace-app.js            配線層（ツール・ポインタ・キーボード・パネル・保存）
test/trace-state-test.cjs  / test/trace-validate-test.cjs  / test/trace-harness.html
```
