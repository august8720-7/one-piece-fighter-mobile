import Phaser from 'phaser';
import { STAGE_LEFT, STAGE_RIGHT, SUBPIXEL } from '@core/index';
import { LAYOUT_H, LAYOUT_W, RENDER_SCALE, SCREEN_H, SCREEN_W, UI_SCALE } from '../screen';

/**
 * 马林梵多：图片舞台可用时优先使用，缺图时回退到程序化舞台。
 * anime 样板保留完整同源构图，不把裁出的地面假装成独立透视层。
 *
 * 视差系数：远景 0.15，中景 0.45，近景（地面）1.0。
 * 世界逻辑像素 → 屏幕：SCREEN_W/2 + (x - camera*k) * RENDER_SCALE。
 */
export class Marineford {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly backdrop: Phaser.GameObjects.Image | null;
  private readonly floor: Phaser.GameObjects.TileSprite | null;
  /** 灰烬：固定种子伪随机的初始位置，随时间下落 */
  private readonly ash: { x: number; y: number; s: number; v: number }[] = [];

  constructor(scene: Phaser.Scene, private readonly groundY: number, private readonly style: 'classic' | 'anime' = 'classic') {
    // Procedural stage details retain their 960 x 540 design coordinates.
    // Only this graphics object is scaled; image layers use actual backing pixels.
    this.gfx = scene.add.graphics().setDepth(-10).setScale(UI_SCALE);
    this.backdrop = scene.textures.exists('marineford-backdrop')
      ? scene.add.image(SCREEN_W / 2, 0, 'marineford-backdrop').setOrigin(0.5, 0).setDisplaySize(style === 'anime' ? SCREEN_W : 1200 * UI_SCALE, SCREEN_H).setDepth(-20)
      : null;
    this.floor = style === 'classic' && this.backdrop && scene.textures.exists('marineford-floor')
      ? scene.add.tileSprite(0, 356 * UI_SCALE, SCREEN_W, SCREEN_H - 356 * UI_SCALE, 'marineford-floor').setOrigin(0).setDepth(-15)
      : null;
    this.floor?.setTileScale(0.78 * UI_SCALE, (SCREEN_H - 356 * UI_SCALE) / 349);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 80; i++) {
      this.ash.push({ x: rnd() * 1400 - 700, y: rnd() * groundY / UI_SCALE, s: 1.2 + rnd() * 2.2, v: 0.18 + rnd() * 0.55 });
    }
  }

  draw(cameraX: number, frame: number): void {
    const g = this.gfx;
    g.clear();
    const cam = cameraX / SUBPIXEL;
    const gy = this.groundY / UI_SCALE;
    const S = RENDER_SCALE / UI_SCALE;
    const width = LAYOUT_W, height = LAYOUT_H;
    if (this.backdrop) {
      if (this.style === 'anime') {
        // One complete image spans the viewport at every camera position. No separate floor pan,
        // repeated crop or exposed image edge can break the original building/floor perspective.
        this.backdrop.x = SCREEN_W / 2;
        const laneTop = Math.max(height * 0.45, gy - 200);
        g.fillGradientStyle(0x24333f, 0x24333f, 0x24333f, 0x24333f, 0, 0, 0.18, 0.18)
          .fillRect(0, laneTop, width, gy - laneTop);
        g.fillStyle(0x24333f, 0.18).fillRect(0, gy, width, height - gy);
        for (let i = 0; i < 16; i++) {
          const a = this.ash[i]!;
          const x = ((a.x + 700 + frame * 0.08) % (width + 20)) - 10;
          const y = (a.y + frame * a.v * 0.2) % (gy * 0.62);
          g.fillStyle(0xb8c7cf, 0.12).fillRect(x, y, a.s * 0.5, a.s * 0.5);
        }
        return;
      }
      const halfBackdrop = this.backdrop.displayWidth / 2;
      const desiredX = SCREEN_W / 2 - cam * 0.16 * RENDER_SCALE;
      // The image has finite margins; KO pushback can move the camera beyond them.
      this.backdrop.x = Math.max(SCREEN_W - halfBackdrop, Math.min(halfBackdrop, desiredX));
      if (this.floor) this.floor.tilePositionX = cam * S / 0.78;
      // Small distant flashes and ash; the central combat lane remains quiet.
      for (const a of this.ash.slice(0, 28)) {
        const x = ((a.x + 700 + frame * 0.11 - cam * 0.1) % (width + 20)) - 10;
        const y = (a.y + frame * a.v * 0.25) % (gy * 0.72);
        g.fillStyle(a.s > 2.4 ? 0xe89a4a : 0xa1acb8, 0.2).fillRect(x, y, a.s * 0.6, a.s * 0.6);
      }
      g.fillStyle(0x101827, 0.10).fillRect(0, 290, width, height - 290);
      if (frame % 251 < 3) g.fillStyle(0xffb660, 0.08).fillEllipse(110, 254, 70, 32);
      return;
    }
    const far = (x: number) => width / 2 + (x - cam * 0.15) * S;
    const mid = (x: number) => width / 2 + (x - cam * 0.45) * S;
    const near = (x: number) => width / 2 + (x - cam) * S;

    const anime = this.style === 'anime';
    const bands = anime ? [0x192735, 0x213443, 0x2b4253, 0x385165, 0x486275, 0x657b88, 0x85969c]
      : [0x12101a, 0x1b1524, 0x2a1a2c, 0x4a2436, 0x7a3a32, 0xa8503a, 0xc4623a];
    const bandH = gy / bands.length;
    bands.forEach((c, i) => g.fillStyle(c, 1).fillRect(0, i * bandH, width, bandH + 1));

    const sunX = width * 0.72 - cam * 0.05 * S;
    const sunY = gy * 0.56;
    g.fillStyle(anime ? 0xe8e0cb : 0xff6b35, anime ? 0.06 : 0.2).fillCircle(sunX, sunY, 108);
    g.fillStyle(anime ? 0xe8e0cb : 0xffb703, anime ? 0.12 : 0.38).fillCircle(sunX, sunY, 68);
    g.fillStyle(anime ? 0xd4dbd8 : 0xffd60a, anime ? 0.65 : 1).fillCircle(sunX, sunY, 34);
    g.fillStyle(anime ? 0xf1eee5 : 0xfff3c4, anime ? 0.3 : 0.9).fillCircle(sunX - 6, sunY - 6, 12);

    const seaY = gy * 0.68;
    g.fillStyle(0x1a3344, 1).fillRect(0, seaY, width, gy - seaY);
    g.fillStyle(0x3d6d7a, 1).fillRect(0, seaY, width, 8);
    for (let i = 0; i < 7; i++) {
      const y = seaY + 14 + i * 8;
      const a = 0.08 + ((frame + i * 11) % 40) / 220;
      g.fillStyle(0x8ecae6, a).fillRect(0, y, width, 2);
    }

    const buildings = [
      [-460, 44, 52],
      [-390, 70, 38],
      [-330, 56, 64],
      [-250, 88, 48],
      [-180, 62, 86],
      [-70, 110, 54],
      [10, 128, 70],
      [100, 76, 78],
      [196, 92, 46],
      [268, 58, 68],
      [350, 80, 50],
      [430, 50, 58],
    ];
    for (const [bx, bh, bw] of buildings) {
      const sx = far(bx!);
      const top = seaY - bh! * S;
      g.fillStyle(0x152230, 1).fillRect(sx, top, bw! * S, bh! * S);
      g.fillStyle(0x0c141c, 1).fillRect(sx + 6, top + 8, bw! * S - 12, 4);
      g.fillStyle(0x1d3344, 1).fillRect(sx + 2, top, 3, bh! * S);
      for (let wy = top + 16; wy < seaY - 8; wy += 14) {
        for (let wx = sx + 8; wx < sx + bw! * S - 8; wx += 14) {
          if (((wx * 7 + wy * 13) | 0) % 5 === 0) g.fillStyle(0xffb703, 0.5).fillRect(wx, wy, 3, 3);
        }
      }
    }

    const hq = far(-8);
    g.fillStyle(0x1a2c3a, 1).fillRect(hq, seaY - 148, 84, 148);
    g.fillStyle(0x243848, 1).fillRect(hq + 18, seaY - 176, 48, 28);
    g.fillStyle(0xcfd8dc, 1).fillRect(hq + 40, seaY - 210, 4, 34);
    g.fillStyle(0x1565c0, 1).fillRect(hq + 44, seaY - 208, 28, 16);
    g.fillStyle(0xffd60a, 0.7).fillCircle(hq + 42, seaY - 212, 4);

    for (const fx of [-490, 500]) {
      const sx = far(fx);
      g.fillStyle(0xcfd8dc, 1).fillRect(sx, seaY - 150, 3, 150);
      g.fillStyle(0x1565c0, 1).fillRect(sx + 3, seaY - 148, 28, 18);
      g.fillStyle(0xffd60a, 1).fillRect(sx + 10, seaY - 142, 8, 6);
    }

    const px0 = mid(0);
    g.fillStyle(0x323246, 1).fillRect(px0 - 200, seaY - 8, 400, gy - seaY + 8);
    g.fillStyle(0x3b3b4f, 1).fillRect(px0 - 110, seaY - 18, 220, gy - seaY + 18);
    g.fillStyle(0xcbb89a, 1).fillRect(px0 - 168, seaY - 12, 336, 6);
    g.fillStyle(0xa89070, 1).fillRect(px0 - 168, seaY - 6, 336, 3);
    g.fillStyle(0x4b4b63, 1).fillRect(px0 - 22, seaY - 118, 44, 100);
    g.fillStyle(0x5c5c78, 1).fillRect(px0 - 66, seaY - 130, 132, 14);
    g.fillStyle(0xe8dcc8, 1).fillRect(px0 - 70, seaY - 134, 140, 6);
    g.fillStyle(0x2e2e3e, 1).fillRect(px0 - 6, seaY - 168, 12, 38);
    g.fillStyle(0x2e2e3e, 1).fillRect(px0 - 40, seaY - 168, 80, 8);
    g.fillStyle(0x8d99ae, 0.25).fillRect(px0 - 66, seaY - 130, 132, 3);
    for (const rail of [-150, -90, 90, 150]) {
      g.fillStyle(0xd9cbb0, 1).fillRect(px0 + rail, seaY - 28, 3, 16);
    }

    for (let i = -16; i <= 16; i++) {
      const cx = mid(i * 32 + ((i * 7) % 5) * 3);
      const h = (11 + ((i * 13) % 7)) * S;
      g.fillStyle(0x1c1c2c, 1).fillRect(cx, gy - 14 - h, 9 * S * 0.5, h);
      g.fillStyle(0x1c1c2c, 1).fillCircle(cx + 4, gy - 16 - h, 5);
    }

    g.fillStyle(anime ? 0x3e4a55 : 0x35384c, 1).fillRect(0, gy, width, height - gy);
    g.fillStyle(anime ? 0x596774 : 0x4a5168, 1).fillRect(0, gy, width, 5);
    g.fillStyle(anime ? 0x9caaaf : 0x6c7690, 0.55).fillRect(0, gy, width, 2);
    const left = near(STAGE_LEFT / SUBPIXEL);
    const right = near(STAGE_RIGHT / SUBPIXEL);
    for (let x = Math.floor(STAGE_LEFT / SUBPIXEL / 36) * 36; x < STAGE_RIGHT / SUBPIXEL; x += 36) {
      const sx = near(x);
      g.lineStyle(1, 0x2b2d42, 0.55).lineBetween(sx, gy + 6, sx + 16, height);
      g.lineStyle(1, 0x2b2d42, 0.35).lineBetween(sx + 18, gy + 12, sx + 40, gy + 36);
      g.fillStyle(0x2f3144, 0.18).fillRect(sx, gy + 6, 34, 10);
    }
    g.fillStyle(0x8d99ae, 0.28).fillRect(left - 8, 0, 8, gy);
    g.fillStyle(0x8d99ae, 0.28).fillRect(right, 0, 8, gy);

    for (const a of this.ash) {
      const y = (a.y + frame * a.v) % gy;
      const x = near(a.x) + Math.sin((frame + a.x) * 0.02) * 8;
      if (x < -6 || x > width + 6) continue;
      g.fillStyle(anime ? 0xb8c7cf : a.s > 2.4 ? 0xff9f1c : 0xe8e0d0, anime ? 0.2 : 0.5).fillRect(x, y, a.s, a.s);
    }
  }
}
