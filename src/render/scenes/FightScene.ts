import { VoiceSubtitles } from '../ui/VoiceSubtitles';
import type { ControlModes } from '@core/index';
import { matchControls } from '../ui/matchControls';
import { SkillBar } from '../hud/SkillBar';
import Phaser from 'phaser';
import { DailyAudio } from '../../audio/DailyAudio';
import {
  FightSim,
  GROUND_Y,
  SUBPIXEL,
  totalFrames,
  type FighterDef,
  type FighterState,
  type ProjectileState,
  type WorldState,
} from '@core/index';
import { RENDER_SCALE, SCREEN_H, SCREEN_W, UI_SCALE, ui, font } from '../screen';
import { characterAnims, characters } from '@characters/index';
import { getInputHub } from '@input/InputHub';
import { captureTrainingInput } from '@input/trainingBuffer';
import { Btn } from '@core/index';
import { Cpu } from '../../ai/cpu';
import { Dummy } from '../../ai/dummy';
import type { Difficulty } from '../../ai/types';
import { characterAi } from '@characters/index';
import { FixedStep } from '../FixedStep';
import { DebugOverlay } from '../DebugOverlay';
import { FighterView } from '../FighterView';
import { Hud } from '../hud/Hud';
import { Marineford } from '../stage/Marineford';
import { Afterimages } from '../fx/Afterimages';
import { Particles } from '../fx/Particles';
import { SkillEffects } from '../fx/SkillEffects';
import { activeSegment, endedProjectileVisual, projectileMaterial, projectileMoveMaterial } from '../fx/movePresentation';
import { animDrawScale, currentAnimation, frameName, validateAnimeRuntimeManifest, type AnimTable, type CharacterPresentation } from '../animations';
import { sfx, sfxHudText } from '../../audio/Sfx';
import { MenuList, UI } from '../ui/MenuList';
import { p1MoveHint, sampleControlHint } from '../ui/controlHint';
import { MoveListPanel } from '../ui/MoveListPanel';
import { TutorialCoach, tutorialDismissed } from '../ui/TutorialCoach';
import { cpuChallengeData, pauseEntries, type PauseAction } from '../ui/fightNavigation';
import { ANIME_CHARACTERS, ANIME_ERRORS, SPRITE_KEYS, SPRITE_SOURCES, type AnimeCharacterAsset, type AnimeCharacterAssets, type SpriteKeys } from '../assets';
import { AnimeSampleController, SAMPLE_DUMMY_LABELS, createSampleFighter, resetSampleRound, sampleCapabilities, sampleHoldPose, sampleMoveIssues, sampleResetReason, validateSampleCoverage } from '../anime/sampleMode';
import type { ResultData } from './ResultScene';
import { adoptPresentation, presentationLabel, type PresentationData } from '../presentation';
import { evaluateAnimeEntry } from '../anime/entryGate';
import { DiagnosticsPanel } from '../ui/DiagnosticsPanel';
import { fitFightFraming, unionFightBounds, type FightBounds, type FightFraming } from '../fightFraming';

export type GameMode = 'versus' | 'cpu' | 'training';

export interface FightSceneData extends PresentationData {
  p1: string;
  p2: string;
  mode: GameMode;
  /** 人机模式难度 */
  difficulty?: Difficulty;
  /** 强制显示新手引导 */
  tutorial?: boolean;
  controlModes?: ControlModes;
}

/** 地面在屏幕中的 y（像素）。 */
const GROUND_SCREEN_Y = SCREEN_H - ui(80);

interface SampleSelection {
  fighters: [FighterDef, FighterDef] | null;
  art: [AnimeCharacterAsset | null, AnimeCharacterAsset | null];
  issues: string[];
  abilityIssues: string[];
}

/** Invalid requested artwork is a blocking result; old artwork requires an explicit separate action. */
export function resolveAnimeSample(
  originals: readonly [FighterDef, FighterDef], assets: AnimeCharacterAssets,
  hasFrame: (key: string, name: string) => boolean,
  loadErrors: Readonly<Record<string, string>> = {},
): SampleSelection {
  const art: [AnimeCharacterAsset | null, AnimeCharacterAsset | null] = [assets[originals[0].id] ?? null, assets[originals[1].id] ?? null];
  const issues: string[] = [];
  for (const side of [0, 1] as const) {
    if (!art[side]) issues.push(`${originals[side].name}：${loadErrors[originals[side].id] ?? '尚无可加载的候选人物'}`);
    else if (art[side]!.runtime.characterId !== originals[side].id) issues.push(`${originals[side].name}：人物清单身份不匹配`);
    else {
      const asset = art[side]!;
      issues.push(...validateAnimeRuntimeManifest(asset.runtime, originals[side].moves).map(error => `${originals[side].name}：${error}`));
      for (const frame of Object.keys(asset.runtime.attachments)) if (!hasFrame(asset.frameTextures?.[frame] ?? asset.key, frame)) issues.push(`${originals[side].name}：图集中缺少 ${frame}`);
    }
  }
  if (issues.length) return { fighters: null, art: [null, null], issues, abilityIssues: [] };
  const inspect = (fighters: [FighterDef, FighterDef]): string[] => {
    const faults: string[] = [];
    for (const side of [0, 1] as const) {
      const def = fighters[side], asset = art[side]!;
      const coverage = validateSampleCoverage(def, asset.runtime, fighters[side === 0 ? 1 : 0], { infiniteHp: true });
      const absent = [...coverage.missingStates, ...coverage.missingMoves];
      if (absent.length) faults.push(`${def.name}：缺少 ${absent.join(' / ')}`);
      faults.push(...coverage.errors.map(error => `${def.name}：${error}`));
      for (const name of [...coverage.requiredStates, ...def.moves.map(move => move.id)]) {
        const anim = asset.runtime.anims[name];
        if (!anim) continue;
        for (let frame = 0; frame < anim.frames; frame++) {
          const frameId = frameName(def.id, name, frame);
          if (!hasFrame(asset.frameTextures?.[frameId] ?? asset.key, frameId)) {
            faults.push(`${def.name}：图集中缺少 ${name}/${frame}`);
            break;
          }
        }
      }
    }
    return faults;
  };
  const fighters: [FighterDef, FighterDef] = [
    createSampleFighter(originals[0], art[0]!.runtime, { opponentRuntime: art[1]!.runtime }),
    createSampleFighter(originals[1], art[1]!.runtime, { opponentRuntime: art[0]!.runtime }),
  ];
  issues.push(...inspect(fighters));
  if (issues.length) return { fighters: null, art: [null, null], issues, abilityIssues: [] };
  const abilityIssues = originals.flatMap((def, side) => def.moves.flatMap(move => {
    const runtime = art[side]!.runtime;
    if (!runtime.anims[move.id]) return [];
    const missing = sampleMoveIssues(move, runtime, art[side === 0 ? 1 : 0]!.runtime);
    return missing.length ? [`${def.name}·${move.name}：${missing.join('；')}`] : [];
  }));
  return { fighters, art, issues: [], abilityIssues };
}

export class FightScene extends Phaser.Scene {
  private ready = false;
  private diagnostics!: DiagnosticsPanel;
  private sim!: FightSim;
  private readonly audio = sfx();
  private readonly dailyAudio = new DailyAudio();
  private skillFx!: SkillEffects;
  private superDim!: Phaser.GameObjects.Rectangle;
  private superDimFrames = 0;
  private step = new FixedStep();
  private gfx!: Phaser.GameObjects.Graphics;
  private worldLayer!: Phaser.GameObjects.Container;
  private worldFraming: FightFraming | undefined;
  private framingFrame = 0;
  private effectsCameraX = 0;
  private stage!: Marineford;
  private debug!: DebugOverlay;
  private hud!: Hud;
  private skillBar!: SkillBar;
  private subtitles!: VoiceSubtitles;
  private views: [FighterView | null, FighterView | null] = [null, null];
  private viewAnims: [AnimTable, AnimTable] = [{}, {}];
  private presentations: [CharacterPresentation | null, CharacterPresentation | null] = [null, null];
  private sample: AnimeSampleController | null = null;
  private sampleResetWorld: WorldState | null = null;
  private useSprites = true;
  private mode: GameMode = 'versus';
  private data_!: FightSceneData;
  private dummy = new Dummy();
  private cpu: Cpu | null = null;
  private trainingText!: Phaser.GameObjects.Text;
  private controlText!: Phaser.GameObjects.Text;
  private lastInput = { p1: 0, p2: 0 };
  private shake = 0;
  private wasRoundOver = false;
  private popups: { text: Phaser.GameObjects.Text; ttl: number }[] = [];
  private paused = false;
  private settingsOverlay = false;
  private pauseUi: { bg: Phaser.GameObjects.Rectangle; title: Phaser.GameObjects.Text; menu: MenuList } | null = null;
  private pauseActions: PauseAction[] = [];
  private moveList: MoveListPanel | null = null;
  private tutorial: TutorialCoach | null = null;
  private trainScale = 1;
  private trainFreeze = false;
  private trainStep = false;
  private trainTick = 0;
  private pendingTraining = { p1: 0, p2: 0 };
  private previousTraining = { p1: 0, p2: 0 };
  private padsWas = 0;
  private tutorialDroveDummy = false;
  private tutorialBlockWait = 0;
  private tutorialCompletePending = false;
  private fx!: Particles;
  private after!: Afterimages;
  private flash!: Phaser.GameObjects.Rectangle;
  private koDim!: Phaser.GameObjects.Rectangle;
  private muteText!: Phaser.GameObjects.Text;
  private flashAlpha = 0;
  /** KO 慢镜头计数：round_end 前 SLOWMO_FRAMES 帧每 3 个渲染步进只推进 1 逻辑帧 */
  private slowAcc = 0;
  private prevPhase: string = 'intro';
  private prevStates: [string, string] = ['idle', 'idle'];
  private prevAirborne: [boolean, boolean] = [false, false];
  private winVoiceRound = -1;
  private prevInstances: [number, number] = [-1, -1];
  private prevSegments: [string | null, string | null] = [null, null];
  private prevMoveIds: [string | null, string | null] = [null, null];
  private prevProj = new Map<number, ProjectileState>();
  /** 训练预览：URL `hold=st_c/1` 让 P1 定格在该招式帧（命中帧通常是 /1） */
  private holdPose: string | undefined;

  constructor() {
    super('Fight');
  }

  private static readonly SLOWMO_FRAMES = 40;

  create(data: FightSceneData): void {
    this.ready = false;
    let p1 = characters[data.p1];
    let p2 = characters[data.p2];
    if (!p1 || !p2) throw new Error(`Unknown character: ${data.p1} / ${data.p2}`);
    const profile = adoptPresentation(this.registry, data);
    const animeRequested = profile.art === 'anime';
    const sampleRequested = animeRequested && profile.scope === 'sample';
    this.data_ = { ...data, ...profile, ...(sampleRequested ? { tutorial: false } : {}) };
    this.mode = this.data_.mode ?? 'versus';
    this.sample = sampleRequested ? new AnimeSampleController() : null;
    this.sampleResetWorld = null;
    this.registry.set('sampleAbilityIssues', []);
    this.registry.set('sampleCapabilities', []);
    this.presentations = [null, null];
    this.viewAnims = [characterAnims[data.p1] ?? {}, characterAnims[data.p2] ?? {}];
    let candidateArt: SampleSelection['art'] = [null, null];
    if (animeRequested) {
      const assets = (this.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined) ?? {};
      const errors = (this.registry.get(ANIME_ERRORS) as Record<string, string> | undefined) ?? {};
      const gate = evaluateAnimeEntry(profile, [p1, p2], assets, errors, this.mode);
      const missingFrames: string[] = [];
      for (const def of [p1, p2]) {
        const asset = assets[def.id];
        if (!asset) continue;
        for (const name of Object.keys(asset.runtime.attachments)) {
          const key = asset.frameTextures?.[name] ?? asset.key;
          if (!this.textures.exists(key) || !this.textures.get(key).has(name)) missingFrames.push(`人物纹理已失效：${name}`);
        }
      }
      if (!gate.ok || missingFrames.length) {
        this.audio.stopAll();
        this.scene.start('Preload', { ...this.data_, failure: [...gate.issues, ...missingFrames] });
        return;
      }
      if (sampleRequested) {
      const selected = resolveAnimeSample([p1, p2], (this.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined) ?? {},
        (key, name) => this.textures.exists(key) && this.textures.get(key).has(name),
        (this.registry.get(ANIME_ERRORS) as Record<string, string> | undefined) ?? {});
      if (!selected.fighters) {
        this.audio.stopAll(); this.scene.start('Preload', { ...this.data_, failure: selected.issues }); return;
      }
      [p1, p2] = selected.fighters;
      candidateArt = selected.art;
      this.sample = new AnimeSampleController(1, [sampleCapabilities(selected.art[0]!.runtime), sampleCapabilities(selected.art[1]!.runtime)]);
      this.registry.set('sampleAbilityIssues', selected.abilityIssues);
      this.registry.set('sampleCapabilities', this.sample.capabilities);
      } else candidateArt = [assets[p1.id]!, assets[p2.id]!];
      for (const side of [0, 1] as const) {
        const art = candidateArt[side];
        if (art) { this.viewAnims[side] = art.runtime.anims; this.presentations[side] = { ...art.runtime, ...(art.frameTextures ? { frameTextures: art.frameTextures } : {}) }; }
      }
    }
    // A training photography URL may remain in the address bar after menus or a CPU challenge.
    // Never carry that static drawing override into a normal match or its rematch.
    const hold = this.mode === 'training' ? new URLSearchParams(window.location.search).get('hold') : null;
    if (sampleRequested) {
      const selected = sampleHoldPose(hold, candidateArt[0]!.runtime);
      if (selected.issue) { this.audio.stopAll(); this.scene.start('Preload', { ...this.data_, failure: [selected.issue] }); return; }
      this.holdPose = selected.pose ?? undefined;
    } else this.holdPose = hold ?? undefined;
    this.paused = false;
    this.settingsOverlay = false;
    this.pauseUi = null;
    this.pauseActions = [];
    this.trainScale = 1;
    this.trainFreeze = false;
    this.trainStep = false;
    this.trainTick = 0;
    this.pendingTraining = { p1: 0, p2: 0 };
    this.previousTraining = { p1: 0, p2: 0 };
    this.lastInput = { p1: 0, p2: 0 };
    this.step = new FixedStep();
    this.useSprites = true;
    this.tutorial = null;
    this.tutorialDroveDummy = false;
    this.tutorialBlockWait = 0;
    this.tutorialCompletePending = false;
    this.padsWas = 0;
    this.popups = [];
    this.shake = 0;
    this.wasRoundOver = false;
    this.dummy = new Dummy();
    const cpuProfile = characterAi[data.p2];
    if (this.mode === 'cpu' && !cpuProfile) {
      this.scene.start('Preload', { ...this.data_, failure: [`角色 ${data.p2} 缺少CPU策略配置`] });
      return;
    }
    this.cpu =
      this.mode === 'cpu'
        ? new Cpu(1, cpuProfile!, data.difficulty ?? 'normal', (Date.now() & 0xffff) | 1)
        : null;

    const controls = matchControls(this.mode, this.data_.controlModes ?? getInputHub().controlModes, sampleRequested);
    this.data_.controlModes = controls;
    getInputHub().useMatchControls(controls);
    this.sim = new FightSim(
      this.mode === 'training' ? { p1, p2, seed: 1, introFrames: 0, roundTime: -1, controlModes: controls } : { p1, p2, seed: 1, controlModes: controls },
    );
    if (this.mode === 'training') this.sim.training = { infiniteHp: true, infiniteMeter: true };
    getInputHub().flush();
    this.stage = new Marineford(this, GROUND_SCREEN_Y, animeRequested ? 'anime' : 'classic');
    // A single transform keeps sprites, sockets, hitboxes and all combat effects together.
    // The complete scenic backdrop and HUD stay full viewport; the foot line is invariant.
    this.worldLayer = this.add.container(0, 0).setDepth(0);
    this.worldFraming = undefined;
    this.framingFrame = this.sim.state.frame;
    this.effectsCameraX = this.sim.state.cameraX;
    this.gfx = this.add.graphics();
    this.worldLayer.add(this.gfx);
    this.fx = new Particles(this, 512, this.worldLayer);
    this.skillFx = new SkillEffects(this, this.worldLayer);
    this.audio.clearFightSounds();
    this.dailyAudio.reset();
    this.audio.resume();
    this.audio.playMusic('battle', this.mode === 'training' ? 0.7 : 1);
    this.audio.playCue('marineford_ambient');
    this.superDimFrames = 0;
    this.superDim = this.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x06080f).setOrigin(0).setDepth(-2).setAlpha(0);
    this.after = new Afterimages(this, this.worldLayer);
    const grade = this.add.graphics().setDepth(-5).setScrollFactor(0);
    if (!animeRequested) grade.fillStyle(0xe85d04, 0.06).fillRect(0, 0, SCREEN_W, SCREEN_H);
    grade.fillStyle(0x07080c, 0.2).fillRect(0, 0, SCREEN_W, ui(36));
    grade.fillStyle(0x07080c, 0.24).fillRect(0, SCREEN_H - ui(48), SCREEN_W, ui(48));
    this.koDim = this.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x000000, 1).setOrigin(0).setDepth(40).setAlpha(0);
    this.flash = this.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0xffffff, 1).setOrigin(0).setDepth(90).setAlpha(0);
    this.muteText = this.add
      .text(SCREEN_W - ui(16), ui(76), '', { fontFamily: UI.mono, fontSize: font(12), color: '#e8c36a' })
      .setOrigin(1, 0)
      .setDepth(52);
    this.flashAlpha = 0;
    this.slowAcc = 0;
    this.prevPhase = this.sim.state.phase;
    this.prevProj.clear();
    this.prevStates = ['idle', 'idle'];
    this.prevAirborne = [false, false];
    this.winVoiceRound = -1;
    this.prevInstances = [-1, -1];
    this.prevSegments = [null, null];
    this.prevMoveIds = [null, null];
    this.hud = new Hud(this, [p1.name, p2.name], [[], []], animeRequested ? 'anime' : 'classic', [p1.id, p2.id], controls);
    this.subtitles = new VoiceSubtitles(this, 90);
    if (this.mode !== 'training') this.audio.playPresentation({ phase: 'round', key: `round-${this.sim.state.round}`, round: this.sim.state.round, finalRound: this.sim.state.wins.every(win => win === 1) });
    this.skillBar = new SkillBar(this, controls);
    this.debug = new DebugOverlay(this, false, this.worldLayer);

    // 精灵视图：Preload 决定了每个角色可用的图集 key
    const keys = (this.registry.get(SPRITE_KEYS) as SpriteKeys | undefined) ?? {};
    const mk = (id: string, side: 0 | 1) => {
      const key = candidateArt[side]?.key ?? keys[id];
      return key ? new FighterView(this, key, id, this.viewAnims[side], this.presentations[side] ?? undefined, this.worldLayer) : null;
    };
    this.views = [mk(data.p1, 0), mk(data.p2, 1)];

    this.diagnostics = new DiagnosticsPanel(this);
    const version = this.add.text(ui(12), ui(77), presentationLabel(profile), {
      fontFamily: UI.mono, fontSize: font(10), color: '#afc4cd',
    }).setDepth(52).setInteractive({ useHandCursor: true });
    version.on('pointerdown', () => { if (!this.paused) this.togglePause(); this.diagnostics.open(); });

    this.controlText = this.add
      .text(
        SCREEN_W / 2,
        SCREEN_H - ui(22),
        sampleRequested ? this.sampleHint() : this.mode === 'training'
          ? `${p1MoveHint()}  |  Esc 暂停看出招表  F9慢放 F10逐帧 F11出招表 F12跳过引导`
          : `${p1MoveHint()}   Esc 暂停 / 出招表`,
        { fontFamily: UI.mono, fontSize: font(11), color: sampleRequested ? '#c7d9de' : '#6c7a89', align: 'center', wordWrap: { width: SCREEN_W - ui(32) } },
      )
      .setOrigin(0.5, 0)
      .setDepth(52);
    if (controls.includes('simple')) this.controlText.setVisible(false);
    this.trainingText = this.add
      .text(SCREEN_W / 2, ui(101), '', { fontFamily: UI.mono, fontSize: font(12), color: sampleRequested ? '#c7d9de' : '#ffd60a' })
      .setOrigin(0.5, 0)
      .setDepth(52)
      .setVisible(this.mode === 'training');

    this.moveList = new MoveListPanel(this, [p1, p2], controls);
    if (!sampleRequested && this.mode === 'training' && (data.tutorial || !tutorialDismissed(controls[0]))) {
      this.tutorial = new TutorialCoach(this, data.p1, () => { this.tutorialCompletePending = true; }, controls[0]);
    }
    this.game.events.on('opf-settings-closed', this.onSettingsClosed, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.pauseOnFocusLoss, this);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.pauseOnFocusLoss, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('opf-settings-closed', this.onSettingsClosed, this);
      this.game.events.off(Phaser.Core.Events.BLUR, this.pauseOnFocusLoss, this);
      this.game.events.off(Phaser.Core.Events.HIDDEN, this.pauseOnFocusLoss, this);
      getInputHub().useMatchControls(null);
      this.moveList?.hide();
      this.audio.clearFightSounds();
      this.skillFx.clear();
    });

    const kb = this.input.keyboard;
    kb?.on('keydown-F4', () => (this.useSprites = !this.useSprites));
    kb?.on('keydown-ESC', () => {
      if (this.settingsOverlay) return;
      if (this.moveList?.visible) {
        this.closeMoveList();
        return;
      }
      this.togglePause();
    });
    kb?.on('keydown-F11', () => this.toggleMoveList());
    kb?.on('keydown-F12', () => this.tutorial?.skip());
    if (this.mode === 'training') {
      kb?.on('keydown-F5', () => this.sample ? this.sample.next(this.sim) : this.dummy.next());
      kb?.on('keydown-F6', () => this.resetTraining());
      kb?.on('keydown-F7', () => (this.sim.training.infiniteMeter = !this.sim.training.infiniteMeter));
      kb?.on('keydown-F8', () => (this.sim.training.infiniteHp = this.sample ? true : !this.sim.training.infiniteHp));
      kb?.on('keydown-F9', () => {
        if (this.settingsOverlay || this.paused || this.moveList?.visible) return;
        if (this.trainFreeze) {
          this.trainFreeze = false;
          this.trainStep = false;
          this.trainScale = 1;
        } else this.trainScale = this.trainScale === 1 ? 2 : this.trainScale === 2 ? 4 : 1;
        this.syncAudioPause();
      });
      kb?.on('keydown-F10', () => {
        if (this.settingsOverlay || this.paused || this.moveList?.visible) return;
        if (this.trainFreeze) this.trainStep = true;
        else this.trainFreeze = true;
        this.syncAudioPause();
      });
    }
    this.ready = true;
  }

  /** 防御步先留出后退窗口，再让木桩走近出拳。 */
  private syncTutorialDummy(): void {
    if (this.tutorial?.active && this.tutorial.stepId === 'block') {
      this.tutorialBlockWait++;
      if (this.tutorialBlockWait > 45 && this.dummy.mode !== 'attack') {
        this.dummy.mode = 'attack';
        this.tutorialDroveDummy = true;
      }
      return;
    }
    this.tutorialBlockWait = 0;
    if (this.tutorialDroveDummy) {
      this.dummy.mode = 'stand';
      this.tutorialDroveDummy = false;
    }
  }

  // ---------- 暂停 ----------

  private pauseOnFocusLoss(): void {
    if (this.paused) return;
    this.togglePause();
    this.setPauseUiVisible(this.paused && !this.moveList?.visible);
  }

  private discardPendingInput(): void {
    this.sim.clearInputs();
    this.pendingTraining = { p1: 0, p2: 0 };
    this.previousTraining = { p1: 0, p2: 0 };
    this.lastInput = { p1: 0, p2: 0 };
    getInputHub().flush();
  }

  private togglePause(tutorialComplete = false): void {
    const phase = this.sim.state.phase;
    if (!this.paused && phase !== 'fight' && phase !== 'intro') return;
    this.paused = !this.paused;
    this.syncAudioPause();
    if (this.paused) {
      this.discardPendingInput();
      const bg = this.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.6).setOrigin(0).setDepth(200);
      const title = this.add
        .text(SCREEN_W / 2, ui(140), tutorialComplete ? '基础练习完成' : 'PAUSE', { fontFamily: UI.font, fontSize: font(40), color: UI.title, fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(201)
        .setStroke('#2a1c12', ui(6));
      const items = pauseEntries(this.data_, tutorialComplete);
      this.pauseActions = items.map((item) => item.action);
      const menu = new MenuList(this, SCREEN_W / 2 - ui(140), ui(200), items, 36, '20px', 202);
      this.pauseUi = { bg, title, menu };
    } else {
      this.pauseUi?.bg.destroy();
      this.pauseUi?.title.destroy();
      this.pauseUi?.menu.destroy();
      this.pauseUi = null;
      this.pauseActions = [];
    }
    getInputHub().flush();
  }

  private syncAudioPause(): void {
    if (this.paused || this.moveList?.visible || this.trainFreeze || this.settingsOverlay) { this.audio.pause(); this.dailyAudio.interrupt(); this.subtitles.clear(); }
    else this.audio.resume();
  }

  private updatePaused(): void {
    const menu = this.pauseUi?.menu;
    if (!menu) return;
    const action = menu.update(getInputHub().edges());
    if (action === 'back') {
      this.togglePause();
      return;
    }
    if (action !== 'select') return;
    switch (this.pauseActions[menu.index]) {
      case 'resume':
        this.togglePause();
        break;
      case 'settings':
        this.openSettingsOverlay();
        break;
      case 'moves':
        this.toggleMoveList();
        break;
      case 'cpu':
        this.togglePause();
        this.scene.start('Preload', cpuChallengeData({ ...this.data_, controlModes: getInputHub().controlModes }));
        break;
      case 'characters':
        this.togglePause();
        this.scene.start('CharacterSelect', { ...this.data_, mode: this.mode, difficulty: this.data_.difficulty });
        break;
      default:
        this.togglePause();
        this.scene.start('Title', this.data_);
    }
  }

  private setPauseUiVisible(v: boolean): void {
    if (!this.pauseUi) return;
    this.pauseUi.bg.setVisible(v);
    this.pauseUi.title.setVisible(v);
    this.pauseUi.menu.setVisible(v);
  }

  private openSettingsOverlay(): void {
    if (this.settingsOverlay || this.scene.isActive('Settings')) return;
    this.settingsOverlay = true;
    this.setPauseUiVisible(false);
    getInputHub().flush();
    this.scene.launch('Settings', { resumeScene: 'Fight', backData: this.data_ });
    this.scene.bringToTop('Settings');
  }

  private onSettingsClosed(): void {
    this.settingsOverlay = false;
    getInputHub().flush();
    this.setPauseUiVisible(true);
    this.refreshControlHint();
  }

  /** Candidate practice also restores HP/burn; the regular training reset retains its existing rules. */
  private resetTraining(): void {
    if (this.sample) this.sampleResetWorld = resetSampleRound(this.sim, this.sample);
    else this.sim.resetPositions();
    this.pendingTraining = { p1: 0, p2: 0 };
    this.previousTraining = { p1: 0, p2: 0 };
    this.lastInput = { p1: 0, p2: 0 };
    getInputHub().flush();
    this.fx.clear(); this.skillFx.clear(); this.after.clear(); this.prevProj.clear();
    this.effectsCameraX = this.sim.state.cameraX;
    this.prevInstances = [-1, -1]; this.prevSegments = [null, null]; this.prevMoveIds = [null, null];
    this.prevStates = ['idle', 'idle']; this.prevAirborne = [false, false];
    this.prevPhase = this.sim.state.phase;
    this.superDimFrames = 0; this.flashAlpha = 0; this.shake = 0; this.slowAcc = 0;
    this.superDim.setAlpha(0); this.flash.setAlpha(0); this.koDim.setAlpha(0);
    this.wasRoundOver = false;
    this.winVoiceRound = -1;
    for (const popup of this.popups) popup.text.destroy();
    this.popups = [];
    this.hud.reset();
    this.dailyAudio.reset();
    this.audio.clearFightSounds(); this.audio.playCue('marineford_ambient');
    this.syncAudioPause();
    // F6 also works under pause/menus, where update() returns before its usual drawing pass.
    if (this.sampleResetWorld) this.drawWorld(this.sampleResetWorld);
  }

  private drawWorld(w: WorldState): void {
    this.subtitles.setY(this.tutorial?.active ? 193 : 90);
    this.skillBar.draw(this.sim, getInputHub().keyConfig);
    this.draw(w);
    this.after.draw();
    this.fx.draw();
    const sources = (this.registry.get(SPRITE_SOURCES) as Record<string, string | null> | undefined) ?? {};
    this.hud.draw(w, {
      armor: [this.sim.hasArmor(w.fighters[0]!), this.sim.hasArmor(w.fighters[1]!)],
      source: this.mode === 'training' ? `${this.data_.p1}:${this.presentations[0] ? '新人物样板' : sources[this.data_.p1] ?? 'block'}  ${this.data_.p2}:${this.presentations[1] ? '新人物样板' : sources[this.data_.p2] ?? 'block'}` : '',
    });
  }

  private refreshControlHint(): void {
    const text = this.sample ? this.sampleHint() : this.mode === 'training'
      ? `${p1MoveHint()}  |  Esc 暂停看出招表  F9慢放 F10逐帧 F11出招表 F12跳过引导`
      : `${p1MoveHint()}   Esc 暂停 / 出招表`;
    if (this.controlText.text !== text) this.controlText.setText(text);
  }

  private sampleHint(): string {
    return this.holdPose ? `静帧检查 ${this.holdPose} · 仅检查原画/根点，正常动作验收请去掉网址的 hold 参数`
      : sampleControlHint(this.sim.state.fighters, undefined, this.sample?.capabilities).split('\n')[0]!;
  }

  private toggleMoveList(): void {
    if (this.settingsOverlay || !this.moveList) return;
    if (!this.moveList.visible) this.discardPendingInput();
    const w = this.sim.state;
    this.moveList.toggle(getInputHub().keyConfig, [w.fighters[0]!.facing === 1, w.fighters[1]!.facing === 1]);
    this.setPauseUiVisible(this.paused && !this.moveList.visible);
    this.syncAudioPause();
    getInputHub().flush();
  }

  private closeMoveList(): void {
    this.moveList?.hide();
    this.syncAudioPause();
    this.setPauseUiVisible(this.paused);
    getInputHub().flush();
  }

  private checkGamepadDisconnect(): void {
    const n =
      typeof navigator !== 'undefined' && navigator.getGamepads
        ? Array.from(navigator.getGamepads()).filter((p) => p?.connected).length
        : 0;
    if (this.padsWas > 0 && n < this.padsWas && !this.paused) {
      this.togglePause();
      this.pauseUi?.title.setText('手柄已断开');
    }
    this.padsWas = n;
  }

  override update(_time: number, deltaMs: number): void {
    if (!this.ready || this.diagnostics?.visible) return;
    const steps = this.step.advance(deltaMs);
    if (this.settingsOverlay) return;
    if (this.moveList?.visible) {
      for (let i = 0; i < steps; i++) {
        const ev = getInputHub().edges();
        if (this.moveList.update(ev)) {
          this.closeMoveList();
          break;
        }
      }
      return;
    }
    if (this.paused) {
      for (let i = 0; i < steps; i++) this.updatePaused();
      return;
    }
    this.checkGamepadDisconnect();
    if (this.paused) return;
    const hub = getInputHub();
    for (let i = 0; i < steps; i++) {
      const raw = hub.snapshot();
      const pressedStart = (raw.p1 | raw.p2) & Btn.Start & ~(this.lastInput.p1 | this.lastInput.p2);
      const phase = this.sim.state.phase;
      if (pressedStart && (phase === 'fight' || phase === 'intro')) {
        this.lastInput = raw;
        this.togglePause();
        return;
      }
      if (phase === 'match_end' && pressedStart) {
        const w = this.sim.state;
        const winner: 0 | 1 = w.wins[0] > w.wins[1] ? 0 : 1;
        const result: ResultData = { ...this.data_, winner, wins: w.wins };
        this.scene.start('Result', result);
        return;
      }
      // 比赛结束阶段不把 Start 传给 sim（由 Result 场景接管重开）
      this.lastInput = phase === 'match_end' ? { p1: raw.p1 & ~Btn.Start, p2: raw.p2 & ~Btn.Start } : raw;
      if (this.mode === 'training') {
        this.pendingTraining = captureTrainingInput(this.pendingTraining, this.previousTraining, this.lastInput);
        this.previousTraining = this.lastInput;
        const forcedStep = this.trainStep;
        if (this.trainFreeze && !forcedStep) continue;
        this.trainStep = false;
        this.trainTick++;
        if (!forcedStep && this.trainScale > 1 && this.trainTick % this.trainScale !== 0) continue;
        this.lastInput = this.pendingTraining;
        this.pendingTraining = { p1: 0, p2: 0 };
      }
      if (this.cpu) {
        this.lastInput = { p1: this.lastInput.p1, p2: this.cpu.input(this.sim) };
      } else if (this.mode === 'training' && !this.sample) {
        this.syncTutorialDummy();
        const d = this.dummy.input(this.sim, 1);
        if (d !== null) this.lastInput = { p1: this.lastInput.p1, p2: d };
      }

      // KO 慢镜头：回合刚结束的一小段，每 3 个渲染步进只推进 1 逻辑帧
      const slow = phase === 'round_end' && this.sim.state.phaseFrame < FightScene.SLOWMO_FRAMES;
      if (slow && ++this.slowAcc % 3 !== 0) continue;

      // The gate reads the same current history as core and runs once per real step,
      // after slow-motion/step buffering, never on skipped rendering ticks.
      if (this.sample) this.lastInput = this.sample.input(this.sim, this.lastInput);
      this.sim.step(this.lastInput);
      this.sampleResetWorld = null;
      // Check before any hit/KO audio, effects or drawing can consume an uncovered ending pose.
      // Ordinary recovery waits until both fighters have finished attacks and reactions.
      if (this.sample && sampleResetReason(this.sim)) {
        this.resetTraining();
        continue;
      }
      this.tutorial?.tick(this.sim, this.lastInput.p1);
      this.fx.tick();
      this.skillFx.tick();
      if (this.superDimFrames > 0) this.superDimFrames--;
      this.after.tick();
      this.afterStep();
      if (this.tutorialCompletePending) {
        this.tutorialCompletePending = false;
        this.togglePause(true);
        break;
      }
    }
    const w = this.sampleResetWorld ?? this.sim.state;
    const roundActive = w.phase === 'fight' || w.phase === 'intro';
    if (!this.wasRoundOver && !roundActive) this.wasRoundOver = true;
    if (this.wasRoundOver && roundActive) {
      this.hud.reset();
      this.wasRoundOver = false;
    }
    this.superDim.setAlpha(Math.min(0.30, this.superDimFrames / 40));
    this.drawWorld(w);
    const koSlow = w.phase === 'round_end' && w.phaseFrame < FightScene.SLOWMO_FRAMES && w.timer !== 0;
    this.koDim.setAlpha(koSlow ? 0.32 : 0);
    const unavailableGroup = (['music', 'voice'] as const).find(group => ['download_failed', 'decode_failed', 'start_failed', 'unavailable'].includes(this.audio.hudState(group)));
    const audioHud = this.audio.hudState(unavailableGroup);
    this.muteText.setText(`${unavailableGroup === 'music' ? '音乐：' : unavailableGroup === 'voice' ? '人物：' : ''}${sfxHudText(audioHud)}`);
    const audioColor = audioHud === 'muted' ? '#d98a7a' : '#e8c36a';
    // Phaser setColor redraws and uploads the text texture even if unchanged.
    if (this.muteText.style.color !== audioColor) this.muteText.setColor(audioColor);
    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - 0.06);
      this.flash.setAlpha(this.flashAlpha);
    }
    if (this.mode === 'training') {
      if (this.sample) this.refreshControlHint();
      const t = this.sim.training;
      this.trainingText.setY(ui(this.tutorial?.active ? 170 : 96));
      this.trainingText.setText(
        `${this.sample ? '样板' : '训练'}  F5木桩:${this.sample ? SAMPLE_DUMMY_LABELS[this.sample.mode] : this.dummy.mode}  F6重置  F7气:${t.infiniteMeter ? '无限' : '普通'}  F8血:${this.sample ? '自动恢复' : t.infiniteHp ? '无限' : '普通'}  ${this.trainFreeze ? 'F9恢复实时  F10下一帧' : `F9慢放:${this.trainScale === 1 ? '1x' : `1/${this.trainScale}`}  F10逐帧`}  F11出招表`,
      );
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.4);
    this.tickPopups(steps);
  }

  /** 每个逻辑步进之后：事件 → 特效 / 音效 / 提示；状态跃迁 → 尘土 / 慢镜头 / 闪白 */
  private afterStep(): void {
    const w = this.sim.state;
    const cam = w.cameraX;
    this.reprojectTransientEffects(cam);
    const sx = (x: number) => this.worldToScreenX(x, cam);
    const sy = (y: number) => this.worldToScreenY(y);

    for (const h of this.sim.hits) {
      const attacker = w.fighters[h.attacker]!;
      const defender = w.fighters[h.defender]!;
      const dir: 1 | -1 = attacker.facing;
      this.skillFx.contact(h, w);
      const audioEvent = { characterId: attacker.def.id, materialCharacterId: h.projectile ? projectileMoveMaterial(h.moveId) ?? attacker.def.id : attacker.def.id, player: attacker.player, moveId: h.moveId, moveInstance: attacker.moveInstance, damage: h.damage, counter: h.counter, defenderId: defender.def.id, defenderPlayer: defender.player };
      switch (h.kind) {
        case 'hit':
          this.shake = Math.max(this.shake, Math.min(4, 1 + h.damage / 30));
          this.fx.hitSpark(sx(h.x), sy(h.y), h.damage, h.counter ? 0xff3860 : h.projectile ? 0xff6b35 : 0xffd60a, dir);
          this.audio.playEvent({ ...audioEvent, phase: 'hit' });
          if (h.counter) this.popup('COUNTER!', h.x, h.y, '#ff3860');
          break;
        case 'block':
          this.shake = Math.max(this.shake, 1);
          this.fx.blockSpark(sx(h.x), sy(h.y), dir);
          this.audio.playEvent({ ...audioEvent, phase: 'block' });
          this.popup('BLOCK', h.x, h.y, '#48cae4');
          break;
        case 'armor':
          this.fx.hitSpark(sx(h.x), sy(h.y), h.damage, 0xffe066, dir);
          this.audio.playEvent({ ...audioEvent, phase: 'hit' });
          this.popup('ARMOR', h.x, h.y, '#ffd60a');
          break;
        case 'throw':
          this.audio.playEvent({ ...audioEvent, phase: 'throw' });
          this.popup('THROW', h.x, h.y, '#ff9f1c');
          break;
        case 'tech':
          this.audio.playEvent({ ...audioEvent, phase: 'block' });
          this.popup('TECH!', h.x, h.y, '#ffd60a');
          break;
        case 'reflect':
          this.fx.blockSpark(sx(h.x), sy(h.y), dir);
          this.audio.playEvent({ ...audioEvent, phase: 'reflect' });
          this.popup('REFLECT!', h.x, h.y, '#48cae4');
          break;
        case 'clash':
          this.fx.hitSpark(sx(h.x), sy(h.y), 40, 0xe0fbfc, 1);
          sfx().play('hit_heavy');
          this.popup('CLASH', h.x, h.y, '#e0fbfc');
          break;
        default:
          break;
      }
    }
    this.tickProjectiles(w, sx, sy);
    this.hud.onEvents(this.sim.hits, 1);

    const dailyFighters = w.fighters.map(f => {
      const table = this.viewAnims[f.player];
      const pose = currentAnimation(this.sim, f, table);
      if (f.state !== 'idle' && !['walk_fwd', 'walk_back', 'dash', 'backdash'].includes(f.state) && !f.state.startsWith('jump_')) this.audio.interruptDailyVoice(f.player);
      return { player: f.player, characterId: f.def.id, state: f.state, x: f.x, airborne: f.airborne,
        animationFrame: pose.index, animationFrames: table[pose.anim]?.frames ?? 1, hitstop: f.hitstop };
    });
    for (const cue of this.dailyAudio.step(dailyFighters, w.phase === 'fight', this.sim.hits.length > 0, this.audio.voiceBusy())) {
      const played = this.audio.playCue(cue.id, cue.player === undefined ? {} : { player: cue.player });
      if (played && cue.id.startsWith('voice.') && cue.player !== undefined) this.dailyAudio.notePlayed(cue.player);
    }

    for (const f of w.fighters) {
      const i = f.player;
      // 落地 / 倒地 / 冲刺尘土
      const prev = this.prevStates[i];
      if ((f.state === 'landing' || f.state === 'knockdown' || f.state === 'ko') && !f.airborne && (prev !== f.state || this.prevAirborne[i])) {
        this.fx.dust(sx(f.x), sy(f.y), f.state === 'landing' ? 6 : 12);
        if (!f.airborne) this.audio.playEvent({ phase: 'landing', characterId: f.def.id, player: f.player });
      }
      if ((f.state === 'dash' || f.state === 'backdash') && prev !== f.state) {
        this.fx.dust(sx(f.x), sy(f.y), 5);
      }
      // 击飞残影
      if ((f.state === 'hit_air' || f.state === 'ko') && f.airborne && w.frame % 2 === 0) {
        this.spawnAfterimage(f, cam);
      }
      const mv = f.state === 'attack' || f.state === 'throw' ? f.moveId : null;
      const move = this.sim.move(f);
      if (mv && f.moveInstance !== this.prevInstances[i]) {
        // Connected command throws reset core's instance counter, but are still the same spoken move.
        if (!(f.state === 'throw' && prev === 'attack' && this.prevMoveIds[i] === mv)) {
          this.audio.playEvent({ phase: 'start', characterId: f.def.id, player: i, moveId: mv, moveInstance: f.moveInstance });
        }
        if (move && !move.throwData && !move.projectiles?.length && !move.frames.some(frame => frame.hitboxes?.length)) {
          // Install/dodge utility effects take effect at startMove, without a fabricated active hitbox.
          this.audio.playEvent({ phase: 'swing', characterId: f.def.id, player: i, moveId: mv, moveInstance: f.moveInstance, segmentId: 'utility' });
        }
        this.prevInstances[i] = f.moveInstance;
        if (move?.type === 'super' || move?.type === 'ultimate') this.superDimFrames = 14;
      }
      const segment = activeSegment(f, move);
      if (segment && segment !== this.prevSegments[i]) {
        this.audio.playEvent({ phase: 'swing', characterId: f.def.id, player: i, moveId: mv ?? '', moveInstance: f.moveInstance, segmentId: segment });
      }
      this.prevSegments[i] = segment;
      const recoveryStart = move && f.state === 'attack' ? totalFrames(move) - move.frames.at(-1)!.duration
        : f.state === 'throw' && move?.throwData ? move.throwData.releaseFrame : null;
      if (move && recoveryStart !== null && f.stateFrame >= recoveryStart) {
        this.audio.playEvent({ phase: 'recover', characterId: f.def.id, player: i, moveId: move.id, moveInstance: f.moveInstance });
      }
      if ((mv === 'sp_meteor' || mv === 'sp_meteor_rain') && w.frame % 3 === 0) {
        this.fx.castAura(sx(f.x), sy(f.y) - 48 * RENDER_SCALE);
      }
      this.prevStates[i] = f.state;
      this.prevMoveIds[i] = mv;
      this.prevAirborne[i] = f.airborne;
      // 灼烧火星
      if (f.burnFrames > 0 && w.frame % 5 === 0) this.fx.ember(sx(f.x), sy(f.y) - 40 * RENDER_SCALE);
    }

    // 阶段跃迁
    if (w.phase !== this.prevPhase) {
      if (w.phase === 'intro') {
        this.fx.clear(); this.after.clear(); this.skillFx.clear(); this.prevProj.clear();
        this.prevInstances = [-1, -1]; this.prevSegments = [null, null];
        this.prevMoveIds = [null, null];
        // A new round clears idle buildup, but does not bypass the 20-second voice interval.
        this.dailyAudio.interrupt();
        this.audio.clearFightSounds(); this.audio.playCue('marineford_ambient');
        this.audio.playPresentation({ phase: 'round', key: `round-${w.round}`, round: w.round, finalRound: w.wins.every(win => win === 1) });
      }
      if (w.phase === 'fight') this.audio.playPresentation({ phase: 'fight', key: `fight-${w.round}`, round: w.round });
      if (w.phase === 'round_end') {
        this.dailyAudio.interrupt();
        this.audio.clearFightSounds();
        this.audio.playCue('marineford_ambient');
        const loser = w.roundWinner === null ? null : w.fighters[w.roundWinner === 0 ? 1 : 0]!;
        if (loser && w.timer !== 0) {
          this.fx.koBurst(sx(loser.x), sy(loser.y) - 40 * RENDER_SCALE);
          this.flashAlpha = 0.85;
          this.shake = 6;
          this.audio.playEvent({ phase: 'ko', characterId: loser.def.id, player: loser.player });
          this.audio.playPresentation({ phase: 'ko', key: `ko-${w.round}`, round: w.round });
        }
        this.slowAcc = 0;
      }
      this.prevPhase = w.phase;
    }
    if ((w.phase === 'round_end' || w.phase === 'match_end') && w.phaseFrame >= 40 && w.roundWinner !== null && this.winVoiceRound !== w.round) {
      this.winVoiceRound = w.round;
      const winner = w.fighters[w.roundWinner]!;
      this.audio.playEvent({ phase: 'win', characterId: winner.def.id, player: winner.player });
    }
  }

  private popup(msg: string, wx: number, wy: number, color: string): void {
    const t = this.add
      .text(this.worldToScreenX(wx, this.sim.state.cameraX), this.worldToScreenY(wy) - 20 * RENDER_SCALE, msg, {
        fontFamily: UI.font,
        fontSize: font(16),
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(70);
    this.worldLayer.add(t);
    this.popups.push({ text: t, ttl: 40 });
  }

  private spawnAfterimage(f: FighterState, cameraX: number): void {
    const view = this.views[f.player];
    if (this.useSprites && view) {
      const table = this.viewAnims[f.player];
      const { anim, index } = currentAnimation(this.sim, f, table);
      const name = frameName(f.def.id, anim, index);
      let x = this.worldToScreenX(f.x, cameraX), y = this.worldToScreenY(f.y);
      const presentation = this.presentations[f.player];
      const geometry = presentation?.attachments[name];
      const key = presentation?.frameTextures?.[name] ?? view.key;
      const scale = UI_SCALE / (presentation?.textureDensity ?? 1);
      if (geometry && this.textures.exists(key) && this.textures.get(key).has(name)) {
        // Afterimages use atlas pivots; compensate when the candidate's explicit root lies elsewhere.
        const frame = this.textures.get(key).get(name);
        x += f.facing * ((frame.customPivot ? frame.pivotX : 0.5) * geometry.size.width - geometry.root.x) * scale;
        y += ((frame.customPivot ? frame.pivotY : 1) * geometry.size.height - geometry.root.y) * scale;
      }
      this.after.spawnSprite(key, name, x, y, f.facing === -1, f.def.color, scale);
      return;
    }
    const box = this.sim.pushbox(f);
    this.after.spawnBox(
      this.worldToScreenX(box.x, cameraX),
      this.worldToScreenY(box.y),
      (box.w / SUBPIXEL) * RENDER_SCALE,
      (box.h / SUBPIXEL) * RENDER_SCALE,
      f.def.color,
    );
  }

  private tickPopups(steps: number): void {
    for (const p of this.popups) {
      p.ttl -= steps;
      p.text.y -= 0.4 * steps * RENDER_SCALE;
      p.text.setAlpha(Math.min(1, p.ttl / 15));
    }
    this.popups = this.popups.filter((p) => {
      if (p.ttl <= 0) p.text.destroy();
      return p.ttl > 0;
    });
  }

  private worldToScreenX(x: number, cameraX: number): number {
    return SCREEN_W / 2 + (x - cameraX) / SUBPIXEL * RENDER_SCALE;
  }

  private reprojectTransientEffects(cameraX: number): void {
    const dx = (this.effectsCameraX - cameraX) / SUBPIXEL * RENDER_SCALE;
    this.effectsCameraX = cameraX;
    if (dx === 0) return;
    this.fx.shiftCamera(dx);
    this.after.shiftCamera(dx);
    for (const popup of this.popups) popup.text.x += dx;
  }

  private worldToScreenY(y: number): number {
    return GROUND_SCREEN_Y + ((y - GROUND_Y) / SUBPIXEL) * RENDER_SCALE;
  }

  private shakeOffset(): number {
    if (this.shake <= 0) return 0;
    return (this.sim.state.frame & 1 ? 1 : -1) * this.shake;
  }

  private draw(w: WorldState): void {
    const g = this.gfx;
    g.clear();
    this.stage.draw(w.cameraX + this.shakeOffset() * SUBPIXEL, w.frame);

    const rank = (f: FighterState) => (f.state === 'attack' || f.state === 'throw' ? 1 : 0);
    const ordered = [...w.fighters].sort((a, b) => rank(a) - rank(b) || a.player - b.player);
    for (const f of ordered) {
      const view = this.views[f.player];
      if (this.useSprites && view && this.drawSprite(view, f, w.cameraX)) continue;
      view?.hide();
      if (this.useSprites && this.presentations[f.player]?.style === 'anime') {
        this.ready = false; this.audio.stopAll();
        this.scene.start('Preload', { ...this.data_, failure: [`人物动作纹理在运行中丢失：${view?.missingFrames.at(-1) ?? f.state}`] });
        return;
      }
      this.drawFighter(f, w.cameraX);
    }
    this.skillFx.begin();
    const sx = (x: number) => this.worldToScreenX(x, w.cameraX);
    const sy = (y: number) => this.worldToScreenY(y);
    this.skillFx.fighters(this.sim, sx, sy, player => this.useSprites && this.presentations[player]?.style === 'anime');
    for (const p of w.projectiles) if (!this.skillFx.projectile(p, this.sim, sx, sy)) this.drawProjectile(p, w.cameraX);
    this.skillFx.finish(sx, sy);

    this.debug.draw(
      w,
      this.sim,
      this.lastInput,
      (x) => this.worldToScreenX(x, w.cameraX),
      (y) => this.worldToScreenY(y),
    );
    const bounds = w.phase === 'intro' ? null : unionFightBounds(this.views.map(view => view?.cameraBounds() ?? null).filter((box): box is FightBounds => box !== null));
    this.worldFraming = fitFightFraming(bounds, {
      width: SCREEN_W, groundY: GROUND_SCREEN_Y, top: ui(76), sideMargin: ui(24),
    }, this.worldFraming, Math.max(0, w.frame - this.framingFrame));
    this.framingFrame = w.frame;
    this.worldLayer.setScale(this.worldFraming.zoom)
      .setPosition(this.worldFraming.offsetX + this.shakeOffset() * RENDER_SCALE * this.worldFraming.zoom, this.worldFraming.offsetY).sort('depth');
  }

  /** 精灵渲染：状态色调（受击白 / 防御蓝 / 二档粉 / 灼烧橙）与闪避半透明由 tint / alpha 表现。 */
  private drawSprite(view: FighterView, f: FighterState, cameraX: number): boolean {
    const hitState = f.state === 'hit_stand' || f.state === 'hit_crouch' || f.state === 'hit_air';
    const move = this.sim.move(f);
    let tint: number | null = null;
    if (f.justHit || (f.hitstop > 0 && hitState)) tint = 0xffffff;
    else if (f.state === 'block_stand' || f.state === 'block_crouch') tint = 0x9fd8ff;
    else if (f.install) tint = 0xffc8dd;
    else if (f.burnFrames > 0 && this.sim.state.frame % 8 < 4) tint = 0xff9f1c;
    else if (this.sim.hasArmor(f)) tint = 0xffe066;
    const dodging = !!move?.dodge && this.sim.isStrikeInvulnerable(f);
    const alpha = dodging ? 0.45 : this.sim.isStrikeInvulnerable(f) && (f.state === 'roll_fwd' || f.state === 'roll_back' || f.state === 'backdash') ? 0.7 : 1;
    const w = this.sim.state;
    // 演出：入场从两侧滑入；回合结束胜者摆胜利姿势
    let offsetX = 0;
    if (w.phase === 'intro') {
      const t = Math.min(1, w.phaseFrame / 30);
      offsetX = (1 - t) * (1 - t) * 160 * RENDER_SCALE * (f.player === 0 ? -1 : 1);
    }
    const isWinner = (w.phase === 'round_end' || w.phase === 'match_end') && w.roundWinner === f.player && w.phaseFrame > 30 && !f.airborne;
    const fd = this.sim.currentFrame(f);
    const anims = this.viewAnims[f.player];
    const anime = this.presentations[f.player]?.style === 'anime';
    let scale = anime || f.state === 'attack' || f.state === 'throw' ? 1 : animDrawScale(anims, f.state);
    // 连续精灵本身已经包含橡胶膨胀/巨拳，保持身体与脚底尺寸稳定。
    if (!anime && !anims.idle?.pixelArt) {
      if (move?.reflect && f.state === 'attack') scale = 1.16;
      else if (move?.id === 'sp_gigant_pistol' && fd?.hitboxes) scale = 1.18;
      else if (move?.id === 'sp_gear2' && f.state === 'attack') scale = 1.06;
    }
    return view.update(
      this.sim,
      f,
      this.worldToScreenX(f.x, cameraX) + offsetX,
      this.worldToScreenY(f.y),
      tint,
      alpha,
      f.player === 0 && this.holdPose ? this.holdPose : isWinner ? { anim: 'win', stateFrame: w.phaseFrame - 31 } : undefined,
      scale * UI_SCALE,
    );
  }

  /**
   * 占位角色：身体色块 + 头 + 眼睛；出招 active 帧把攻击框画成"伸出的肢体"；
   * 受击闪白；防御蓝边；翻滚画成球；倒地横躺。
   */
  private drawFighter(f: FighterState, cameraX: number): void {
    const g = this.gfx;
    const box = this.sim.pushbox(f);
    const S = RENDER_SCALE;
    const sx = this.worldToScreenX(box.x, cameraX);
    const sy = this.worldToScreenY(box.y);
    const sw = (box.w / SUBPIXEL) * S;
    const sh = (box.h / SUBPIXEL) * S;
    const groundY = this.worldToScreenY(f.y);

    const lying = f.state === 'knockdown' || f.state === 'ko';
    const hitState = f.state === 'hit_stand' || f.state === 'hit_crouch' || f.state === 'hit_air';
    const blocking = f.state === 'block_stand' || f.state === 'block_crouch';
    const flash = f.justHit || (f.hitstop > 0 && hitState);
    const invuln = this.sim.isStrikeInvulnerable(f);
    const move = this.sim.move(f);
    const frameNo = this.sim.state.frame;
    let bodyColor = f.def.color;
    if (flash) bodyColor = 0xffffff;
    else if (f.state === 'getup' || f.state === 'throw_tech') bodyColor = 0x9d9d9d;
    else if (blocking) bodyColor = Phaser.Display.Color.IntegerToColor(f.def.color).darken(25).color;
    else if (f.install) bodyColor = Phaser.Display.Color.IntegerToColor(f.def.color).lighten(18).color;
    else if (f.fatigueFrames > 0) bodyColor = Phaser.Display.Color.IntegerToColor(f.def.color).desaturate(40).color;

    // 灼烧：身上冒橙色火点
    if (f.burnFrames > 0 && !lying) {
      for (let i = 0; i < 3; i++) {
        const px_ = sx + ((frameNo * 7 + i * 13) % Math.max(1, sw));
        const py_ = sy + ((frameNo * 5 + i * 29) % Math.max(1, sh));
        g.fillStyle(i % 2 ? 0xff9f1c : 0xff3860, 0.9).fillRect(px_, py_, 3 * S, 3 * S);
      }
    }
    // 二档：身后蒸汽
    if (f.install && !lying) {
      for (let i = 0; i < 4; i++) {
        const t = (frameNo * 3 + i * 17) % 40;
        const px_ = sx + sw / 2 - f.facing * (6 + t * 0.4) * S + ((i * 7) % 5) * S - 2 * S;
        g.fillStyle(0xffc8dd, 0.35 + 0.3 * (1 - t / 40)).fillCircle(px_, sy + (10 + i * 12 - t * 0.3) * S, (3 - t / 20) * S);
      }
    }
    // 熔岩化闪避：半透明橙红
    if (move?.dodge && invuln) {
      g.fillStyle(0xff6b35, 0.45).fillRect(sx, sy, sw, sh);
      g.lineStyle(1, 0xffd60a, 0.8).strokeRect(sx, sy, sw, sh);
      return;
    }
    // 橡胶气球：大圆
    if (move?.reflect && f.state === 'attack') {
      const cx = this.worldToScreenX(f.x, cameraX);
      const r = sh * 0.6;
      g.fillStyle(f.def.color, 1).fillCircle(cx, groundY - r, r);
      g.lineStyle(1, 0xffffff, 0.7).strokeCircle(cx, groundY - r, r);
      const headW = sw * 0.6;
      g.fillStyle(0xffe8d6, 1).fillRect(cx - headW / 2, groundY - r * 2 - 8 * S, headW, 10 * S);
      return;
    }

    if (lying) {
      const lw = sh * 0.9;
      const lx = f.facing === 1 ? sx + sw - lw : sx;
      g.fillStyle(bodyColor, 1).fillRect(lx, groundY - 14 * S, lw, 14 * S);
      return;
    }

    // 翻滚：一个球，无敌期间描白边
    if (f.state === 'roll_fwd' || f.state === 'roll_back') {
      const r = sw * 0.55;
      const cx = this.worldToScreenX(f.x, cameraX);
      g.fillStyle(bodyColor, 1).fillCircle(cx, groundY - r, r);
      if (invuln) g.lineStyle(1, 0xffffff, 0.9).strokeCircle(cx, groundY - r, r);
      return;
    }

    // 后撤步：向后倾斜的平行四边形（用两块矩形近似）
    if (f.state === 'backdash') {
      const lean = -f.facing * 6 * S;
      g.fillStyle(bodyColor, invuln ? 0.55 : 1).fillRect(sx + lean, sy, sw, sh / 2);
      g.fillStyle(bodyColor, invuln ? 0.55 : 1).fillRect(sx, sy + sh / 2, sw, sh / 2);
      return;
    }

    g.fillStyle(bodyColor, 1).fillRect(sx, sy, sw, sh);
    // 霸体：金色描边
    if (this.sim.hasArmor(f)) g.lineStyle(2 * S, 0xffd60a, 0.9).strokeRect(sx - 1 * S, sy - 1 * S, sw + 2 * S, sh + 2 * S);
    // 前冲：身后拖影
    if (f.state === 'dash') {
      g.fillStyle(bodyColor, 0.3).fillRect(sx - f.facing * 6 * S, sy + 4 * S, sw, sh - 4 * S);
    }
    // 防御：面朝侧一道蓝色护盾线
    if (blocking) {
      const shieldX = f.facing === 1 ? sx + sw + 2 * S : sx - 4 * S;
      g.fillStyle(0x48cae4, 1).fillRect(shieldX, sy + 4 * S, 2 * S, sh - 8 * S);
    }
    // 投技：攻击方伸手抓
    if (f.state === 'throw') {
      const armX = f.facing === 1 ? sx + sw : sx - 20 * S;
      g.fillStyle(f.def.color, 0.9).fillRect(armX, sy + sh * 0.25, 20 * S, 8 * S);
    }
    const headW = sw * 0.6;
    g.fillStyle(0xffe8d6, 1).fillRect(sx + (sw - headW) / 2, sy - 10 * S, headW, 10 * S);
    const eyeX = f.facing === 1 ? sx + sw / 2 + headW * 0.15 : sx + sw / 2 - headW * 0.25;
    g.fillStyle(0x000000, 1).fillRect(eyeX, sy - 7 * S, 2 * S, 2 * S);

    // 伸出的肢体：用当前帧的攻击框（无论是否已命中）表现；指令投的抓取框画成手
    const fd = this.sim.currentFrame(f);
    if (fd?.hitboxes && move?.throwData) {
      const [x, y, w, h] = fd.hitboxes[0]!;
      const wx = f.facing === 1 ? x : -x - w;
      g.fillStyle(0xffd60a, 0.5).fillRect(
        this.worldToScreenX(f.x + wx * SUBPIXEL, cameraX),
        this.worldToScreenY(f.y + y * SUBPIXEL),
        w * S,
        h * S,
      );
    } else if (fd?.hitboxes) {
      for (const hb of fd.hitboxes) {
        const [x, y, w, h] = hb;
        const wx = f.facing === 1 ? x : -x - w;
        g.fillStyle(f.def.color, 0.85).fillRect(
          this.worldToScreenX(f.x + wx * SUBPIXEL, cameraX),
          this.worldToScreenY(f.y + y * SUBPIXEL),
          w * S,
          h * S,
        );
      }
    } else if (f.state === 'attack') {
      // 启动 / 收招：画一段短肢体表示"正在出招"
      const armY = sy + sh * 0.3;
      const armX = f.facing === 1 ? sx + sw : sx - 8 * S;
      g.fillStyle(f.def.color, 0.6).fillRect(armX, armY, 8 * S, 6 * S);
    }
  }

  /** 飞行道具：犬头圆 + 尾；熔岩流星 = 发光团 + 下落尾。被弹反后变蓝。 */
  private drawProjectile(p: ProjectileState, cameraX: number): void {
    const g = this.gfx;
    const b = this.sim.projectileBox(p);
    const S = RENDER_SCALE;
    const sx = this.worldToScreenX(b.x, cameraX);
    const sy = this.worldToScreenY(b.y);
    const sw = (b.w / SUBPIXEL) * S;
    const sh = (b.h / SUBPIXEL) * S;
    const main = p.reflected ? 0x48cae4 : 0xff6b35;
    const accent = p.reflected ? 0xcaf0f8 : 0xffd60a;
    if (p.kind === 'dog') {
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;
      g.fillStyle(main, 1).fillCircle(cx, cy, sw / 2);
      const dir = p.vx >= 0 ? 1 : -1;
      g.fillStyle(accent, 1).fillRect(cx + dir * sw * 0.15, cy - sh * 0.25, 4 * S, 4 * S);
      // 尾迹
      for (let i = 1; i <= 3; i++) g.fillStyle(main, 0.35 - i * 0.1).fillCircle(cx - dir * i * 8 * S, cy, sw / 2 - i * 2 * S);
    } else {
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;
      const rx = Math.max(16 * S, sw * 0.7);
      const ry = Math.max(18 * S, sh * 0.78);
      g.fillStyle(0xffe066, 0.28).fillEllipse(cx, cy, rx * 2.1, ry * 2.1);
      g.fillStyle(main, 0.95).fillEllipse(cx, cy, rx * 1.55, ry * 1.7);
      g.fillStyle(accent, 0.9).fillEllipse(cx, cy + 2 * S, rx * 0.7, ry * 0.7);
      g.fillStyle(0xffffff, 0.45).fillEllipse(cx - 3 * S, cy - 4 * S, 5 * S, 4 * S);
      const dirY = p.vy >= 0 ? 1 : -1;
      for (let i = 1; i <= 5; i++) {
        g.fillStyle(main, 0.28 - i * 0.04).fillEllipse(cx, cy - dirY * i * 9 * S, rx * (1 - i * 0.12), ry * (1 - i * 0.1));
      }
    }
  }

  private tickProjectiles(w: WorldState, sx: (x: number) => number, sy: (y: number) => number): void {
    for (const p of w.projectiles) {
      if (!this.prevProj.has(p.id)) {
        const owner = w.fighters[p.owner]!;
        this.audio.playEvent({ phase: 'projectile_spawn', characterId: owner.def.id, materialCharacterId: projectileMaterial(p.kind) ?? owner.def.id, player: p.owner, moveId: p.moveId, projectileKind: p.kind });
      }
      if (p.kind === 'meteor') this.fx.meteorTrail(sx(p.x), sy(p.y));
    }
    for (const end of this.sim.projectileEnds) {
      const material = projectileMaterial(end.kind);
      this.skillFx.projectileEnd(end, endedProjectileVisual(end, w, material ? characters[material]?.moves ?? [] : [], this.prevProj.get(end.id)));
      const owner = w.fighters[end.owner]!;
      // A wide single-hit wave may be born and consumed before any live-projectile sample.
      if (end.kind === 'twinkle_shining_wave' && !this.prevProj.has(end.id) && (end.reason === 'hit' || end.reason === 'block' || end.reason === 'clash')) {
        this.audio.playEvent({ phase: 'projectile_spawn', characterId: owner.def.id, materialCharacterId: material ?? owner.def.id, player: end.owner, moveId: end.moveId, projectileKind: end.kind });
      }
      this.audio.playEvent({ phase: 'projectile_end', characterId: owner.def.id, materialCharacterId: projectileMaterial(end.kind) ?? owner.def.id, player: end.owner, moveId: end.moveId, projectileKind: end.kind, endReason: end.reason });
      if (end.reason === 'ground' && end.kind === 'meteor') {
        this.fx.groundBurst(sx(end.x), sy(GROUND_Y));
        this.shake = Math.max(this.shake, 2.5);
      }
    }
    this.prevProj.clear();
    for (const p of w.projectiles) this.prevProj.set(p.id, { ...p });
  }
}
