/* trace-config.js
   こぎんトレース台エディタ T0 — 全設定・仮値の集約点。
   ★ 未確定値（floatMax以外）はすべてここに集約する。ここ以外にマジックナンバーを置かない。
   ブラウザ: window.TRACE_CONFIG / Node: module.exports（テストからも参照可）。 */
(function () {
  'use strict';

  var TRACE_CONFIG = {
    floatMax: 7,               // 変更禁止（所長確認済みの producible 制約）
    oddSnapDefault: false,     // 奇数スナップ既定OFF
    evenRunPolicy: 'warn',     // 'warn'固定（errorにしない）。所長回答C-1'で見直し
    defaultTool: 'pen',        // 'pen'|'diag'。実演確認で pen 確定（池田さんのマス目塗り実見・2026-07-22）
    cellAspect: 1.0,           // 仮。G-1実測（10目分の縦mm÷横mm）で差し替え
    undoDepth: 50,
    autosaveDebounceMs: 800,
    zoom: { min: 4, max: 28, init: 10 },
    gridLimit: { min: 3, max: 200 },
    PRESETS: [
      { id: 'coaster',   name: 'コースター（仮）',           w: 41, h: 41 },
      { id: 'meishiire', name: '名刺入れ（約・要実測確定）', w: 80, h: 100 },  // 横80×縦100
      { id: 'custom',    name: 'カスタム', w: null, h: null }
    ],
    // 地布プリセット（仮・G-2実測で hex/名称を差し替え）。先頭が新規ドキュメントの既定。
    // 「自由な色」は id:'custom' ＋ doc.fabricHex（カラーピッカー）で表す＝ここには列挙しない。
    FABRICS: [
      { id: 'navy',    name: '紺（仮）',       hex: '#1B2440' },
      { id: 'indigo',  name: '藍（仮）',       hex: '#2C4A70' },
      { id: 'black',   name: '黒（仮）',       hex: '#14161A' },
      { id: 'brown',   name: 'こげ茶（仮）',   hex: '#4A3A2E' },
      { id: 'gray',    name: '灰（仮）',       hex: '#7C838C' },
      { id: 'graylt',  name: '薄グレー（仮）', hex: '#C9CCD1' },
      { id: 'kinari',  name: '生成（仮）',     hex: '#F2EEE3' },
      { id: 'white',   name: '白（仮）',       hex: '#FFFFFF' }
    ],
    FABRIC_CUSTOM_ID: 'custom',      // カラーピッカーで選んだ自由な色（hexは doc.fabricHex）
    PALETTE: [   // 仮6色（在庫実測G-2で全hex/名称/糸番号を差し替え）
      { id: 'w01', name: '白（仮）',   code: '仮-01', hex: '#F2EEE3' },
      { id: 'r01', name: '赤（仮）',   code: '仮-02', hex: '#B7282E' },
      { id: 'y01', name: '山吹（仮）', code: '仮-03', hex: '#E3A93D' },
      { id: 'g01', name: '若葉（仮）', code: '仮-04', hex: '#6E9E4F' },
      { id: 'b01', name: '水色（仮）', code: '仮-05', hex: '#7FAFD4' },
      { id: 'n01', name: '紺（仮）',   code: '仮-06', hex: '#27407A' }
    ],
    CHART_SYMBOLS: ['●', '▲', '■', '◆', '✚', '★'] // ● ▲ ■ ◆ ✚ ★
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = TRACE_CONFIG; }
  if (typeof window !== 'undefined') { window.TRACE_CONFIG = TRACE_CONFIG; }
})();
