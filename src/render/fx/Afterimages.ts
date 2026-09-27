import Phaser from 'phaser';

interface SpriteGhost {
  sprite: Phaser.GameObjects.Sprite;
  life: number;
  maxLife: number;
}

interface BoxGhost {
  alive: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  life: number;
  maxLife: number;
}

/**
 * 击飞 / 突进残影。精灵图集可用时叠半透明帧，否则画色块。
 * 屏幕坐标；每逻辑帧 tick，每渲染帧 draw。
 */
export class Afterimages {
  private readonly scene: Phaser.Scene;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly sprites: SpriteGhost[] = [];
  private readonly boxes: BoxGhost[] = [];
  private spriteCursor = 0;
  private static readonly SPRITE_CAP = 24;
  private static readonly BOX_CAP = 24;

  constructor(scene: Phaser.Scene, private readonly worldLayer?: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.gfx = scene.add.graphics().setDepth(9);
    this.worldLayer?.add(this.gfx);
    for (let i = 0; i < Afterimages.BOX_CAP; i++) {
      this.boxes.push({ alive: false, x: 0, y: 0, w: 0, h: 0, color: 0xffffff, life: 0, maxLife: 1 });
    }
  }

  spawnSprite(key: string, frame: string, x: number, y: number, flip: boolean, tint?: number, scale = 1): void {
    if (!this.scene.textures.exists(key) || !this.scene.textures.get(key).has(frame)) return;
    const slot = this.nextSprite(key);
    slot.life = 8;
    slot.maxLife = 8;
    slot.sprite.setTexture(key, frame);
    const fr = slot.sprite.frame;
    slot.sprite
      .setOrigin(fr.customPivot ? fr.pivotX : 0.5, fr.customPivot ? fr.pivotY : 1)
      .setPosition(Math.round(x), Math.round(y))
      .setFlipX(flip)
      .setScale(scale)
      .setVisible(true)
      .setAlpha(0.4)
      .setDepth(9);
    if (tint === undefined) slot.sprite.clearTint();
    else slot.sprite.setTint(tint);
  }

  spawnBox(x: number, y: number, w: number, h: number, color: number): void {
    const slot = this.boxes.find((b) => !b.alive) ?? this.boxes[0]!;
    slot.alive = true;
    slot.x = x;
    slot.y = y;
    slot.w = w;
    slot.h = h;
    slot.color = color;
    slot.life = 8;
    slot.maxLife = 8;
  }

  tick(): void {
    for (const g of this.sprites) {
      if (g.life <= 0) continue;
      if (--g.life <= 0) g.sprite.setVisible(false);
      else g.sprite.setAlpha(0.4 * (g.life / g.maxLife));
    }
    for (const b of this.boxes) {
      if (!b.alive) continue;
      if (--b.life <= 0) b.alive = false;
    }
  }

  /** A ghost remains at its recorded world position while the camera pans. */
  shiftCamera(dx: number): void {
    for (const ghost of this.sprites) if (ghost.life > 0) ghost.sprite.x += dx;
    for (const ghost of this.boxes) if (ghost.alive) ghost.x += dx;
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const b of this.boxes) {
      if (!b.alive) continue;
      g.fillStyle(b.color, 0.32 * (b.life / b.maxLife)).fillRect(b.x, b.y, b.w, b.h);
    }
  }

  clear(): void {
    for (const g of this.sprites) {
      g.life = 0;
      g.sprite.setVisible(false);
    }
    for (const b of this.boxes) b.alive = false;
    this.gfx.clear();
  }

  private nextSprite(key: string): SpriteGhost {
    if (this.sprites.length < Afterimages.SPRITE_CAP) {
      const sprite = this.scene.add.sprite(0, 0, key).setVisible(false).setDepth(9).setOrigin(0.5, 1);
      this.worldLayer?.add(sprite);
      const ghost: SpriteGhost = { sprite, life: 0, maxLife: 1 };
      this.sprites.push(ghost);
      return ghost;
    }
    const slot = this.sprites[this.spriteCursor]!;
    this.spriteCursor = (this.spriteCursor + 1) % this.sprites.length;
    return slot;
  }
}
