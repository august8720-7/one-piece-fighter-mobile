import { DailyAudio } from '../../src/audio/DailyAudio';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Btn, FightSim, px, type WorldState } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { AnimeSampleController } from '../../src/render/anime/sampleMode';

const shared = vi.hoisted(() => ({
  input: { snapshot: vi.fn(() => ({ p1: 0, p2: 0 })), flush: vi.fn() },
  audio: { clearFightSounds: vi.fn(), playCue: vi.fn(), hudState: vi.fn(() => 'ready') },
}));
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/input/InputHub', () => ({ getInputHub: () => shared.input }));
vi.mock('../../src/audio/Sfx', () => ({ sfx: () => shared.audio, sfxHudText: () => '' }));
import { FightScene } from '../../src/render/scenes/FightScene';

const effects = () => ({ clear: vi.fn(), tick: vi.fn(), draw: vi.fn() });
const rectangle = () => ({ setAlpha: vi.fn() });

describe('candidate scene recovery before presentation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('intercepts a real lethal strike before KO events/drawing, clearing old presentation state', () => {
    const sim = new FightSim({
      p1: { ...luffyDef, moves: luffyDef.moves.filter(move => ['st_a', 'st_c'].includes(move.id)) },
      p2: { ...akainuDef, moves: akainuDef.moves.filter(move => ['st_a', 'sp_daifunka'].includes(move.id)) },
      introFrames: 0, roundTime: -1,
    });
    sim.training = { infiniteHp: true, infiniteMeter: true };
    sim.state.fighters[0].x = px(-470);
    sim.state.fighters[1].x = px(-290);
    const sample = new AnimeSampleController();
    sample.mode = 'human';
    for (const p2 of [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.A]) sim.step(sample.input(sim, { p1: 0, p2 }));
    sim.state.fighters[0].hp = 1;
    const fx = effects(), skillFx = effects(), after = effects();
    const popup = { text: { destroy: vi.fn() }, ttl: 90 };
    const hud = { reset: vi.fn(), draw: vi.fn() };
    const draw = vi.fn((world: WorldState) => {
      expect(world.phase).toBe('fight');
      expect(world.fighters.every(fighter => fighter.hp > 0 && fighter.state !== 'ko')).toBe(true);
    });
    const afterStep = vi.fn(() => expect(sim.state.roundOver).toBe(false));
    const scene = Object.create(FightScene.prototype) as FightScene;
    Object.assign(scene, {
      ready: true,
      sim, sample, sampleResetWorld: null, step: { advance: () => 1 },
      settingsOverlay: false, paused: false, moveList: null, mode: 'training', cpu: null,
      lastInput: { p1: 0, p2: 0 }, pendingTraining: { p1: 0, p2: 0 }, previousTraining: { p1: 0, p2: 0 },
      trainStep: false, trainFreeze: false, trainTick: 0, trainScale: 1,
      tutorial: null, tutorialCompletePending: false, checkGamepadDisconnect: vi.fn(),
      dailyAudio: new DailyAudio(), fx, skillFx, after, hud, audio: shared.audio, afterStep, draw,
      superDim: rectangle(), flash: rectangle(), koDim: rectangle(),
      superDimFrames: 10, flashAlpha: 0.6, shake: 4, slowAcc: 0, wasRoundOver: false,
      prevProj: new Map([[7, { kind: 'dog', x: 0, y: 0 }]]),
      prevInstances: [4, 8], prevSegments: ['active', 'active'], prevMoveIds: ['st_a', 'sp_daifunka'],
      prevStates: ['hit_air', 'attack'], prevAirborne: [true, false], winVoiceRound: 1,
      popups: [popup], tickPopups: vi.fn(), syncAudioPause: vi.fn(), refreshControlHint: vi.fn(),
      skillBar: { draw: vi.fn() }, subtitles: { setY: vi.fn() },
      data_: { p1: 'luffy', p2: 'akainu' }, presentations: [null, null], registry: { get: () => undefined },
      muteText: { style: { color: '#e8c36a' }, setText: vi.fn(), setColor: vi.fn() }, trainingText: { setY: vi.fn(), setText: vi.fn() },
    });
    let ticks = 0;
    while (ticks < 80 && !shared.audio.clearFightSounds.mock.calls.length) { scene.update(0, 16.67); ticks++; }
    expect(shared.audio.clearFightSounds).toHaveBeenCalledOnce();
    expect(shared.audio.playCue).toHaveBeenCalledWith('marineford_ambient');
    expect(shared.input.flush).toHaveBeenCalledOnce();
    expect(afterStep).toHaveBeenCalledTimes(ticks - 1);
    for (const effect of [fx, skillFx, after]) expect(effect.clear).toHaveBeenCalledOnce();
    expect(popup.text.destroy).toHaveBeenCalledOnce();
    expect(hud.reset).toHaveBeenCalledOnce();
    expect(Reflect.get(scene, 'prevProj').size).toBe(0);
    expect(Reflect.get(scene, 'prevInstances')).toEqual([-1, -1]);
    expect(Reflect.get(scene, 'prevSegments')).toEqual([null, null]);
    expect(Reflect.get(scene, 'prevMoveIds')).toEqual([null, null]);
    expect(Reflect.get(scene, 'prevStates')).toEqual(['idle', 'idle']);
    expect(Reflect.get(scene, 'prevAirborne')).toEqual([false, false]);
    expect(Reflect.get(scene, 'flashAlpha')).toBe(0);
    expect(Reflect.get(scene, 'superDimFrames')).toBe(0);
    expect(Reflect.get(scene, 'shake')).toBe(0);
    const lastDraw = draw.mock.calls.at(-1)![0];
    expect(lastDraw.cameraX).toBe(0);
    expect(lastDraw.wins).toEqual([0, 0]);
    expect(lastDraw.fighters.map(fighter => [fighter.state, fighter.hp, fighter.x]))
      .toEqual([['idle', luffyDef.maxHp, px(-90)], ['idle', akainuDef.maxHp, px(90)]]);
    expect(sim.hits).toEqual([]);

    // The same handler is wired to F6. A paused update cannot be relied on to redraw it later.
    for (let tick = 0; tick < 10; tick++) sim.step({ p1: Btn.Right, p2: 0 });
    sim.step({ p1: 0, p2: Btn.A });
    expect(sim.state.fighters[0].x).not.toBe(px(-90));
    expect(sim.state.fighters[1].state).toBe('attack');
    Object.assign(scene, { paused: true, updatePaused: vi.fn() });
    draw.mockClear(); hud.draw.mockClear();
    Reflect.apply(Reflect.get(scene, 'resetTraining'), scene, []);
    expect(draw).toHaveBeenCalledOnce();
    expect(hud.draw).toHaveBeenCalledOnce();
    const pausedView = draw.mock.calls[0]![0];
    expect(pausedView.cameraX).toBe(0);
    expect(pausedView.fighters.map(fighter => [fighter.x, fighter.state]))
      .toEqual([[px(-90), 'idle'], [px(90), 'idle']]);
    scene.update(0, 16.67);
    expect(draw).toHaveBeenCalledOnce();
    expect(Reflect.get(scene, 'paused')).toBe(true);
  });
});
