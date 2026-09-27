import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { Btn, FightSim, px, totalFrames, type FighterDef, type ControlModes } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { defaultKeyConfig } from '../../src/input/keymap';
import { DEFAULT_ANIMS, type AnimeRuntimeManifest } from '../../src/render/animations';
import { ANIME_CHARACTERS, ANIME_ERRORS, SPRITE_KEYS, type AnimeCharacterAssets } from '../../src/render/assets';
import { adoptPresentation, readPresentation } from '../../src/render/presentation';
import { cpuChallengeData } from '../../src/render/ui/fightNavigation';
import type { ResultData } from '../../src/render/scenes/ResultScene';

const shared = vi.hoisted(() => ({
  input: { controlModes: ['classic', 'classic'] as ControlModes, useMatchControls: vi.fn(), setControlModes: vi.fn(), snapshot: vi.fn(() => ({ p1: 0, p2: 0 })), edges: vi.fn(() => ({ p1: 0, p2: 0 })), flush: vi.fn(), keyConfig: { p1: {}, p2: {} } },
  audio: { onVoice: vi.fn(() => vi.fn()), playPresentation: vi.fn(), voiceBusy: vi.fn(() => false), clearFightSounds: vi.fn(), playMusic: vi.fn(), interruptDailyVoice: vi.fn(), stopAll: vi.fn(), playCue: vi.fn(), playEvent: vi.fn(), play: vi.fn(), resume: vi.fn(), pause: vi.fn(), unlock: vi.fn(), hudState: vi.fn(() => 'ready') },
}));
vi.mock('phaser', () => ({ default: { Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, Core: { Events: { BLUR: 'blur', HIDDEN: 'hidden' } } } }));
vi.mock('../../src/input/InputHub', () => ({ getInputHub: () => shared.input }));
vi.mock('../../src/audio/Sfx', () => ({ sfx: () => shared.audio, sfxHudText: () => '' }));
vi.mock('../../src/render/stage/Marineford', () => ({ Marineford: class {} }));
vi.mock('../../src/render/fx/Particles', () => ({ Particles: class {
  constructor(scene: Phaser.Scene, _capacity: number, world?: Phaser.GameObjects.Container) { world?.add(scene.add.graphics().setDepth(60)); }
} }));
vi.mock('../../src/render/fx/Afterimages', () => ({ Afterimages: class {
  constructor(scene: Phaser.Scene, world?: Phaser.GameObjects.Container) { world?.add(scene.add.graphics().setDepth(9)); }
} }));
vi.mock('../../src/render/DebugOverlay', () => ({ DebugOverlay: class {
  constructor(scene: Phaser.Scene, _enabled: boolean, world?: Phaser.GameObjects.Container) {
    world?.add(scene.add.graphics().setDepth(100));
    scene.add.text(0, 0, 'debug-fixture').setDepth(101);
  }
} }));
vi.mock('../../src/render/FighterView', () => ({ FighterView: class {
  constructor(scene: Phaser.Scene, _key: string, _id: string, _anims: unknown, _presentation: unknown, world?: Phaser.GameObjects.Container) {
    world?.add(scene.add.sprite(0, 0, 'fixture').setDepth(10));
  }
} }));
vi.mock('../../src/render/hud/Hud', () => ({ Hud: class {
  constructor(scene: Phaser.Scene) { scene.add.text(0, 0, 'hud-fixture').setDepth(50); }
} }));
vi.mock('../../src/render/ui/DiagnosticsPanel', () => ({ DiagnosticsPanel: class { visible = false; } }));
vi.mock('../../src/render/ui/MoveListPanel', () => ({ MoveListPanel: class { visible = false; toggle() { this.visible = !this.visible; } } }));
vi.mock('../../src/render/ui/TutorialCoach', () => ({ TutorialCoach: class {}, tutorialDismissed: () => true }));
import { FightScene, type FightSceneData } from '../../src/render/scenes/FightScene';
import { MenuScene } from '../../src/render/scenes/MenuScene';
import { CharacterSelectScene } from '../../src/render/scenes/CharacterSelectScene';
import { ResultScene } from '../../src/render/scenes/ResultScene';

const profile = { art: 'anime', scope: 'full', quality: 'high' } as const;
const data: FightSceneData = { p1: 'luffy', p2: 'akainu', mode: 'versus', difficulty: 'hard', ...profile };

/** Synthetic schema fixtures exercise scene routing only; these do not constitute usable game art. */
function completeRuntime(def: FighterDef): AnimeRuntimeManifest {
  const runtime: AnimeRuntimeManifest = { schemaVersion: 1, characterId: def.id, style: 'anime', continuous: true, atlas: { image: 'atlas.png', data: 'atlas.json' }, anims: {}, attachments: {} };
  const names = new Set([...Object.keys(DEFAULT_ANIMS), ...def.moves.map(move => move.id)]);
  for (const name of names) {
    const move = def.moves.find(move => move.id === name);
    runtime.anims[name] = { frames: 1, fps: 60, loop: !move, pixelArt: false, exposures: [{ frame: 0, ticks: move ? totalFrames(move) : 8 }], ...(move?.throwData ? { throwExposures: [{ frame: 0, ticks: move.throwData.duration ?? totalFrames(move) }] } : {}) };
    runtime.attachments[`${def.id}/${name}/0`] = { size: { width: 80, height: 160 }, root: { x: 40, y: 160 }, sockets: {} };
  }
  return runtime;
}
function registry() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) };
}

function display(initial = '', type = 'display'): object {
  const record: Record<string, unknown> = { text: initial, type, height: 160, visible: true, x: 0, y: 0, scaleX: 1, scaleY: 1, depth: 0, parentContainer: null, list: [] as object[] };
  const object = new Proxy(record, { get: (target, key) => {
    if (typeof key === 'string' && key in target) return target[key];
    return (...args: unknown[]) => {
      if (key === 'setText') target.text = args[0];
      if (key === 'setVisible') target.visible = args[0];
      if (key === 'setDepth') target.depth = args[0];
      if (key === 'setPosition') { target.x = args[0]; target.y = args[1]; }
      if (key === 'setScale') { target.scaleX = args[0]; target.scaleY = args[1] ?? args[0]; }
      if (key === 'add' && type === 'container') {
        for (const child of Array.isArray(args[0]) ? args[0] : [args[0]]) {
          Reflect.set(child, 'parentContainer', object);
          (target.list as object[]).push(child);
        }
      }
      if (key === 'sort' && type === 'container') (target.list as object[]).sort((a, b) => Number(Reflect.get(a, String(args[0]))) - Number(Reflect.get(b, String(args[0]))));
      return object;
    };
  } });
  return object;
}
function configure<T extends Phaser.Scene>(scene: T, values = registry()) {
  const navigation = { start: vi.fn(), restart: vi.fn(), isActive: () => true };
  const displays: object[] = [];
  const add = (type: string, label = '') => { const object = display(label, type); displays.push(object); return object; };
  Object.assign(scene, {
    registry: values, scene: navigation,
    scale: { width: 960, height: 540 },
    textures: { exists: () => true, get: () => ({ has: () => true }) },
    add: { container: () => add('container'), graphics: () => add('graphics'), rectangle: () => add('rectangle'), sprite: () => add('sprite'), image: () => add('image'), text: (_x: number, _y: number, label: string) => add('text', label) },
    input: { keyboard: { on: vi.fn() } },
    game: { events: { on: vi.fn(), off: vi.fn() } }, events: { once: vi.fn() },
  });
  return { scene, navigation, values, displays };
}
function fight(entry: FightSceneData = data) {
  const fixture = configure(new FightScene());
  const assets: AnimeCharacterAssets = { luffy: { key: 'fixture-luffy', runtime: completeRuntime(luffyDef) }, akainu: { key: 'fixture-akainu', runtime: completeRuntime(akainuDef) } };
  fixture.values.set(ANIME_CHARACTERS, assets);
  fixture.values.set(ANIME_ERRORS, {});
  fixture.values.set(SPRITE_KEYS, { luffy: 'fixture-pixel-luffy', akainu: 'fixture-pixel-akainu' });
  fixture.scene.create(entry);
  return { ...fixture, assets, sim: Reflect.get(fixture.scene, 'sim') as FightSim };
}

beforeEach(() => {
  vi.clearAllMocks();
  shared.input.controlModes = ['classic', 'classic'];
  shared.input.keyConfig = defaultKeyConfig();
  shared.input.snapshot.mockReturnValue({ p1: 0, p2: 0 }); shared.input.edges.mockReturnValue({ p1: 0, p2: 0 });
  vi.stubGlobal('window', { location: { search: '?art=anime&scope=sample&mode=training&hold=st_c/0' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('complete anime match routing after legitimate coverage readiness', () => {
  it('pause and move list discard pending scene input without advancing combat', () => {
    const { scene, sim } = fight();
    const clear = vi.spyOn(sim, 'clearInputs');
    Object.assign(scene, { pendingTraining: { p1: Btn.Skill1, p2: Btn.A }, previousTraining: { p1: Btn.Skill1, p2: 0 }, lastInput: { p1: Btn.Skill1, p2: 0 } });
    const frame = sim.state.frame;
    Reflect.apply(Reflect.get(scene, 'togglePause'), scene, []);
    expect(clear).toHaveBeenCalledOnce();
    for (const field of ['pendingTraining', 'previousTraining', 'lastInput']) expect(Reflect.get(scene, field)).toEqual({ p1: 0, p2: 0 });
    Reflect.apply(Reflect.get(scene, 'toggleMoveList'), scene, []);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(sim.state.frame).toBe(frame);
  });
  it('freezes mixed match controls, keeps CPU classic, and rematch picks newly saved preferences', () => {
    const mixed = fight({ ...data, controlModes: ['simple', 'classic'] });
    expect(mixed.sim.controlModes).toEqual(['simple', 'classic']);
    expect(shared.input.useMatchControls).toHaveBeenCalledWith(['simple', 'classic']);
    shared.input.controlModes = ['classic', 'simple'];
    expect(mixed.sim.controlModes).toEqual(['simple', 'classic']);
    const result = configure(new ResultScene());
    result.scene.init({ ...data, controlModes: ['simple', 'classic'], winner: 0, wins: [2, 0] });
    Object.assign(result.scene, { step: { advance: () => 1 }, menu: { index: 0, update: () => 'select' } });
    result.scene.update(0, 1000 / 60);
    expect(result.navigation.start).toHaveBeenCalledWith('Preload', expect.objectContaining({ controlModes: ['classic', 'simple'] }));
    expect(fight({ ...data, mode: 'cpu', controlModes: ['simple', 'simple'] }).sim.controlModes).toEqual(['simple', 'classic']);
  });
  it.each(['anime', 'legacy'] as const)('%s creation keeps combat visuals together and HUD/debug text outside the world transform', art => {
    const { scene, displays } = fight({ ...data, art });
    const world = Reflect.get(scene, 'worldLayer') as Phaser.GameObjects.Container;
    expect(Reflect.get(scene, 'worldFraming')).toBeUndefined();
    expect(world.scaleX).toBe(1); expect(world.scaleY).toBe(1);
    expect(world.list).toContain(Reflect.get(scene, 'gfx'));
    expect(world.list.filter(child => Reflect.get(child, 'type') === 'sprite')).toHaveLength(2);
    const interfaceItems = displays.filter(item => ['hud-fixture', 'debug-fixture'].includes(String(Reflect.get(item, 'text'))));
    expect(interfaceItems).toHaveLength(2);
    for (const item of interfaceItems) {
      expect(Reflect.get(item, 'parentContainer')).toBeNull();
      expect(Reflect.get(item, 'depth')).toBeGreaterThan(world.depth);
    }
    const combat = world.list.map(child => Number(Reflect.get(child, 'depth')));
    expect(combat).toEqual(expect.arrayContaining([0, 9, 60, 100]));
  });

  it.each(['versus', 'cpu'] as const)('%s retains all moves, finite resources, intro and live animation after a training photo URL', mode => {
    const { scene, navigation, sim } = fight({ ...data, mode });
    expect(navigation.start).not.toHaveBeenCalled();
    expect(Reflect.get(scene, 'ready')).toBe(true);
    expect(Reflect.get(scene, 'mode')).toBe(mode);
    expect(Reflect.get(scene, 'sample')).toBeNull();
    expect(Reflect.get(scene, 'holdPose')).toBeUndefined();
    expect(sim.state.fighters.map(f => f.def.moves)).toEqual([luffyDef.moves, akainuDef.moves]);
    expect(sim.training).toEqual({ infiniteHp: false, infiniteMeter: false });
    expect(sim.state.phase).toBe('intro');
    expect(sim.state.timer).toBeGreaterThan(0);
    expect(!!Reflect.get(scene, 'cpu')).toBe(mode === 'cpu');
  });

  it('full training intentionally retains practice resources but never creates the sample controller', () => {
    const { scene, sim } = fight({ ...data, mode: 'training' });
    expect(Reflect.get(scene, 'sample')).toBeNull();
    expect(sim.state.fighters[0].def.moves).toBe(luffyDef.moves);
    expect(sim.training).toEqual({ infiniteHp: true, infiniteMeter: true });
    expect(sim.state.timer).toBe(-1);
    expect(Reflect.get(scene, 'holdPose')).toBe('st_c/0');
  });

  it('invalid sample CPU request is blocked without silently changing its mode for retry', () => {
    const { navigation, scene, sim } = fight({ ...data, mode: 'cpu', scope: 'sample' });
    expect(sim).toBeUndefined();
    expect(Reflect.get(scene, 'ready')).toBe(false);
    expect(navigation.start).toHaveBeenCalledWith('Preload', expect.objectContaining({ art: 'anime', scope: 'sample', mode: 'cpu', failure: expect.arrayContaining([expect.stringContaining('只开放训练')]) }));
  });

  it('missing full-mode action still prevents FightSim creation; full mode does not become a sample', () => {
    const current = configure(new FightScene());
    const assets: AnimeCharacterAssets = { luffy: { key: 'fixture-luffy', runtime: completeRuntime(luffyDef) }, akainu: { key: 'fixture-akainu', runtime: completeRuntime(akainuDef) } };
    delete assets.akainu!.runtime.anims.win;
    current.values.set(ANIME_CHARACTERS, assets);
    current.scene.create({ ...data, mode: 'cpu' });
    expect(Reflect.get(current.scene, 'sim')).toBeUndefined();
    expect(current.navigation.start).toHaveBeenCalledWith('Preload', expect.objectContaining({ ...profile, mode: 'cpu', failure: expect.arrayContaining([expect.stringContaining('win')]) }));
  });

  it.each([0, 1] as const)('full match winner%s processes two real lethal strikes and reaches Result instead of sample healing or KO interception', winner => {
    const { scene, sim, navigation } = fight();
    const resetTraining = vi.fn();
    Object.assign(scene, {
      step: { advance: () => 1 }, resetTraining, checkGamepadDisconnect: vi.fn(), drawWorld: vi.fn(), tickPopups: vi.fn(),
      fx: { tick: vi.fn() }, after: { tick: vi.fn() }, afterStep: vi.fn(), hud: { reset: vi.fn() },
    });
    const posedRounds = new Set<number>();
    let sawZeroHp = false;
    let sawGroundKO = false;
    const loser = winner === 0 ? 1 : 0;
    for (let tick = 0; tick < 1100 && sim.state.phase !== 'match_end'; tick++) {
      let attacking = false;
      if (sim.state.phase === 'fight' && !posedRounds.has(sim.state.round)) {
        // Set up a short deterministic lethal-contact fixture; the scene still advances the real core.
        posedRounds.add(sim.state.round);
        sim.state.fighters[0].x = px(-20); sim.state.fighters[1].x = px(20); sim.state.fighters[loser].hp = 1;
        attacking = true;
      }
      shared.input.snapshot.mockReturnValue({ p1: attacking && winner === 0 ? Btn.A : 0, p2: attacking && winner === 1 ? Btn.A : 0 });
      scene.update(0, 1000 / 60);
      if (sim.state.fighters[loser].hp === 0) sawZeroHp = true;
      if (sim.state.fighters[loser].state === 'ko' && !sim.state.fighters[loser].airborne) sawGroundKO = true;
    }
    expect(sawZeroHp).toBe(true);
    expect(sawGroundKO).toBe(true);
    expect(posedRounds.size).toBe(2);
    expect(sim.state.phase).toBe('match_end');
    const wins = winner === 0 ? [2, 0] : [0, 2];
    expect(sim.state.wins).toEqual(wins);
    expect(resetTraining).not.toHaveBeenCalled();
    shared.input.snapshot.mockReturnValue({ p1: Btn.Start, p2: 0 });
    scene.update(0, 1000 / 60);
    expect(navigation.start).toHaveBeenCalledWith('Result', expect.objectContaining({ ...data, winner, wins }));
  });

  it('Menu, character selection and result rematch retain art/quality and request full-mode loading', () => {
    const values = registry();
    const menu = configure(new MenuScene(), values);
    menu.scene.init({ ...profile, scope: 'sample' });
    menu.scene.create();
    Object.assign(menu.scene, { step: { advance: () => 1 }, menu: { index: 2, update: () => 'select' } });
    menu.scene.update(0, 1000 / 60);
    const selected = menu.navigation.start.mock.calls[0]![1];
    expect(selected).toMatchObject({ ...profile, mode: 'cpu' });
    const characters = configure(new CharacterSelectScene(), values);
    characters.scene.init(selected);
    Object.assign(characters.scene, { difficulty: 'hard' });
    Reflect.apply(Reflect.get(characters.scene, 'start'), characters.scene, []);
    const loaded = characters.navigation.start.mock.calls[0]![1] as FightSceneData;
    expect(characters.navigation.start).toHaveBeenCalledWith('Preload', expect.objectContaining({ ...profile, p1: 'luffy', p2: 'akainu', mode: 'cpu', difficulty: 'hard' }));
    const result = configure(new ResultScene(), values);
    result.scene.init({ ...loaded, winner: 1, wins: [0, 2] });
    Object.assign(result.scene, { step: { advance: () => 1 }, menu: { index: 0, update: () => 'select' } });
    result.scene.update(0, 1000 / 60);
    expect(result.navigation.start).toHaveBeenCalledWith('Preload', { ...loaded, tutorial: undefined });
    expect(readPresentation(values)).toEqual(profile);
  });

  it.each([0, 1] as const)('winner%s result offers same-mode rematch, character selection and title with the current profile', winner => {
    const result = configure(new ResultScene());
    const resultData: ResultData = { ...data, winner, wins: winner === 0 ? [2, 0] : [0, 2] };
    result.scene.init(resultData);
    for (const index of [0, 1, 2]) {
      Object.assign(result.scene, { step: { advance: () => 1 }, menu: { index, update: () => 'select' } });
      result.scene.update(0, 1000 / 60);
    }
    expect(result.navigation.start.mock.calls.map(call => call[0])).toEqual(['Preload', 'CharacterSelect', 'Title']);
    for (const [, next] of result.navigation.start.mock.calls) expect(next).toMatchObject(profile);
    const rematch = result.navigation.start.mock.calls[0]![1] as FightSceneData;
    const fresh = fight(rematch);
    expect(fresh.sim.state.wins).toEqual([0, 0]);
    expect(fresh.sim.training.infiniteHp).toBe(false);
    expect(Reflect.get(fresh.scene, 'holdPose')).toBeUndefined();
  });

  it('tutorial challenge creates a fresh full CPU match, independent of training state and remaining photo query', () => {
    const previous = fight({ ...data, mode: 'training', tutorial: true });
    previous.sim.state.fighters[0].hp = 30;
    const challenge = cpuChallengeData({ ...data, mode: 'training', tutorial: true });
    const next = fight(challenge);
    expect(next.sim.state.fighters[0].hp).toBe(luffyDef.maxHp);
    expect(next.sim.training).toEqual({ infiniteHp: false, infiniteMeter: false });
    expect(Reflect.get(next.scene, 'mode')).toBe('cpu');
    expect(Reflect.get(next.scene, 'sample')).toBeNull();
    expect(Reflect.get(next.scene, 'tutorial')).toBeNull();
    expect(Reflect.get(next.scene, 'holdPose')).toBeUndefined();
    adoptPresentation(next.values);
    expect(readPresentation(next.values)).toEqual(profile);
  });
});
