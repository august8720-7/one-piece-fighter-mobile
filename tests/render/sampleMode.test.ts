import { describe, expect, it } from 'vitest';
import { Btn, FightSim, px, totalFrames, type FighterDef, type InputFrame, type StateId } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import { AnimeSampleController, createSampleFighter, resetSampleRound, sampleCapabilities, sampleHoldPose, sampleResetReason, validateSampleCoverage } from '../../src/render/anime/sampleMode';
import type { AnimeRuntimeManifest } from '../../src/render/animations';

const BASE = ['idle', 'walk_fwd', 'walk_back', 'crouch', 'block_stand', 'block_crouch', 'hit_stand', 'hit_crouch'];
function runtime(
  def: FighterDef,
  states = BASE,
  extraMoves: readonly string[] = def.id === 'luffy' ? ['st_c'] : ['sp_daifunka'],
): AnimeRuntimeManifest {
  const value: AnimeRuntimeManifest = { schemaVersion: 1, characterId: def.id, style: 'anime', continuous: true, atlas: { image: 'atlas.png', data: 'atlas.json' }, anims: {}, attachments: {} };
  for (const name of [...states, 'st_a', ...extraMoves]) {
    const move = def.moves.find(move => move.id === name);
    if (!states.includes(name) && !move) continue;
    value.anims[name] = { frames: 1, fps: 60, loop: !move, pixelArt: false, exposures: [{ frame: 0, ticks: move ? totalFrames(move) : 8 }] };
    value.attachments[`${def.id}/${name}/0`] = { size: { width: 40, height: 80 }, root: { x: 20, y: 80 }, sockets: {} };
  }
  return value;
}
const sample = (def: FighterDef, ability = false) => createSampleFighter(def, runtime(def), { opponentRuntime: runtime(luffyDef, ability ? [...BASE, 'hit_air', 'knockdown', 'getup'] : BASE) });
const make = () => new FightSim({ p1: sample(luffyDef), p2: sample(akainuDef), introFrames: 0, roundTime: -1 });
const advance = (sim: FightSim, controller: AnimeSampleController, raw: InputFrame) => sim.step(controller.input(sim, raw));
const AIR = ['hit_air', 'knockdown', 'getup'];
const JUMP = ['prejump', 'jump_neutral', 'jump_fwd', 'jump_back', 'landing'];

function expandedPractice(extra: string[]) {
  const art = runtime(luffyDef, [...BASE, ...extra]), other = runtime(akainuDef);
  const sim = new FightSim({
    p1: createSampleFighter(luffyDef, art, { opponentRuntime: other }),
    p2: createSampleFighter(akainuDef, other, { opponentRuntime: art }),
    introFrames: 0, roundTime: -1,
  });
  const controller = new AnimeSampleController(1, [sampleCapabilities(art), sampleCapabilities(other)]);
  controller.mode = 'human';
  return { sim, controller, art, other };
}

describe('sample capabilities follow complete authored dependencies', () => {
  it.each([...JUMP, ...AIR])('keeps jumping closed while the legitimate unmade %s state is absent', absent => {
    const { sim, controller } = expandedPractice([...JUMP, ...AIR].filter(name => name !== absent));
    expect(controller.capabilities[0].jump).toBe(false);
    for (let tick = 0; tick < 70; tick++) {
      advance(sim, controller, { p1: Btn.Up, p2: 0 });
      expect(sim.state.fighters[0].airborne).toBe(false);
      expect(sim.state.fighters[0].state).not.toBe('prejump');
    }
  });

  it.each([1, 4])('allows actual short/full jumps only after the full chain exists (hold=%s)', hold => {
    const { sim, controller, art } = expandedPractice([...JUMP, ...AIR]);
    const reached = new Set<string>();
    for (let tick = 0; tick < 70; tick++) {
      const before = JSON.stringify(sim.state);
      const input = controller.input(sim, { p1: tick < hold ? Btn.Up : 0, p2: 0 });
      expect(JSON.stringify(sim.state)).toBe(before);
      sim.step(input);
      const state = sim.state.fighters[0].state;
      reached.add(state);
      expect(art.anims[state]).toBeDefined();
    }
    expect(reached).toEqual(new Set(['prejump', 'jump_neutral', 'landing', 'idle']));
  });

  it.each([1, -1] as const)('enables forward dash independently of missing backdash in either facing (%s)', facing => {
    const { sim, controller } = expandedPractice(['dash']);
    sim.state.fighters[0].x = px(-90 * facing); sim.state.fighters[1].x = px(90 * facing);
    sim.step({ p1: 0, p2: 0 });
    const forward = facing === 1 ? Btn.Right : Btn.Left, back = facing === 1 ? Btn.Left : Btn.Right;
    for (const p1 of [forward, 0, forward]) advance(sim, controller, { p1, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('dash');
    for (const p1 of [0, back, 0, back]) advance(sim, controller, { p1, p2: 0 });
    expect(sim.state.fighters[0].state).not.toBe('backdash');
    expect(controller.blockedDash[0]).toBe(true);
  });

  it('opens forward roll without leaking a backward roll even when a kick button is also available', () => {
    const { sim, controller } = expandedPractice(['roll_fwd', 'st_b']);
    for (let tick = 0; tick < 40; tick++) advance(sim, controller, { p1: tick === 0 ? Btn.A | Btn.B : 0, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('idle');
    const blocked = controller.input(sim, { p1: Btn.Left | Btn.A | Btn.B, p2: 0 });
    expect(blocked.p1 & Btn.B).toBe(0);
    sim.step(blocked);
    expect(sim.state.fighters[0].state).not.toBe('roll_back');
    const forward = expandedPractice(['roll_fwd']);
    advance(forward.sim, forward.controller, { p1: Btn.A | Btn.B, p2: 0 });
    expect(forward.sim.state.fighters[0].state).toBe('roll_fwd');
  });

  it('new mapped ground and air moves are selected from their dependencies without editing a move whitelist', () => {
    const incomplete = expandedPractice(['st_b', 'j_a']);
    expect(incomplete.sim.state.fighters[0].def.moves.map(move => move.id)).toContain('st_b');
    expect(incomplete.sim.state.fighters[0].def.moves.map(move => move.id)).not.toContain('j_a');
    const complete = expandedPractice(['st_b', 'j_a', ...JUMP, ...AIR]);
    expect(complete.sim.state.fighters[0].def.moves.map(move => move.id)).toContain('j_a');
    for (let tick = 0; tick < 10; tick++) advance(complete.sim, complete.controller, { p1: tick < 4 ? Btn.Up : tick === 6 ? Btn.A : 0, p2: 0 });
    expect(complete.sim.state.fighters[0].moveId).toBe('j_a');
    expect(complete.sim.state.fighters[0].def.moves.find(move => move.id === 'j_a')).toBe(luffyDef.moves.find(move => move.id === 'j_a'));
  });

  it('missing declared frame geometry never opens movement, while hold only admits actual named frames', () => {
    const { art } = expandedPractice([...JUMP, ...AIR, 'dash']);
    expect(sampleHoldPose(null, art)).toEqual({ pose: null, issue: null });
    expect(sampleHoldPose('jump_neutral/0', art)).toEqual({ pose: 'jump_neutral/0', issue: null });
    expect(sampleHoldPose('jump_neutral/99', art).issue).toContain('不存在');
    expect(sampleHoldPose('../idle', art).issue).toContain('不存在');
    delete art.attachments['luffy/landing/0'];
    expect(sampleCapabilities(art).jump).toBe(false);
    expect(sampleCapabilities(art).dash).toBe(false);
  });
});

describe('limited anime sample roster', () => {
  it('keeps original move objects and every other fighter property unchanged', () => {
    const original = JSON.stringify(luffyDef), def = sample(luffyDef);
    expect(def.moves.map(move => move.id)).toEqual(['st_a', 'st_c']);
    for (const move of def.moves) expect(move).toBe(luffyDef.moves.find(original => original.id === move.id));
    expect(def.movement).toBe(luffyDef.movement);
    expect(def.hurtboxStand).toBe(luffyDef.hurtboxStand);
    expect(JSON.stringify(luffyDef)).toBe(original);
  });

  it('enables an authored launcher only when the target reaction chain is complete', () => {
    expect(sample(akainuDef).moves.map(move => move.id)).toEqual(['st_a']);
    expect(sample(akainuDef, true).moves.map(move => move.id)).toEqual(['sp_daifunka', 'st_a']);
    const art = runtime(akainuDef);
    delete art.anims.sp_daifunka;
    expect(createSampleFighter(akainuDef, art, { opponentRuntime: runtime(luffyDef, [...BASE, 'hit_air', 'knockdown', 'getup']) }).moves.map(move => move.id)).toEqual(['st_a']);
  });

  it('reports reachable hurt states and missing drawings instead of replacing them with idle', () => {
    const def = sample(luffyDef), art = runtime(luffyDef);
    expect(validateSampleCoverage(def, art, sample(akainuDef)).ok).toBe(true);
    const airborne = validateSampleCoverage(def, art, sample(akainuDef, true));
    expect(airborne.ok).toBe(false);
    expect(airborne.missingStates).toEqual(['hit_air', 'knockdown', 'getup']);
    const finite = validateSampleCoverage(def, art, sample(akainuDef), { infiniteHp: false });
    expect(finite.missingStates).toEqual(['hit_air', 'ko', 'win']);
    delete art.anims.hit_stand;
    delete art.anims.st_c;
    const absent = validateSampleCoverage(def, art, sample(akainuDef));
    expect(absent.missingStates).toContain('hit_stand');
    expect(absent.missingMoves).toContain('st_c');
  });
});

describe('sample input gate and real core transitions', () => {
  it.each([Btn.Left, Btn.Right])('immediate walking, but a fast second press stays suppressed until release (%s)', (direction) => {
    const sim = make(), controller = new AnimeSampleController();
    controller.mode = 'human';
    const firstX = sim.state.fighters[0].x;
    advance(sim, controller, { p1: direction, p2: 0 });
    expect(sim.state.fighters[0].x).not.toBe(firstX);
    for (let i = 0; i < 20; i++) advance(sim, controller, { p1: direction, p2: 0 });
    advance(sim, controller, { p1: 0, p2: 0 });
    for (let i = 0; i < 20; i++) {
      const input = controller.input(sim, { p1: direction, p2: 0 });
      expect(input.p1 & direction).toBe(0);
      expect(controller.blockedDash[0]).toBe(true);
      sim.step(input);
      expect(['dash', 'backdash']).not.toContain(sim.state.fighters[0].state);
    }
    advance(sim, controller, { p1: 0, p2: 0 });
    const resumed = controller.input(sim, { p1: direction, p2: 0 });
    expect(resumed.p1 & direction).toBe(direction);
  });

  it('does not admit jump, roll, kick, throw or unavailable crouching attacks', () => {
    const sim = make(), controller = new AnimeSampleController();
    controller.mode = 'human';
    const filtered = controller.input(sim, { p1: Btn.Up | Btn.A | Btn.B | Btn.C | Btn.D, p2: Btn.Up | Btn.C | Btn.D });
    expect(filtered).toEqual({ p1: Btn.A | Btn.C, p2: 0 });
    advance(sim, controller, { p1: Btn.Down | Btn.A, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBeNull();
    expect(sim.state.fighters[0].state).toBe('crouch');
    expect(controller.input(sim, { p1: Btn.Start, p2: Btn.Start })).toEqual({ p1: Btn.Start, p2: Btn.Start });
  });

  it('preserves a real 236 input for the explicitly enabled Akainu ability', () => {
    const sim = new FightSim({ p1: sample(akainuDef, true), p2: sample(luffyDef), introFrames: 0, roundTime: -1 });
    const controller = new AnimeSampleController();
    controller.mode = 'human';
    for (const bits of [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]) advance(sim, controller, { p1: bits, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('sp_daifunka');
  });

  it('controller only reads core state and counter mode uses existing jab reach', () => {
    const sim = make(), controller = new AnimeSampleController();
    controller.mode = 'counter';
    const before = JSON.stringify(sim.state);
    expect(controller.input(sim, { p1: 0, p2: 0 }).p2).toBe(0);
    expect(JSON.stringify(sim.state)).toBe(before);
    sim.state.fighters[0].x = px(-15);
    sim.state.fighters[1].x = px(15);
    const close = JSON.stringify(sim.state);
    const input = controller.input(sim, { p1: 0, p2: 0 });
    expect(input.p2).toBe(Btn.A);
    expect(JSON.stringify(sim.state)).toBe(close);
    sim.step(input);
    expect(sim.state.fighters[1].moveId).toBe('st_a');
    expect(controller.input(sim, { p1: 0, p2: 0 }).p2).toBe(0);
  });

  it('standing guard produces an actual block and F5 mode cycling stays bounded', () => {
    const sim = make(), controller = new AnimeSampleController();
    expect([controller.next(), controller.next(), controller.next(), controller.next()]).toEqual(['block', 'counter', 'human', 'stand']);
    controller.mode = 'block';
    sim.state.fighters[0].x = px(-12);
    sim.state.fighters[1].x = px(12);
    const hits: string[] = [];
    for (let i = 0; i < 15; i++) {
      advance(sim, controller, { p1: i === 0 ? Btn.A : 0, p2: 0 });
      hits.push(...sim.hits.map(hit => hit.kind));
    }
    expect(hits).toContain('block');
  });
});

function abilityPractice(wall = false) {
  const sim = new FightSim({ p1: sample(luffyDef), p2: sample(akainuDef, true), introFrames: 0, roundTime: -1 });
  sim.training = { infiniteHp: true, infiniteMeter: true };
  const controller = new AnimeSampleController();
  controller.mode = 'human';
  if (wall) { sim.state.fighters[0].x = px(-470); sim.state.fighters[1].x = px(-290); }
  return { sim, controller };
}

function restrictedAbilityPair(def: FighterDef, opponent: FighterDef, moveId: string): [FighterDef, FighterDef] {
  const ownStates = moveId === 'sp_tiny_star' ? [...BASE, ...AIR] : BASE;
  const ownArt = runtime(def, ownStates, [moveId]);
  const opponentArt = runtime(opponent, [...BASE, ...AIR], []);
  return [
    createSampleFighter(def, ownArt, { opponentRuntime: opponentArt }),
    createSampleFighter(opponent, opponentArt, { opponentRuntime: ownArt }),
  ];
}

describe('sample ability dummy and practice recovery', () => {
  it('offers the ability loop only for the actual enabled dummy move list', () => {
    const controller = new AnimeSampleController(), base = make(), { sim } = abilityPractice();
    expect(controller.availableModes(base)).toEqual(['stand', 'block', 'counter', 'human']);
    expect(controller.availableModes(sim)).toEqual(['stand', 'block', 'counter', 'ability', 'human']);
    expect([controller.next(sim), controller.next(sim), controller.next(sim), controller.next(sim), controller.next(sim)])
      .toEqual(['block', 'counter', 'ability', 'human', 'stand']);
    const swapped = new FightSim({ p1: sample(akainuDef, true), p2: sample(luffyDef), introFrames: 0 });
    expect(controller.availableModes(swapped)).not.toContain('ability');
    expect(new AnimeSampleController(0).availableModes(swapped)).toContain('ability');
  });

  it.each([false, true])('the dummy approaches then executes actual 236+A facing either way (swapped=%s)', swapped => {
    const sim = new FightSim({ p1: sample(luffyDef), p2: sample(akainuDef, true), introFrames: 0, roundTime: -1 });
    const controller = new AnimeSampleController();
    controller.mode = 'ability';
    sim.state.fighters[0].x = px(swapped ? 400 : -400);
    sim.state.fighters[1].x = px(swapped ? -400 : 400);
    sim.step({ p1: 0, p2: 0 });
    const forward = swapped ? Btn.Right : Btn.Left;
    const frames: number[] = [];
    for (let tick = 0; tick < 500 && sim.state.fighters[1].moveId !== 'sp_daifunka'; tick++) {
      const before = JSON.stringify(sim.state);
      const input = controller.input(sim, { p1: 0, p2: Btn.Up | Btn.C });
      expect(JSON.stringify(sim.state)).toBe(before);
      frames.push(input.p2);
      sim.step(input);
      expect(['dash', 'backdash', 'jump_neutral']).not.toContain(sim.state.fighters[1].state);
    }
    expect(frames).toContain(forward);
    expect(frames.slice(-3)).toEqual([Btn.Down, Btn.Down | forward, forward | Btn.A]);
    expect(sim.state.fighters[1].moveId).toBe('sp_daifunka');
  });

  it.each([
    ['akainu', akainuDef, 'sp_daifunka'],
    ['labubu', labubuDef, 'sp_pounce_rush'],
    ['twinkle', twinkleDef, 'sp_tiny_star'],
  ] as const)('%s代表技能用真实经典输入从双方位置均可出招', (_id, def, moveId) => {
    for (const dummyPlayer of [0, 1] as const) {
      const [dummy, target] = restrictedAbilityPair(def, luffyDef, moveId);
      const sim = new FightSim({
        p1: dummyPlayer === 0 ? dummy : target,
        p2: dummyPlayer === 1 ? dummy : target,
        introFrames: 0,
        roundTime: -1,
      });
      sim.training = { infiniteHp: true, infiniteMeter: true };
      const controller = new AnimeSampleController(dummyPlayer);
      expect(controller.availableModes(sim)).toContain('ability');
      controller.mode = 'ability';
      const trace: number[] = [];
      for (let tick = 0; tick < 600 && sim.state.fighters[dummyPlayer].moveId !== moveId; tick++) {
        const input = controller.input(sim, { p1: 0, p2: 0 });
        const bits = dummyPlayer === 0 ? input.p1 : input.p2;
        trace.push(bits);
        expect(bits & ~(Btn.Left | Btn.Right | Btn.Down | Btn.Up | Btn.A | Btn.B | Btn.C | Btn.D | Btn.Start)).toBe(0);
        sim.step(input);
      }
      expect(sim.state.fighters[dummyPlayer].moveId).toBe(moveId);
      const forward = dummyPlayer === 0 ? Btn.Right : Btn.Left;
      expect(trace.slice(-3)).toEqual([Btn.Down, Btn.Down | forward, forward | Btn.A]);
    }
  });

  it('素材过滤移除Skill1后不开放能力模式，也不会偷用原角色完整招式', () => {
    const incompleteArt = runtime(labubuDef, BASE, []);
    const targetArt = runtime(luffyDef, BASE, []);
    const incomplete = createSampleFighter(labubuDef, incompleteArt, { opponentRuntime: targetArt });
    expect(incomplete.moves.map(move => move.id)).toEqual(['st_a']);
    const sim = new FightSim({ p1: createSampleFighter(luffyDef, targetArt, { opponentRuntime: incompleteArt }), p2: incomplete, introFrames: 0, roundTime: -1 });
    const controller = new AnimeSampleController();
    expect(controller.availableModes(sim)).not.toContain('ability');
    controller.mode = 'ability';
    expect(controller.input(sim, { p1: 0, p2: 0 }).p2).toBe(0);
  });

  it.each(['mid', 'wall', 'tech'] as const)('waits for the complete real reaction before ordinary recovery (%s)', variant => {
    const { sim, controller } = abilityPractice(variant === 'wall');
    const command = [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.A];
    const states: StateId[] = [];
    let previousVx = 0, bounces = 0, reset = false;
    for (let tick = 0; tick < 200; tick++) {
      const p1 = variant === 'tech' && sim.state.fighters[0].state === 'hit_air' ? Btn.A : 0;
      advance(sim, controller, { p1, p2: command[tick] ?? 0 });
      const fighter = sim.state.fighters[0];
      if (states.at(-1) !== fighter.state) states.push(fighter.state);
      if (fighter.state === 'hit_air' && previousVx < 0 && fighter.vx > 0) bounces++;
      previousVx = fighter.vx;
      const reason = sampleResetReason(sim);
      if (reason) {
        expect(reason).toBe('neutral');
        expect(states).toEqual(variant === 'tech' ? ['idle', 'hit_air', 'getup', 'idle'] : ['idle', 'hit_air', 'knockdown', 'getup', 'idle']);
        const world = resetSampleRound(sim, controller);
        expect(world.fighters.map(f => [f.state, f.hp, f.burnFrames])).toEqual([
          ['idle', luffyDef.maxHp, 0], ['idle', akainuDef.maxHp, 0],
        ]);
        expect(world.cameraX).toBe(0);
        reset = true;
        break;
      }
    }
    expect(reset).toBe(true);
    expect(bounces).toBe(variant === 'wall' ? 1 : 0);
  });

  it('does not reset attacking, guarding, stunned, airborne or getup fighters', () => {
    const { sim } = abilityPractice();
    const fighter = sim.state.fighters[0];
    fighter.hp--;
    for (const state of ['attack', 'block_stand', 'block_crouch', 'hit_stand', 'hit_crouch', 'hit_air', 'knockdown', 'getup'] as const) {
      fighter.state = state;
      expect(sampleResetReason(sim)).toBeNull();
    }
    fighter.state = 'idle';
    fighter.hitstop = 1;
    expect(sampleResetReason(sim)).toBeNull();
    fighter.hitstop = 0;
    fighter.airborne = true;
    expect(sampleResetReason(sim)).toBeNull();
    fighter.airborne = false;
    expect(sampleResetReason(sim)).toBe('neutral');
  });

  it('keeps recovery pending while a real projectile is still alive', () => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
    sim.state.fighters[0].x = px(-470);
    sim.state.fighters[1].x = px(470);
    for (const p2 of [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.C]) sim.step({ p1: 0, p2 });
    for (let tick = 0; tick < 55 && sim.state.fighters[1].state !== 'idle'; tick++) sim.step({ p1: 0, p2: 0 });
    expect(sim.state.projectiles.length).toBeGreaterThan(0);
    sim.state.fighters[0].hp--;
    expect(sampleResetReason(sim)).toBeNull();
  });

  it.each([false, true])('reproduces repeated-launch KO and excludes it from recovered sample snapshots (recover=%s)', recover => {
    const { sim, controller } = abilityPractice(true);
    let queue: number[] = [], hits = 0, resets = 0;
    for (let tick = 0; tick < 20000 && sim.state.phase === 'fight' && hits < 12; tick++) {
      const [target, attacker] = sim.state.fighters;
      let p2 = 0;
      if (queue.length) p2 = queue.shift()!;
      else if (['idle', 'walk_fwd', 'walk_back', 'crouch'].includes(attacker.state)) {
        const forward = attacker.facing === 1 ? Btn.Right : Btn.Left;
        if (Math.abs(attacker.x - target.x) > px(135)) p2 = forward;
        else if (['idle', 'walk_fwd', 'walk_back', 'crouch'].includes(target.state)) {
          queue = [Btn.Down, Btn.Down | forward, forward | Btn.A, 0];
          p2 = queue.shift()!;
        }
      }
      advance(sim, controller, { p1: 0, p2 });
      hits += sim.hits.filter(hit => hit.kind === 'hit' && hit.moveId === 'sp_daifunka').length;
      let visible = sim.state;
      if (recover && sampleResetReason(sim)) { visible = resetSampleRound(sim, controller); resets++; queue = []; }
      if (recover) {
        expect(visible.phase).toBe('fight');
        expect(visible.roundOver).toBe(false);
        expect(visible.fighters.every(fighter => fighter.state !== 'ko' && fighter.hp > 0)).toBe(true);
      }
    }
    if (recover) { expect(hits).toBe(12); expect(resets).toBeGreaterThanOrEqual(11); }
    else { expect(hits).toBe(8); expect(sim.state.phase).toBe('round_end'); expect(sampleResetReason(sim)).toBe('ended'); }
  });

  it('the ability dummy repeats after automatic recovery without jab or uncovered actions', () => {
    const { sim, controller } = abilityPractice();
    controller.mode = 'ability';
    let hits = 0, resets = 0;
    const moves = new Set<string>();
    for (let tick = 0; tick < 4000 && resets < 12; tick++) {
      advance(sim, controller, { p1: 0, p2: 0 });
      const move = sim.state.fighters[1].moveId;
      if (move) moves.add(move);
      hits += sim.hits.filter(hit => hit.kind === 'hit' && hit.moveId === 'sp_daifunka').length;
      if (sampleResetReason(sim)) { resetSampleRound(sim, controller); resets++; }
      expect(sim.state.phase).toBe('fight');
    }
    expect(hits).toBe(12);
    expect(resets).toBe(12);
    expect([...moves]).toEqual(['sp_daifunka']);
  });

  it('restores a lethal round before presentation, clears command state and renders the reset camera', () => {
    const { sim, controller } = abilityPractice(true);
    const command = [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.A];
    for (const p2 of command) advance(sim, controller, { p1: 0, p2 });
    // Set the low-health fixture after startup, so training's calm-state heal cannot erase it.
    sim.state.fighters[0].hp = 1;
    for (let tick = 0; tick < 80 && !sim.state.roundOver; tick++) advance(sim, controller, { p1: 0, p2: 0 });
    expect(sim.state.phase).toBe('round_end');
    expect(sampleResetReason(sim)).toBe('ended');
    expect(sim.state.cameraX).not.toBe(0);
    const world = resetSampleRound(sim, controller);
    expect(world.phase).toBe('fight');
    expect(world.roundWinner).toBeNull();
    expect(world.wins).toEqual([0, 0]);
    expect(world.cameraX).toBe(0);
    expect(sim.hits).toEqual([]);
    expect(world.fighters.map(f => [f.x, f.hp, f.burnFrames, f.vx, f.vy, f.buffered, f.history.length]))
      .toEqual([[px(-90), luffyDef.maxHp, 0, 0, 0, null, 0], [px(90), akainuDef.maxHp, 0, 0, 0, null, 0]]);
    controller.mode = 'ability';
    for (let tick = 0; tick < 30; tick++) expect(controller.input(sim, { p1: 0, p2: 0 }).p2).toBe(0);
    expect(controller.input(sim, { p1: 0, p2: 0 }).p2).toBe(Btn.Down);
    resetSampleRound(sim, controller);
    expect(controller.mode).toBe('ability');
    expect(controller.input(sim, { p1: 0, p2: 0 }).p2).toBe(0);
  });
});
