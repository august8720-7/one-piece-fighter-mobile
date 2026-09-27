import Phaser from 'phaser';
import { Btn, type ControlModes, type InputFrame } from '@core/index';
import { characters } from '@characters/index';
import { getInputHub } from '@input/InputHub';
import { keyLabel } from '@input/keymap';
import type { Difficulty } from '../../ai/types';
import { sfx } from '../../audio/Sfx';
import { sharedDownloads, warmFightDownloads } from '../assetDownloads';
import { areAnimeInterfacesReady, interfaceFrame, spriteFrame } from '../assets';
import { FixedStep } from '../FixedStep';
import { adoptPresentation, readPresentation, type PresentationData } from '../presentation';
import { SCREEN_W, font, ui } from '../screen';
import { UI, drawPanel } from '../ui/MenuList';
import { characterSelectLayout } from '../ui/characterSelectLayout';
import { confirmHint } from '../ui/controlHint';
import { controlModeLabel, matchControls } from '../ui/matchControls';
import { VoiceSubtitles } from '../ui/VoiceSubtitles';
import type { FightSceneData, GameMode } from './FightScene';

interface Data extends PresentationData {
  p1?: string;
  p2?: string;
  mode: GameMode;
  difficulty?: Difficulty;
  tutorial?: boolean;
  controlModes?: ControlModes;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const DIFF_LABEL: Record<Difficulty, string> = { easy: '简单 EASY', normal: '普通 NORMAL', hard: '困难 HARD' };
const PLAYER_COLORS = [0xe63946, 0xf4a261] as const;
const IDS = Object.keys(characters);

function updateText(target: Phaser.GameObjects.Text, value: string): void {
  if (target.text !== value) target.setText(value);
}

function representativeSkills(id: string): string {
  const def = characters[id]!;
  const names = (def.skillSlots ?? [])
    .slice(0, 2)
    .map(moveId => def.moves.find(move => move.id === moveId)?.name)
    .filter((name): name is string => !!name);
  return names.length ? `代表技  ${names.join('  /  ')}` : '代表技尚未配置';
}

/** Two large current picks stay readable while the lightweight roster remains visible below. */
export class CharacterSelectScene extends Phaser.Scene {
  private entryData: Partial<Data> = {};
  private ready = false;
  private step = new FixedStep();
  private mode: GameMode = 'versus';
  private cursor: [number, number] = [0, 1];
  private locked: [boolean, boolean] = [false, false];
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private status!: Phaser.GameObjects.Text;
  private countdown = -1;
  private confirmation = 0;
  private difficulty: Difficulty = 'normal';
  private tutorial = false;
  private controlModes: ControlModes = ['simple', 'simple'];
  private modesText!: Phaser.GameObjects.Text;
  private diffText: Phaser.GameObjects.Text | null = null;
  private portraits: [Phaser.GameObjects.Sprite | null, Phaser.GameObjects.Sprite | null] = [null, null];
  private portraitAssets: [string, string] = ['', ''];
  private unavailable!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private names!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private taglines!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private skills!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private lockLabels!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly layout = characterSelectLayout(IDS.length);

  constructor() { super('CharacterSelect'); }

  init(data: Data): void {
    this.entryData = { ...data };
    this.ready = false;
    adoptPresentation(this.registry, data);
    const modes = data?.controlModes ?? getInputHub().controlModes;
    this.controlModes = [modes[0], modes[1]];
    getInputHub().setControlModes(this.controlModes);
    this.mode = data?.mode ?? 'versus';
    this.difficulty = data?.difficulty ?? 'normal';
    this.tutorial = !!data?.tutorial;
    this.cursor = [0, Math.min(1, IDS.length - 1)];
    this.locked = [false, false];
    this.countdown = -1;
    this.confirmation = 0;
    this.diffText = null;
    this.portraits = [null, null];
    this.portraitAssets = ['', ''];
  }

  create(): void {
    const profile = readPresentation(this.registry);
    if (profile.art === 'anime' && !areAnimeInterfacesReady(this, IDS)) {
      this.scene.start('Preload', {
        ...this.entryData, ...profile,
        p1: this.entryData.p1 ?? IDS[0]!, p2: this.entryData.p2 ?? IDS[1]!,
        mode: this.mode, difficulty: this.difficulty, tutorial: this.tutorial,
        controlModes: [...this.controlModes], destination: 'CharacterSelect',
      });
      return;
    }
    sfx().resume();
    sfx().playMusic('menu');
    new VoiceSubtitles(this, 100);
    this.step = new FixedStep();
    const sub = this.mode === 'versus'
      ? `P1 / P2 各自锁定   ←→ 选择   ${confirmHint()}`
      : this.mode === 'cpu'
        ? `P1 依次选择自己与对手   ${confirmHint()}   ↑↓ 难度`
        : `P1 依次选择自己与木桩   ${confirmHint()}`;
    drawPanel(this, 'CROSSOVER SELECT', sub);

    const glow = this.add.graphics().setDepth(1);
    glow.fillStyle(0x79d7ff, 0.08).fillCircle(SCREEN_W / 2, ui(196), ui(96));
    glow.lineStyle(ui(2), 0xffd75a, 0.35).strokeCircle(SCREEN_W / 2, ui(196), ui(66));
    glow.fillStyle(0xffd75a, 0.7).fillPoints([
      new Phaser.Geom.Point(SCREEN_W / 2, ui(137)),
      new Phaser.Geom.Point(SCREEN_W / 2 + ui(8), ui(188)),
      new Phaser.Geom.Point(SCREEN_W / 2, ui(255)),
      new Phaser.Geom.Point(SCREEN_W / 2 - ui(8), ui(188)),
    ], true);
    this.add.text(SCREEN_W / 2, ui(184), 'VS', {
      fontFamily: UI.font, fontSize: font(34), color: UI.title, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(5).setStroke('#2a1c12', ui(5));

    const unavailable: Phaser.GameObjects.Text[] = [];
    const names: Phaser.GameObjects.Text[] = [];
    const taglines: Phaser.GameObjects.Text[] = [];
    const skills: Phaser.GameObjects.Text[] = [];
    const lockLabels: Phaser.GameObjects.Text[] = [];
    for (const player of [0, 1] as const) {
      const panel = this.layout.playerPanels[player];
      this.add.rectangle(ui(panel.x), ui(panel.y), ui(panel.width), ui(panel.height), 0x09131e, 0.88)
        .setOrigin(0).setDepth(2).setStrokeStyle(ui(2), PLAYER_COLORS[player], 0.9);
      this.add.rectangle(
        ui(player === 0 ? panel.x : panel.x + panel.width - 8), ui(panel.y), ui(8), ui(panel.height),
        PLAYER_COLORS[player], 0.9,
      ).setOrigin(0).setDepth(3);
      const portraitX = player === 0 ? panel.x + 86 : panel.x + panel.width - 86;
      const textX = player === 0 ? panel.x + 170 : panel.x + panel.width - 170;
      const originX = player === 0 ? 0 : 1;
      names.push(this.add.text(ui(textX), ui(panel.y + 25), '', {
        fontFamily: UI.font, fontSize: font(26), color: player === 0 ? UI.p1 : UI.p2, fontStyle: 'bold',
      }).setOrigin(originX, 0).setDepth(5));
      taglines.push(this.add.text(ui(textX), ui(panel.y + 67), '', {
        fontFamily: UI.font, fontSize: font(14), color: UI.text, align: player === 0 ? 'left' : 'right',
        wordWrap: { width: ui(175) },
      }).setOrigin(originX, 0).setDepth(5));
      skills.push(this.add.text(ui(textX), ui(panel.y + 126), '', {
        fontFamily: UI.font, fontSize: font(12), color: UI.accent, align: player === 0 ? 'left' : 'right',
        wordWrap: { width: ui(185) },
      }).setOrigin(originX, 0).setDepth(5));
      unavailable.push(this.add.text(ui(portraitX), ui(panel.y + 94), '界面图不可用', {
        fontFamily: UI.font, fontSize: font(13), color: UI.dim, align: 'center',
      }).setOrigin(0.5).setDepth(5));
      lockLabels.push(this.add.text(
        ui(textX), ui(panel.y + panel.height - 26), '',
        { fontFamily: UI.font, fontSize: font(13), color: '#101820', backgroundColor: player === 0 ? UI.p1 : UI.p2, fontStyle: 'bold' },
      ).setOrigin(originX, 0.5).setPadding(ui(8), ui(3)).setDepth(6));
    }
    this.unavailable = unavailable as [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    this.names = names as [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    this.taglines = taglines as [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    this.skills = skills as [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    this.lockLabels = lockLabels as [Phaser.GameObjects.Text, Phaser.GameObjects.Text];

    this.layout.rosterTiles.forEach((tile, index) => {
      const id = IDS[index]!;
      const def = characters[id]!;
      const card = this.add.rectangle(ui(tile.x), ui(tile.y), ui(tile.width), ui(tile.height), 0x111f2b, 0.96)
        .setOrigin(0).setDepth(2).setStrokeStyle(ui(1), 0x577080, 0.8);
      const art = this.selectionFrame(id, 'portrait');
      if (art) {
        const avatar = this.add.sprite(ui(tile.x + 34), ui(tile.y + tile.height / 2), art.key, art.frame).setDepth(3);
        avatar.setScale(Math.min(ui(58) / Math.max(1, avatar.width), ui(68) / Math.max(1, avatar.height)));
      } else {
        this.add.text(ui(tile.x + 34), ui(tile.y + 35), '界面图\n不可用', {
          fontFamily: UI.font, fontSize: font(10), color: UI.dim, align: 'center',
        }).setOrigin(0.5).setDepth(4);
      }
      this.add.text(ui(tile.x + 68), ui(tile.y + 20), def.name, {
        fontFamily: UI.font, fontSize: font(17), color: UI.text, fontStyle: 'bold',
      }).setOrigin(0, 0).setDepth(4);
      this.add.text(ui(tile.x + 68), ui(tile.y + 49), def.tagline ?? '打法待配置', {
        fontFamily: UI.font, fontSize: font(10), color: UI.dim, wordWrap: { width: ui(tile.width - 76) },
      }).setOrigin(0, 0).setDepth(4);
      if (this.mode !== 'versus') {
        card.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.selectSoloByPointer(index));
      }
    });

    this.cursorGfx = this.add.graphics().setDepth(7);
    this.status = this.add.text(SCREEN_W / 2, ui(this.layout.statusY), '', {
      fontFamily: UI.font, fontSize: font(18), color: UI.accent, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0).setDepth(7);
    if (this.mode === 'cpu') {
      this.diffText = this.add.text(SCREEN_W / 2, ui(451), '', {
        fontFamily: UI.font, fontSize: font(14), color: UI.title,
      }).setOrigin(0.5, 0).setDepth(7);
    }
    this.modesText = this.add.text(SCREEN_W / 2, ui(this.layout.controlsY), '', {
      fontFamily: UI.font, fontSize: font(12), color: UI.text, align: 'center', lineSpacing: ui(3),
    }).setOrigin(0.5, 0).setDepth(7);
    getInputHub().flush();
    this.ready = true;
    this.draw();
  }

  override update(_t: number, dt: number): void {
    if (!this.ready) return;
    const steps = this.step.advance(dt);
    const hub = getInputHub();
    for (let i = 0; i < steps; i++) {
      const edges = hub.edges();
      if (this.countdown >= 0) {
        if (--this.countdown === 0) {
          this.start();
          return;
        }
        continue;
      }
      if (!this.locked[0] && !this.locked[1] && ((edges.p1 | edges.p2) & Btn.B)) {
        sfx().play('menu_move');
        this.scene.start('Menu', readPresentation(this.registry));
        return;
      }
      if (this.mode === 'versus') this.handleVersus(edges);
      else this.handleSolo(edges);
    }
    this.draw();
  }

  private handleVersus(edges: InputFrame): void {
    for (const player of [0, 1] as const) {
      const bits = player === 0 ? edges.p1 : edges.p2;
      if (this.locked[player]) {
        if (bits & Btn.B) {
          this.locked[player] = false;
          sfx().play('menu_move');
        }
        continue;
      }
      if (bits & Btn.C) this.toggleControls(player);
      this.moveCursor(player, bits);
      if (bits & (Btn.A | Btn.Start)) this.lockPlayer(player);
    }
    if (this.locked[0] && this.locked[1] && this.countdown < 0) this.countdown = 45;
  }

  private handleSolo(edges: InputFrame): void {
    const bits = edges.p1;
    const player = this.locked[0] ? 1 : 0;
    if (player === 0 && (bits & Btn.C)) this.toggleControls(0);
    if (this.mode === 'cpu' && (bits & (Btn.Up | Btn.Down))) {
      const index = DIFFICULTIES.indexOf(this.difficulty);
      this.difficulty = DIFFICULTIES[(index + (bits & Btn.Down ? 1 : DIFFICULTIES.length - 1)) % DIFFICULTIES.length]!;
      sfx().play('menu_move');
    }
    if ((bits & Btn.B) && this.locked[0]) {
      this.locked[0] = false;
      sfx().play('menu_move');
      return;
    }
    this.moveCursor(player, bits);
    if (bits & (Btn.A | Btn.Start)) {
      this.lockPlayer(player);
      if (player === 1) this.countdown = 45;
    }
  }

  private moveCursor(player: 0 | 1, bits: number): void {
    if (bits & Btn.Left) {
      this.cursor[player] = (this.cursor[player] + IDS.length - 1) % IDS.length;
      sfx().play('menu_move');
    }
    if (bits & Btn.Right) {
      this.cursor[player] = (this.cursor[player] + 1) % IDS.length;
      sfx().play('menu_move');
    }
  }

  private lockPlayer(player: 0 | 1): void {
    if (this.locked[player]) return;
    this.locked[player] = true;
    const characterId = IDS[this.cursor[player]]!;
    sfx().play('menu_confirm');
    sfx().playPresentation({ phase: 'select', key: `select-${++this.confirmation}`, characterId, player });
    // Locking raises only this fighter's bytes. Cursor movement never preloads the roster.
    if (readPresentation(this.registry).art === 'anime') {
      void warmFightDownloads(sharedDownloads(this.game), [characterId]).catch(() => undefined);
    }
  }

  private selectSoloByPointer(index: number): void {
    if (this.mode === 'versus' || this.countdown >= 0) return;
    const player = this.locked[0] ? 1 : 0;
    this.cursor[player] = index;
    this.lockPlayer(player);
    if (player === 1) this.countdown = 45;
    this.draw();
  }

  private toggleControls(side: 0 | 1): void {
    const modes: [ControlModes[0], ControlModes[1]] = [this.controlModes[0], this.controlModes[1]];
    modes[side] = modes[side] === 'simple' ? 'classic' : 'simple';
    this.controlModes = modes;
    getInputHub().setControlModes(modes);
    sfx().play('menu_move');
  }

  private selectionFrame(id: string, kind: 'body' | 'portrait'): { key: string; frame: string } | null {
    return readPresentation(this.registry).art === 'anime'
      ? interfaceFrame(this, id, kind)
      : spriteFrame(this, id, kind === 'portrait' ? 'portrait' : 'idle');
  }

  private start(): void {
    const data: FightSceneData = {
      p1: IDS[this.cursor[0]]!, p2: IDS[this.cursor[1]]!, mode: this.mode,
      controlModes: matchControls(this.mode, this.controlModes), difficulty: this.difficulty,
      tutorial: this.tutorial, ...readPresentation(this.registry),
    };
    this.scene.start('Preload', data);
  }

  private refreshPlayer(player: 0 | 1): void {
    const id = IDS[this.cursor[player]]!;
    const def = characters[id]!;
    const panel = this.layout.playerPanels[player];
    const portraitX = player === 0 ? panel.x + 86 : panel.x + panel.width - 86;
    const art = this.selectionFrame(id, 'body');
    if (art) {
      const identity = `${art.key}:${art.frame}`;
      let portrait = this.portraits[player];
      if (!portrait) {
        portrait = this.add.sprite(ui(portraitX), ui(panel.y + 98), art.key, art.frame).setDepth(4);
        this.portraits[player] = portrait;
      } else if (this.portraitAssets[player] !== identity) portrait.setTexture(art.key, art.frame);
      portrait.setVisible(true).setFlipX(player === 1);
      portrait.setScale(Math.min(ui(142) / Math.max(1, portrait.width), ui(154) / Math.max(1, portrait.height)));
      this.portraitAssets[player] = identity;
      this.unavailable[player].setVisible(false);
    } else {
      this.portraits[player]?.setVisible(false);
      this.portraitAssets[player] = '';
      this.unavailable[player].setVisible(true);
    }
    updateText(this.names[player], def.name);
    updateText(this.taglines[player], def.tagline ?? '打法定位待配置');
    updateText(this.skills[player], representativeSkills(id));
    const owner = player === 0 ? 'P1' : this.mode === 'versus' ? 'P2' : this.mode === 'cpu' ? 'CPU' : '木桩';
    updateText(this.lockLabels[player], `${owner} ${this.locked[player] ? '✓ 已锁定' : '选择中'}`);
  }

  private draw(): void {
    this.refreshPlayer(0);
    this.refreshPlayer(1);
    const graphics = this.cursorGfx;
    graphics.clear();
    for (const player of [0, 1] as const) {
      const tile = this.layout.rosterTiles[this.cursor[player]]!;
      const inset = player === 0 ? 3 : 7;
      graphics.lineStyle(ui(this.locked[player] ? 4 : 3), PLAYER_COLORS[player], this.locked[player] ? 1 : 0.82);
      graphics.strokeRoundedRect(ui(tile.x - inset), ui(tile.y - inset), ui(tile.width + inset * 2), ui(tile.height + inset * 2), ui(7));
      graphics.fillStyle(PLAYER_COLORS[player], 1).fillRect(
        ui(player === 0 ? tile.x + 5 : tile.x + tile.width - 31), ui(tile.y + 5), ui(26), ui(15),
      );
    }
    const p1Name = characters[IDS[this.cursor[0]]!]!.name;
    const p2Name = characters[IDS[this.cursor[1]]!]!.name;
    updateText(this.status, this.countdown >= 0
      ? `${p1Name}  VS  ${p2Name}   ·   FIGHT!`
      : this.mode === 'versus'
        ? `P1 ${this.locked[0] ? '✓' : '…'} ${p1Name}     P2 ${this.locked[1] ? '✓' : '…'} ${p2Name}`
        : this.locked[0]
          ? `玩家：${p1Name} ✓     现在选择${this.mode === 'cpu' ? 'CPU' : '木桩'}：${p2Name}`
          : `选择玩家角色：${p1Name}`);
    if (this.diffText) updateText(this.diffText, `CPU 难度：◀ ${DIFF_LABEL[this.difficulty]} ▶`);
    const p2Mode = this.mode === 'versus' ? `P2 ${controlModeLabel(this.controlModes[1])}` : '对手 经典操作';
    const controlsHint = this.mode === 'versus'
      ? `${keyLabel(getInputHub().keyConfig.p1.C)} / ${keyLabel(getInputHub().keyConfig.p2.C)} 各自切换操作`
      : `${keyLabel(getInputHub().keyConfig.p1.C)} 切换P1操作`;
    updateText(this.modesText,
      `P1 ${controlModeLabel(this.controlModes[0])}    ·    ${p2Mode}\n${controlsHint}    B 取消 / 返回`,
    );
  }
}
