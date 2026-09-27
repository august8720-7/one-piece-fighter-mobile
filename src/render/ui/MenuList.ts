import Phaser from 'phaser';
import { Btn, type InputFrame } from '@core/index';
import { sfx } from '../../audio/Sfx';
import { ui, font } from '../screen';
import { readPresentation } from '../presentation';

export interface MenuItem {
  label: string;
  /** 灰显不可选 */
  disabled?: boolean;
}

export type MenuAction = 'select' | 'back' | 'left' | 'right' | null;

export const UI = {
  font: 'Georgia, "Palatino Linotype", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  mono: 'Consolas, "Cascadia Mono", "Microsoft YaHei", monospace',
  title: '#ffd60a',
  text: '#f4efe4',
  dim: '#9aa8b5',
  accent: '#ff9f1c',
  p1: '#e63946',
  p2: '#f4a261',
  panel: 0x0b1220,
};

/**
 * 纵向菜单：上下移动光标，A / Start 确认，B 返回，左右交给调用方处理。
 * 两名玩家的输入都能操作（谁按都行）。
 */
export class MenuList {
  private readonly texts: Phaser.GameObjects.Text[] = [];
  private readonly cursor: Phaser.GameObjects.Text;
  private pending: MenuAction = null;
  index = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    private readonly y: number,
    private items: MenuItem[],
    private readonly lineH = 16,
    fontSize = '11px',
    depth = 5,
  ) {
    this.lineH = ui(lineH);
    fontSize = font(fontSize);
    this.cursor = scene.add.text(x - ui(22), y, '▶', { fontFamily: UI.font, fontSize, color: UI.accent }).setDepth(depth);
    items.forEach((it, i) => {
      const t = scene.add
        .text(x, y + i * this.lineH, it.label, { fontFamily: UI.font, fontSize, color: it.disabled ? UI.dim : UI.text })
        .setDepth(depth);
      this.hook(t, i);
      this.texts.push(t);
    });
    this.refresh();
  }

  private hook(text: Phaser.GameObjects.Text, i: number): void {
    text.setInteractive({ useHandCursor: true });
    text.on('pointerdown', () => {
      if (this.items[i]?.disabled) return;
      this.index = i;
      this.pending = 'select';
      this.refresh();
    });
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    items.forEach((it, i) => this.texts[i]?.setText(it.label));
    this.refresh();
  }

  setLabel(i: number, label: string): void {
    this.items[i]!.label = label;
    this.texts[i]?.setText(label);
  }

  setVisible(v: boolean): void {
    this.cursor.setVisible(v);
    for (const t of this.texts) t.setVisible(v);
  }

  /** 每逻辑帧调用；返回动作 */
  update(edges: InputFrame): MenuAction {
    if (this.pending) {
      const a = this.pending;
      this.pending = null;
      if (a === 'select') sfx().play('menu_confirm');
      return a;
    }
    const e = edges.p1 | edges.p2;
    if (e & Btn.Up) this.move(-1);
    if (e & Btn.Down) this.move(1);
    if (e & (Btn.Up | Btn.Down)) sfx().play('menu_move');
    this.refresh();
    if (e & (Btn.A | Btn.Start)) {
      sfx().play('menu_confirm');
      return 'select';
    }
    if (e & Btn.B) {
      sfx().play('menu_move');
      return 'back';
    }
    if (e & Btn.Left) return 'left';
    if (e & Btn.Right) return 'right';
    return null;
  }

  private move(dir: number): void {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      this.index = (this.index + dir + n) % n;
      if (!this.items[this.index]!.disabled) break;
    }
  }

  private refresh(): void {
    this.cursor.setY(this.y + this.index * this.lineH);
    this.texts.forEach((t, i) => {
      const it = this.items[i]!;
      const color = it.disabled ? UI.dim : i === this.index ? UI.title : UI.text;
      if (t.style.color !== color) t.setColor(color);
    });
  }

  destroy(): void {
    this.cursor.destroy();
    for (const t of this.texts) t.destroy();
  }
}

/** 通用背景板 + 标题：顶上战争黄昏色，不依赖外网字体 */
export function drawPanel(scene: Phaser.Scene, title: string, subtitle = ''): void {
  const { width, height } = scene.scale;
  const g = scene.add.graphics();
  const anime = readPresentation(scene.registry).art === 'anime';
  const bands = anime ? [0x0d1822, 0x10212d, 0x142631, 0x1a2d38, 0x20333d, 0x273b45]
    : [0x141018, 0x1e1520, 0x2c1a24, 0x4a2430, 0x6a322c, 0x7a3a28];
  const bh = height / bands.length;
  bands.forEach((c, i) => g.fillStyle(c, 1).fillRect(0, i * bh, width, bh + 1));
  if (anime && scene.textures.exists('marineford-backdrop')) {
    scene.add.image(width / 2, height / 2, 'marineford-backdrop').setDisplaySize(width, height).setAlpha(0.15);
  } else {
    g.fillStyle(0xffb703, 0.28).fillCircle(width * 0.78, height * 0.4, ui(56));
    g.fillStyle(0xffd60a, 0.1).fillCircle(width * 0.78, height * 0.4, ui(110));
  }
  g.fillStyle(0x2f4858, 0.35).fillRect(0, height * 0.72, width, height * 0.28);
  g.fillStyle(0xc9a227, 1).fillRect(0, 0, width, ui(5));
  g.fillStyle(0x5c3d24, 1).fillRect(0, ui(5), width, ui(2));
  g.fillStyle(0xc9a227, 1).fillRect(0, height - ui(5), width, ui(5));
  g.fillStyle(0x5c3d24, 1).fillRect(0, height - ui(7), width, ui(2));
  if (title) {
    scene.add
      .text(width / 2, ui(36), title, { fontFamily: UI.font, fontSize: font(36), color: UI.title, fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setStroke('#2a1c12', ui(6));
  }
  if (subtitle) {
    scene.add.text(width / 2, ui(82), subtitle, { fontFamily: UI.font, fontSize: font(14), color: UI.dim }).setOrigin(0.5, 0);
  }
}
