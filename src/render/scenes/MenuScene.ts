import Phaser from 'phaser';
import { sfx } from '../../audio/Sfx';
import { getInputHub } from '@input/InputHub';
import { FixedStep } from '../FixedStep';
import { SCREEN_H, SCREEN_W, font, ui } from '../screen';
import { MenuList, UI, drawPanel } from '../ui/MenuList';
import { confirmHint } from '../ui/controlHint';
import type { GameMode } from './FightScene';
import { adoptPresentation, readPresentation, type PresentationData } from '../presentation';

const ITEMS: { label: string; mode?: GameMode; scene?: string; tutorial?: boolean }[] = [
  { label: '新手引导  TUTORIAL', mode: 'training', tutorial: true },
  { label: '双人对战  VERSUS', mode: 'versus' },
  { label: '人机对战  VS CPU', mode: 'cpu' },
  { label: '训练模式  TRAINING', mode: 'training' },
  { label: '设置 / 声音  SETTINGS', scene: 'Settings' },
];

export class MenuScene extends Phaser.Scene {
  private step = new FixedStep();
  private menu!: MenuList;

  constructor() {
    super('Menu');
  }

  init(data: PresentationData = {}): void { adoptPresentation(this.registry, data); }

  create(): void {
    sfx().resume(); sfx().playMusic('menu');
    drawPanel(this, 'MODE SELECT', `${confirmHint()}   ↑↓ 选择`);
    this.step = new FixedStep();
    this.menu = new MenuList(this, SCREEN_W / 2 - ui(140), ui(180), ITEMS.map((i) => ({ label: i.label })), 40, '22px');
    this.add
      .text(SCREEN_W / 2, SCREEN_H - ui(32), '双人：同一键盘或两个手柄   人机：P1 操作，P2 电脑   训练：无限血气 + 木桩', {
        fontFamily: UI.font,
        fontSize: font(14),
        color: UI.dim,
      })
      .setOrigin(0.5);
    getInputHub().flush();
  }

  override update(_t: number, dt: number): void {
    const steps = this.step.advance(dt);
    const hub = getInputHub();
    for (let i = 0; i < steps; i++) {
      const action = this.menu.update(hub.edges());
      if (action === 'select') {
        const it = ITEMS[this.menu.index]!;
        const profile = readPresentation(this.registry);
        if (it.scene) this.scene.start(it.scene, { back: 'Menu', backData: profile, ...profile });
        else this.scene.start('CharacterSelect', { mode: it.mode, tutorial: it.tutorial, ...profile, scope: 'full' });
        return;
      }
      if (action === 'back') {
        this.scene.start('Title', readPresentation(this.registry));
        return;
      }
    }
  }
}
