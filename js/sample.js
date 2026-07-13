/* sample.js
   組み込みサンプル画像（外部ファイル不要）。高コントラストのロゴ風図形を
   その場でcanvasに描いて dataURL 化する。決定論。 */

(function (global) {
  'use strict';

  /**
   * 高コントラストなロゴ風サンプルを生成して dataURL(png) を返す。
   * 波＋菱形（こぎんっぽい題材：海・菱）を黒地に白で描く。
   */
  function makeSampleDataUrl(size) {
    size = size || 400;
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');

    // 背景（明＝非刺しになる）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    var cx = size / 2, cy = size / 2;

    // 中央の菱形（暗＝刺し）
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.34);
    ctx.lineTo(cx + size * 0.30, cy);
    ctx.lineTo(cx, cy + size * 0.34);
    ctx.lineTo(cx - size * 0.30, cy);
    ctx.closePath();
    ctx.fill();

    // 内側の抜き菱形（明）
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.17);
    ctx.lineTo(cx + size * 0.15, cy);
    ctx.lineTo(cx, cy + size * 0.17);
    ctx.lineTo(cx - size * 0.15, cy);
    ctx.closePath();
    ctx.fill();

    // 中心の点（暗）
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.045, 0, Math.PI * 2);
    ctx.fill();

    // 四隅の三角（暗）でロゴ感
    ctx.fillStyle = '#111111';
    var m = size * 0.16;
    corner(ctx, 0, 0, m, 1, 1);
    corner(ctx, size, 0, m, -1, 1);
    corner(ctx, 0, size, m, 1, -1);
    corner(ctx, size, size, m, -1, -1);

    return c.toDataURL('image/png');
  }

  function corner(ctx, x, y, m, sx, sy) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sx * m, y);
    ctx.lineTo(x, y + sy * m);
    ctx.closePath();
    ctx.fill();
  }

  global.KoginSample = { makeSampleDataUrl: makeSampleDataUrl };
})(window);
