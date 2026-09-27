import Phaser from 'phaser';
import { Btn } from '@core/index';
import { characters } from '@characters/index';
import { sfx } from '../../audio/Sfx';
import { getInputHub } from '@input/InputHub';
import { areAnimeInterfacesReady, interfaceFrame, loadAnimeInterfaces, spriteFrame } from '../assets';
import { sharedDownloads, warmFightDownloads } from '../assetDownloads';
import { FixedStep } from '../FixedStep';
import { SCREEN_H, SCREEN_W, font, ui } from '../screen';
import { UI, drawPanel } from '../ui/MenuList';
import { confirmHint } from '../ui/controlHint';
import { adoptPresentation, readPresentation, type PresentationData } from '../presentation';
import { audioQuickControls } from '../ui/audioQuickControls';
import { TITLE_CHARACTER_IDS } from '../ui/titleRoster';

export class TitleScene extends Phaser.Scene {
  private step = new FixedStep();
  private prompt!: Phaser.GameObjects.Text;
  private frame = 0;
  private leaving = false;
  private ready = false;

  constructor() {
    super('Title');
  }

  init(data: PresentationData = {}): void { this.ready = false; adoptPresentation(this.registry, data); }

  create(): void {
    const profile = readPresentation(this.registry);
    if (profile.art === 'anime' && !areAnimeInterfacesReady(this, TITLE_CHARACTER_IDS)) {
      this.scene.start('Preload', { p1: 'luffy', p2: 'akainu', mode: 'cpu', destination: 'Title', ...profile });
      return;
    }
    sfx().resume(); sfx().playMusic('menu');
    this.leaving = false;
    this.frame = 0;
    this.step = new FixedStep();
    drawPanel(this, '');
    const anime = readPresentation(this.registry).art === 'anime';
    const rosterIds = Object.keys(characters);
    const titleFrames = rosterIds.flatMap(id => {
      const frame = anime ? interfaceFrame(this, id, 'body') : spriteFrame(this, id, 'portrait');
      return frame ? [{ id, frame }] : [];
    });
    const leftFrame = titleFrames.find(item => item.id === 'labubu') ?? titleFrames[0];
    const rightFrame = titleFrames.find(item => item.id === 'twinkle') ?? (titleFrames.length > 1 ? titleFrames[1] : undefined);
    if (leftFrame) {
      const art = this.add.sprite(ui(140), SCREEN_H - ui(80), leftFrame.frame.key, leftFrame.frame.frame).setOrigin(0.5, 1).setDepth(1);
      art.setScale(Math.min(ui(300) / art.height, ui(240) / art.width));
    }
    if (rightFrame) {
      const art = this.add.sprite(SCREEN_W - ui(140), SCREEN_H - ui(80), rightFrame.frame.key, rightFrame.frame.frame).setOrigin(0.5, 1).setFlipX(true).setDepth(1);
      art.setScale(Math.min(ui(300) / art.height, ui(240) / art.width));
    }
    if (anime && titleFrames.length < 2) {
      this.add.text(SCREEN_W / 2, ui(410), '界面人物图未载入，请返回加载页重试', { fontFamily: UI.font, fontSize: font(14), color: UI.accent }).setOrigin(0.5).setDepth(3);
    }
    const deco = this.add.graphics().setDepth(2);
    deco.lineStyle(ui(2), 0x7ad8ff, 0.24);
    deco.strokeCircle(SCREEN_W / 2, ui(194), ui(132));
    deco.lineStyle(ui(1), 0xffd75a, 0.28);
    for (let i = -2; i <= 2; i++) deco.strokeRect(SCREEN_W / 2 + ui(i * 58 - 13), ui(87 + Math.abs(i) * 13), ui(26), ui(26));
    this.add.rectangle(SCREEN_W / 2, ui(196), ui(460), ui(210), 0x0b1220, 0.38).setDepth(2);
    this.add
      .text(SCREEN_W / 2, ui(132), 'CROSSOVER', { fontFamily: UI.font, fontSize: font(44), color: UI.p1, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(3)
      .setStroke('#2a1c12', ui(8));
    this.add
      .text(SCREEN_W / 2, ui(196), 'CLASH', { fontFamily: UI.font, fontSize: font(62), color: UI.title, fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(3)
      .setStroke('#2a1c12', ui(8));
    this.add
      .text(SCREEN_W / 2, ui(250), `四人联动 · ${Object.values(characters).reduce((sum, def) => sum + (def.skillSlots?.length ?? 0), 0)}项一键技能`, { fontFamily: UI.font, fontSize: font(18), color: UI.text })
      .setOrigin(0.5)
      .setDepth(3);
    this.prompt = this.add
      .text(SCREEN_W / 2, ui(360), confirmHint(), { fontFamily: UI.font, fontSize: font(22), color: UI.accent })
      .setOrigin(0.5)
      .setDepth(3);
    this.add
      .text(SCREEN_W / 2, SCREEN_H - ui(28), '四角色联动 · 桌面版', {
        fontFamily: UI.font,
        fontSize: font(13),
        color: UI.dim,
      })
      .setOrigin(0.5)
      .setDepth(3);
    getInputHub().flush();
    this.prompt.setInteractive({ useHandCursor: true }).once('pointerdown', () => this.enterMenu());
    audioQuickControls(this, ui(435));
    this.add.text(SCREEN_W / 2, ui(479), '游玩冻结 1.0 原版 ↗', { fontFamily: UI.font, fontSize: font(15), color: UI.title }).setOrigin(0.5).setDepth(3).setInteractive({ useHandCursor: true }).on('pointerdown', () => { window.location.assign(new URL('v1/', new URL('./', window.location.href)).href); });
    if (anime) {
      const downloads = sharedDownloads(this.game);
      sfx().useDownloads(downloads);
      // Old fighters' UI is not shown here. Warm it now; CharacterSelect gates every entry.
      void loadAnimeInterfaces(this, rosterIds, downloads).catch(() => { /* The selection gate reports and retries. */ });
      // No character ids here: title warms common bytes only. Character payloads
      // are promoted after an explicit lock in CharacterSelect.
      void warmFightDownloads(downloads).catch(() => { /* The match gate reports and retries failed resources. */ });
    }
    // Navigation-relative timing ends only after the title's controls are bound.
    this.ready = true;
    performance.mark('opf:title-ready');
  }

  private enterMenu(): void {
    if (this.leaving) return;
    this.leaving = true;
    sfx().unlock();
    sfx().play('menu_confirm');
    this.scene.start('Menu', readPresentation(this.registry));
  }

  override update(_t: number, dt: number): void {
    if (!this.ready) return;
    const steps = this.step.advance(dt);
    const hub = getInputHub();
    for (let i = 0; i < steps; i++) {
      this.frame++;
      const e = hub.edges();
      if ((e.p1 | e.p2) & (Btn.Start | Btn.A | Btn.B | Btn.C | Btn.D)) {
        this.enterMenu();
        return;
      }
    }
    this.prompt.setVisible(this.frame % 60 < 40);
  }
}
