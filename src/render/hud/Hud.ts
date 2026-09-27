import Phaser from 'phaser';
import { LOGIC_FPS, MAX_METER, METER_STOCK, type HitEvent, type WorldState, type ControlModes } from '@core/index';
import { LAYOUT_H as SCREEN_H, LAYOUT_W as SCREEN_W } from '../screen';
import { layoutGroup } from '../ui/layoutGroup';
import { UI } from '../ui/MenuList';
import { interfaceFrame } from '../assets';

const BAR_W = 336;
const BAR_H = 26;
const BAR_Y = 16;
const MARGIN = 16;
const METER_W = 264;
const METER_H = 16;
const METER_Y = SCREEN_H - 56;
const PLATE_H = 72;
const PORTRAIT_SIZE = 52;
const PORTRAIT_GAP = 12;
const ANIME = {
  text: '#f1eee5', mutedText: '#a7b8c3', ink: '#101b24', cyanText: '#8dcbd7',
  plate: 0x13212c, border: 0x536a79, hpEmpty: 0x29353f,
  hpFull: 0xaab9a9, hpMid: 0xc6a773, hpLow: 0xcf7370, hpLag: 0x865961,
  meterEmpty: 0x203441, meterFull: 0x6ab6c8, meterPartial: 0x427e98, marker: 0xd4bd91,
};

/** HUD：顶栏血条 + 底部气槽。血条必须一眼能认出来，不能做成细白线。 */
export class Hud {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly timerText: Phaser.GameObjects.Text;
  private readonly roundText: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly combo: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly meterText: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly hpText: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly nameText: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly names: [string, string];
  private lag: [number, number] = [1, 1];
  private comboShow: [{ hits: number; dmg: number; ttl: number }, { hits: number; dmg: number; ttl: number }] = [
    { hits: 0, dmg: 0, ttl: 0 },
    { hits: 0, dmg: 0, ttl: 0 },
  ];

  private readonly quotes: [readonly string[], readonly string[]];
  private quoteText: Phaser.GameObjects.Text;
  private quoteFor: string | null = null;
  private readonly flagText: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly sourceText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, names: [string, string], quotes: [readonly string[], readonly string[]] = [[], []], private readonly theme: 'classic' | 'anime' = 'classic', characterIds?: [string, string], private readonly controlModes: ControlModes = ['classic', 'classic']) {
    const existing = new Set(scene.children.list);
    const anime = theme === 'anime';
    this.quotes = quotes;
    this.names = names;
    this.gfx = scene.add.graphics().setDepth(50).setScrollFactor(0);
    if (anime) for (const side of [0, 1] as const) {
      const x = side === 0 ? MARGIN : SCREEN_W - MARGIN - PORTRAIT_SIZE;
      scene.add.rectangle(x, 10, PORTRAIT_SIZE, PORTRAIT_SIZE, 0x0c151d).setOrigin(0).setStrokeStyle(1, ANIME.border).setDepth(51).setScrollFactor(0);
      const art = characterIds ? interfaceFrame(scene, characterIds[side], 'portrait') : null;
      if (art) {
        const portrait = scene.add.image(x + PORTRAIT_SIZE / 2, 10 + PORTRAIT_SIZE / 2, art.key, art.frame)
          .setOrigin(0.5).setFlipX(side === 1).setDepth(52).setScrollFactor(0);
        portrait.setScale(PORTRAIT_SIZE / Math.max(portrait.width, portrait.height));
      } else {
        scene.add.text(x + PORTRAIT_SIZE / 2, 36, '头像缺失', { fontFamily: UI.font, fontSize: '10px', color: ANIME.mutedText })
          .setOrigin(0.5).setDepth(52).setScrollFactor(0);
      }
    }
    this.quoteText = scene.add
      .text(SCREEN_W / 2, 300, '', { fontFamily: UI.font, fontSize: '18px', color: anime ? ANIME.text : '#fff6d0' })
      .setOrigin(0.5)
      .setDepth(60)
      .setScrollFactor(0)
      .setVisible(false);
    const nameStyle = { fontFamily: UI.font, fontSize: '16px', color: anime ? ANIME.text : '#fff6d0', fontStyle: 'bold' };
    this.nameText = [
      scene.add.text(MARGIN, BAR_Y + BAR_H + 6, names[0], nameStyle).setDepth(51).setScrollFactor(0),
      scene.add
        .text(SCREEN_W - MARGIN, BAR_Y + BAR_H + 6, names[1], nameStyle)
        .setOrigin(1, 0)
        .setDepth(51)
        .setScrollFactor(0),
    ];

    this.timerText = scene.add
      .text(SCREEN_W / 2, 8, '99', { fontFamily: UI.font, fontSize: '36px', color: anime ? ANIME.text : '#fff6d0', fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setDepth(51)
      .setScrollFactor(0)
      .setStroke(anime ? ANIME.ink : '#2a1c12', 5);
    this.roundText = scene.add
      .text(SCREEN_W / 2, 46, '', { fontFamily: UI.font, fontSize: '14px', color: anime ? ANIME.mutedText : '#c9b27a' })
      .setOrigin(0.5, 0)
      .setDepth(51)
      .setScrollFactor(0);

    this.banner = scene.add
      .text(SCREEN_W / 2, 200, '', { fontFamily: UI.font, fontSize: '64px', color: anime ? ANIME.text : '#ffd60a', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(60)
      .setScrollFactor(0)
      .setVisible(false)
      .setStroke(anime ? ANIME.ink : '#2a1c12', 8);
    this.hint = scene.add
      .text(SCREEN_W / 2, 268, '', { fontFamily: UI.font, fontSize: '16px', color: anime ? ANIME.text : '#e0fbfc' })
      .setOrigin(0.5)
      .setDepth(60)
      .setScrollFactor(0)
      .setVisible(false);

    const comboStyle = { fontFamily: UI.font, fontSize: '22px', color: anime ? ANIME.text : '#ffd60a', fontStyle: 'bold' };
    this.combo = [
      scene.add.text(MARGIN, 110, '', comboStyle).setDepth(55).setScrollFactor(0).setVisible(false),
      scene.add.text(SCREEN_W - MARGIN, 110, '', comboStyle).setOrigin(1, 0).setDepth(55).setScrollFactor(0).setVisible(false),
    ];
    const meterStyle = { fontFamily: UI.font, fontSize: '16px', color: anime ? ANIME.cyanText : '#ffd60a', fontStyle: 'bold' };
    this.meterText = [
      scene.add.text(MARGIN + METER_W + 10, METER_Y - 2, '', meterStyle).setDepth(51).setScrollFactor(0),
      scene.add
        .text(SCREEN_W - MARGIN - METER_W - 10, METER_Y - 2, '', meterStyle)
        .setOrigin(1, 0)
        .setDepth(51)
        .setScrollFactor(0),
    ];
    const hpStyle = { fontFamily: UI.font, fontSize: '14px', color: anime ? ANIME.text : '#fff6d0' };
    this.hpText = [
      scene.add.text(MARGIN + 8, BAR_Y + 3, '', hpStyle).setDepth(52).setScrollFactor(0).setStroke(anime ? ANIME.ink : '#2a1c12', 3),
      scene.add
        .text(SCREEN_W - MARGIN - 8, BAR_Y + 3, '', hpStyle)
        .setOrigin(1, 0)
        .setDepth(52)
        .setScrollFactor(0)
        .setStroke(anime ? ANIME.ink : '#2a1c12', 3),
    ];
    const flagStyle = { fontFamily: UI.font, fontSize: '13px', color: anime ? '#d8b99b' : '#ff9f1c' };
    this.flagText = [
      scene.add.text(MARGIN, BAR_Y + BAR_H + 24, '', flagStyle).setDepth(52).setScrollFactor(0),
      scene.add
        .text(SCREEN_W - MARGIN, BAR_Y + BAR_H + 24, '', flagStyle)
        .setOrigin(1, 0)
        .setDepth(52)
        .setScrollFactor(0),
    ];
    this.sourceText = scene.add
      .text(8, anime ? 142 : SCREEN_H - 8, '', { fontFamily: UI.mono, fontSize: '10px', color: anime ? '#93a6b5' : '#5c6b7a' })
      .setOrigin(0, anime ? 0 : 1)
      .setDepth(52)
      .setScrollFactor(0);
    this.sourceText.setVisible(false);
    layoutGroup(scene, scene.children.list.filter(node => !existing.has(node)), 50);
  }

  onEvents(events: readonly HitEvent[], steps: number): void {
    for (const e of events) {
      if (e.kind !== 'hit') continue;
      const s = this.comboShow[e.attacker]!;
      s.hits = e.comboHits;
      s.dmg = e.comboDamage;
      s.ttl = 90;
    }
    for (const s of this.comboShow) if (s.ttl > 0) s.ttl -= steps;
  }

  draw(w: WorldState, extras?: { armor?: [boolean, boolean]; source?: string }): void {
    const g = this.gfx;
    const anime = this.theme === 'anime';
    g.clear();

    if (anime) {
      g.fillStyle(ANIME.plate, 0.94).fillRect(0, 0, SCREEN_W, PLATE_H);
      g.fillStyle(ANIME.border, 0.65).fillRect(0, PLATE_H - 1, SCREEN_W, 1);
      g.fillStyle(0x101b24, 0.96).fillRect(SCREEN_W / 2 - 46, 0, 92, PLATE_H - 5);
      g.fillStyle(ANIME.marker, 0.7).fillRect(MARGIN, 4, 44, 2).fillRect(SCREEN_W - MARGIN - 44, 4, 44, 2);
      g.fillStyle(ANIME.plate, 0.92).fillRect(0, METER_Y - 16, SCREEN_W, SCREEN_H - (METER_Y - 16));
      g.fillStyle(ANIME.border, 0.55).fillRect(0, METER_Y - 16, SCREEN_W, 1);
    } else {
      g.fillStyle(0x07080c, 0.72).fillRect(0, 0, SCREEN_W, PLATE_H);
      g.fillStyle(0xc9a227, 1).fillRect(0, 0, SCREEN_W, 3);
      g.fillStyle(0xe63946, 1).fillRect(0, 3, SCREEN_W, 3);
      g.fillStyle(0x07080c, 0.7).fillRect(0, METER_Y - 16, SCREEN_W, SCREEN_H - (METER_Y - 16));
      g.fillStyle(0xc9a227, 0.85).fillRect(0, SCREEN_H - 4, SCREEN_W, 4);
    }

    for (let i = 0; i < 2; i++) {
      const f = w.fighters[i]!;
      const ratio = Math.max(0, f.hp / f.def.maxHp);
      const lag = this.lag[i]!;
      this.lag[i] = lag > ratio ? Math.max(ratio, lag - 0.006) : ratio;

      const barMargin = MARGIN + (anime ? PORTRAIT_SIZE + PORTRAIT_GAP : 0);
      const x0 = i === 0 ? barMargin : SCREEN_W - barMargin - BAR_W;
      g.fillStyle(anime ? 0x0c151d : 0x000000, 1).fillRect(x0 - 3, BAR_Y - 3, BAR_W + 6, BAR_H + 6);
      g.fillStyle(anime ? ANIME.hpEmpty : 0x3d2a2a, 1).fillRect(x0, BAR_Y, BAR_W, BAR_H);

      const drawBar = (r: number, color: number) => {
        const wpx = Math.max(0, Math.round(BAR_W * r));
        if (wpx <= 0) return;
        const x = i === 0 ? x0 + BAR_W - wpx : x0;
        g.fillStyle(color, 1).fillRect(x, BAR_Y, wpx, BAR_H);
      };
      drawBar(this.lag[i]!, anime ? ANIME.hpLag : 0x9b2226);
      const fill = anime ? ratio <= 0.25 ? ANIME.hpLow : ratio <= 0.5 ? ANIME.hpMid : ANIME.hpFull
        : ratio <= 0.25 ? 0xe63946 : ratio <= 0.5 ? 0xf4a261 : 0xffd60a;
      drawBar(ratio, fill);
      g.lineStyle(2, anime ? ANIME.border : 0xfff6d0, anime ? 0.95 : 0.9).strokeRect(x0 - 2, BAR_Y - 2, BAR_W + 4, BAR_H + 4);

      const hp = Math.max(0, Math.ceil(f.hp));
      this.nameText[i]!.setText(this.names[i]!).setPosition(i === 0 ? x0 : x0 + BAR_W, BAR_Y + BAR_H + 6).setOrigin(i === 0 ? 0 : 1, 0);
      this.hpText[i]!.setText(`${hp}`).setPosition(i === 0 ? x0 + 8 : x0 + BAR_W - 8, BAR_Y + 3).setOrigin(i === 0 ? 0 : 1, 0);

      for (let r = 0; r < 2; r++) {
        const won = w.wins[i]! > r;
        const mx = anime ? i === 0 ? x0 + BAR_W - 9 - r * 16 : x0 + 9 + r * 16 : i === 0 ? x0 + BAR_W + 11 + r * 16 : x0 - 17 - r * 16;
        const my = anime ? BAR_Y + BAR_H + 15 : BAR_Y + BAR_H / 2;
        g.fillStyle(0x000000, 0.65).fillCircle(mx, my, 6);
        g.fillStyle(anime ? won ? ANIME.marker : 0x354753 : won ? 0xffd60a : 0x3a3a5a, 1).fillCircle(mx, my, 4);
      }

      const flags: string[] = [];
      if (f.install) flags.push(`${f.install === 'gear2' ? '二档' : f.install} ${Math.ceil(f.installFrames / 60)}s`);
      if (f.fatigueFrames > 0) flags.push('疲劳');
      if (f.burnFrames > 0) flags.push(`灼烧 ${Math.ceil(f.burnFrames / 60)}s`);
      if (f.state === 'block_stand' || f.state === 'block_crouch') flags.push('防御');
      if (extras?.armor?.[i]) flags.push('霸体');
      if (f.armorBroken && f.state === 'attack') flags.push('破霸');
      this.flagText[i]!.setText(flags.join('  ')).setPosition(i === 0 ? x0 : x0 + BAR_W, BAR_Y + BAR_H + 24).setOrigin(i === 0 ? 0 : 1, 0);

      if (this.controlModes[i] === 'classic') {
      const mx0 = i === 0 ? MARGIN : SCREEN_W - MARGIN - METER_W;
      g.fillStyle(anime ? 0x0c151d : 0x000000, 1).fillRect(mx0 - 3, METER_Y - 3, METER_W + 6, METER_H + 6);
      g.fillStyle(anime ? ANIME.meterEmpty : 0x2a1f12, 1).fillRect(mx0, METER_Y, METER_W, METER_H);
      const stocks = Math.floor(f.meter / METER_STOCK);
      const segW = METER_W / (MAX_METER / METER_STOCK);
      for (let s = 0; s < MAX_METER / METER_STOCK; s++) {
        const fillAmt = Math.max(0, Math.min(1, (f.meter - s * METER_STOCK) / METER_STOCK));
        const sx = i === 0 ? mx0 + s * segW : mx0 + METER_W - (s + 1) * segW;
        const wpx = Math.round((segW - 4) * fillAmt);
        const fx = i === 0 ? sx + 2 : sx + (segW - 2) - wpx;
        g.fillStyle(anime ? fillAmt >= 1 ? ANIME.meterFull : ANIME.meterPartial : fillAmt >= 1 ? 0xffd60a : 0xf77f00, 1).fillRect(fx, METER_Y + 2, wpx, METER_H - 4);
      }
      g.lineStyle(2, anime ? ANIME.border : 0xc9b27a, 0.75).strokeRect(mx0 - 2, METER_Y - 2, METER_W + 4, METER_H + 4);
      this.meterText[i]!.setText(`${stocks}`);
      } else this.meterText[i]!.setVisible(false);

      const cs = this.comboShow[i]!;
      const t = this.combo[i]!;
      if (cs.ttl > 0 && cs.hits >= 2) {
        t.setText(`${cs.hits} HITS\n${cs.dmg}`).setVisible(true).setAlpha(Math.min(1, cs.ttl / 20));
      } else {
        t.setVisible(false);
      }
    }

    this.timerText.setText(w.timer < 0 ? '∞' : String(Math.ceil(w.timer / LOGIC_FPS)));
    this.roundText.setText(`ROUND ${w.round}`);
    this.sourceText.setText(extras?.source ? `素材 ${extras.source}` : '');

    switch (w.phase) {
      case 'intro':
        this.showBanner(w.phaseFrame < 40 ? `ROUND ${w.round}` : 'READY', '');
        break;
      case 'fight':
        if (w.phaseFrame < 40) this.showBanner('FIGHT!', '');
        else this.hideBanner();
        break;
      case 'round_end': {
        const byTime = w.timer === 0;
        const title = byTime ? 'TIME OVER' : w.phaseFrame < 40 ? 'K.O.' : `ROUND ${w.round}`;
        const sub = w.roundWinner === null ? 'DRAW' : `${w.fighters[w.roundWinner]!.def.name} WINS`;
        this.showBanner(title, sub);
        this.showQuote(w, w.phaseFrame > 40);
        break;
      }
      case 'match_end': {
        const winner = w.wins[0]! > w.wins[1]! ? 0 : 1;
        this.showBanner(`${w.fighters[winner]!.def.name} WINS`, 'Enter / NumEnter 继续');
        this.showQuote(w, true);
        break;
      }
    }
    if (w.phase !== 'round_end' && w.phase !== 'match_end') {
      this.quoteText.setVisible(false);
      this.quoteFor = null;
    }
  }

  private showQuote(w: WorldState, visible: boolean): void {
    if (w.roundWinner === null) return;
    const key = `${w.round}:${w.roundWinner}`;
    if (this.quoteFor !== key) {
      const pool = this.quotes[w.roundWinner] ?? [];
      const q = pool.length ? pool[(w.frame + w.round) % pool.length]! : '';
      this.quoteText.setText(q ? `“${q}”` : '');
      this.quoteFor = key;
    }
    this.quoteText.setVisible(visible && this.quoteText.text.length > 0);
  }

  private showBanner(title: string, sub: string): void {
    this.banner.setText(title).setVisible(true);
    this.hint.setText(sub).setVisible(sub.length > 0);
  }

  private hideBanner(): void {
    this.banner.setVisible(false);
    this.hint.setVisible(false);
  }

  reset(): void {
    this.lag = [1, 1];
    for (const combo of this.comboShow) { combo.hits = 0; combo.dmg = 0; combo.ttl = 0; }
    for (const text of this.combo) text.setVisible(false);
    this.quoteFor = null;
    this.quoteText.setVisible(false);
    this.banner.setVisible(false);
    this.hint.setVisible(false);
  }
}
