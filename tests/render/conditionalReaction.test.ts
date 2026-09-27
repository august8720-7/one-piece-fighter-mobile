import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { Btn, FightSim, SKILL_BUTTONS, px, totalFrames, type FighterDef, type PlayerIndex } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import { connectedHeldReaction, currentAnimation, HELD_LABUBU_THROW, HELD_LEG_FLIP, HELD_TWINKLE_THROW, heldReactionFrameIssues, isHeldReactionAnim, validateAnimeRuntimeManifest, type AnimeRuntimeManifest, type HeldReactionId } from '../../src/render/animations';
import { createSampleFighter, sampleMoveIssues, validateFullCoverage, validateSampleCoverage } from '../../src/render/anime/sampleMode';
import { FighterView } from '../../src/render/FighterView';

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } } } }));

const neutral = { p1: 0, p2: 0 };
const victimDefs = [luffyDef, akainuDef, labubuDef, twinkleDef] as const;
const legFlip = labubuDef.moves.find(move => move.id === 'sp_leg_flip')!;

function startingGrab(victimDef: FighterDef, actor: PlayerIndex = 0, facing: 1 | -1 = 1): FightSim {
  const sim = new FightSim({ p1: actor === 0 ? labubuDef : victimDef, p2: actor === 0 ? victimDef : labubuDef,
    introFrames: 0, roundTime: -1, controlModes: ['simple', 'simple'] });
  const attacker = sim.state.fighters[actor], victim = sim.state.fighters[actor === 0 ? 1 : 0];
  attacker.x = px(-30) * facing;
  victim.x = attacker.x + px(38) * facing;
  attacker.facing = facing; victim.facing = facing === 1 ? -1 : 1;
  sim.step(actor === 0 ? { p1: SKILL_BUTTONS[4]!, p2: 0 } : { p1: 0, p2: SKILL_BUTTONS[4]! });
  expect(attacker.moveId).toBe('sp_leg_flip');
  return sim;
}

function connectedGrab(victimDef: FighterDef = luffyDef, actor: PlayerIndex = 0, facing: 1 | -1 = 1): FightSim {
  const sim = startingGrab(victimDef, actor, facing);
  for (let ticks = 0; ticks < 40 && sim.state.fighters[actor].state !== 'throw'; ticks++) sim.step(neutral);
  expect(sim.state.fighters[actor].state).toBe('throw');
  expect(sim.state.fighters[actor === 0 ? 1 : 0].state).toBe('thrown');
  return sim;
}

/** Synthetic metadata only. These tests make no claim about real artwork or pixels. */
function runtime(def: FighterDef, held = false, ordinaryReactions: readonly HeldReactionId[] = []): AnimeRuntimeManifest {
  const art: AnimeRuntimeManifest = { schemaVersion: 1, characterId: def.id, style: 'anime', continuous: true,
    atlas: { image: 'atlas.png', data: 'atlas.json' }, anims: {}, attachments: {} };
  for (const name of ['idle', 'walk_fwd', 'walk_back', 'crouch', 'block_stand', 'block_crouch', 'hit_stand', 'hit_crouch',
    'thrown', 'throw_tech', 'hit_air', 'knockdown', 'getup', ...def.moves.map(move => move.id), ...(held ? [HELD_LEG_FLIP] : []), ...ordinaryReactions]) {
    const move = def.moves.find(candidate => candidate.id === name);
    art.anims[name] = { frames: 1, fps: 60, loop: !move && !isHeldReactionAnim(name), pixelArt: false,
      exposures: [{ frame: 0, ticks: move ? totalFrames(move) : name === HELD_LABUBU_THROW ? 22 : name === HELD_TWINKLE_THROW ? 23 : 24 }],
      ...(move?.throwData ? { throwExposures: [{ frame: 0, ticks: move.throwData.duration ?? totalFrames(move) }] } : {}) };
    art.attachments[`${def.id}/${name}/0`] = { size: { width: 80, height: 160 }, root: { x: 40, y: 160 },
      sockets: isHeldReactionAnim(name) ? { grip: { x: 68, y: 134 } } : {} };
  }
  return art;
}

describe('connected conditional reaction from actual FightSim state', () => {
  for (const def of victimDefs) for (const actor of [0, 1] as const) for (const facing of [1, -1] as const) {
    it(`${def.id} held by P${actor + 1}, facing ${facing}: starts on connection and ends on the real release`, () => {
      const sim = startingGrab(def, actor, facing), attacker = sim.state.fighters[actor], victim = sim.state.fighters[actor === 0 ? 1 : 0];
      expect(connectedHeldReaction(sim, victim)).toBeNull();
      while (attacker.state === 'attack') {
        expect(connectedHeldReaction(sim, victim)).toBeNull();
        sim.step(neutral);
      }
      expect(attacker.state).toBe('throw');
      const heldFrames: number[] = [];
      for (let steps = 0; steps < 30 && victim.state === 'thrown'; steps++) {
        heldFrames.push(attacker.stateFrame);
        const before = JSON.stringify(sim.state);
        expect(connectedHeldReaction(sim, victim)).toEqual({ anim: HELD_LEG_FLIP, index: 0 });
        expect(connectedHeldReaction(sim, attacker)).toBeNull();
        expect(JSON.stringify(sim.state)).toBe(before);
        expect(victim.x - attacker.x).toBe(px(30) * facing);
        expect(victim.facing).toBe(-facing);
        expect(sim.hurtboxes(victim)).toEqual([]);
        sim.step(neutral);
      }
      expect(heldFrames).toEqual(Array.from({ length: 24 }, (_, frame) => frame));
      expect(attacker.stateFrame).toBe(24);
      expect(attacker.hasHit).toBe(true);
      expect(victim.state).toBe('hit_air');
      expect(connectedHeldReaction(sim, victim)).toBeNull();
      expect(sim.hurtboxes(victim).length).toBeGreaterThan(0);
      while (attacker.state === 'throw') sim.step(neutral);
      expect(connectedHeldReaction(sim, victim)).toBeNull();
    });
  }

  it('does not mistake a copied fighter, an unrelated identity, an old-caster throw or an inconsistent hold for a connection', () => {
    const sim = connectedGrab(), [attacker, victim] = sim.state.fighters;
    expect(connectedHeldReaction(sim, { ...victim })).toBeNull();
    attacker.state = 'attack';
    expect(connectedHeldReaction(sim, victim)).toBeNull();
    attacker.state = 'throw'; attacker.moveId = 'throw_fwd'; attacker.def = luffyDef;
    expect(connectedHeldReaction(sim, victim)).toBeNull();
    attacker.moveId = 'sp_leg_flip'; attacker.def = { ...labubuDef, id: 'luffy' };
    expect(connectedHeldReaction(sim, victim)).toBeNull();
    attacker.def = labubuDef; attacker.hasHit = true;
    expect(connectedHeldReaction(sim, victim)).toBeNull();
    attacker.hasHit = false; attacker.stateFrame = 24;
    expect(connectedHeldReaction(sim, victim)).toBeNull();
    attacker.stateFrame = 8; victim.airborne = true;
    expect(connectedHeldReaction(sim, victim)).toBeNull();
    victim.airborne = false; victim.state = 'idle';
    expect(connectedHeldReaction(sim, victim)).toBeNull();
  });
});

describe('conditional reaction resource and sample gates', () => {
  it.each(victimDefs)('keeps the LABUBU move closed against $id until its own dedicated reaction is declared', def => {
    const attacker = runtime(labubuDef), victim = runtime(def, false, [HELD_LABUBU_THROW]);
    expect(sampleMoveIssues(legFlip, attacker, victim).join(' ')).toContain(`${def.id}/held_leg_flip/0`);
    const restricted = createSampleFighter(labubuDef, attacker, { opponentRuntime: victim });
    expect(restricted.moves).not.toContain(legFlip);
    expect(restricted.moves).toContain(labubuDef.moves.find(move => move.id === 'throw_fwd'));
    expect(validateSampleCoverage(def, victim, labubuDef).missingStates).toContain(HELD_LEG_FLIP);
    expect(validateFullCoverage(def, victim, labubuDef).missingStates).toContain(HELD_LEG_FLIP);
    const supported = runtime(def, true, [HELD_LABUBU_THROW]);
    expect(sampleMoveIssues(legFlip, attacker, supported)).toEqual([]);
    expect(createSampleFighter(labubuDef, attacker, { opponentRuntime: supported }).moves).toContain(legFlip);
    expect(validateAnimeRuntimeManifest(supported, def.moves)).toEqual([]);
    expect(validateFullCoverage(def, victim, luffyDef).requiredStates).not.toContain(HELD_LEG_FLIP);
  });

  it('rejects missing geometry, named grip metadata and a grip outside the source frame', () => {
    const art = runtime(twinkleDef, true), key = 'twinkle/held_leg_flip/0', saved = art.attachments[key]!;
    delete art.attachments[key];
    expect(sampleMoveIssues(legFlip, runtime(labubuDef), art).join(' ')).toContain('attachment geometry');
    art.attachments[key] = { ...saved, sockets: {} };
    expect(validateAnimeRuntimeManifest(art).join(' ')).toContain('grip socket');
    art.attachments[key]!.sockets.grip = { x: 80, y: 40 };
    expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments).join(' ')).toContain('grip socket');
    art.attachments[key] = saved; art.anims[HELD_LEG_FLIP]!.loop = true;
    expect(validateAnimeRuntimeManifest(art).join(' ')).toContain('one non-looping pose');
  });

  it('does not require the pose for another character with the same move id or a LABUBU without that ability', () => {
    const namedElsewhere = { ...luffyDef, moves: [legFlip] };
    expect(sampleMoveIssues(legFlip, runtime(namedElsewhere), runtime(twinkleDef))).toEqual([]);
    expect(validateFullCoverage(twinkleDef, runtime(twinkleDef), namedElsewhere).requiredStates).not.toContain(HELD_LEG_FLIP);
    const noLegFlip = { ...labubuDef, moves: labubuDef.moves.filter(move => move.id !== 'sp_leg_flip') };
    expect(validateFullCoverage(twinkleDef, runtime(twinkleDef), noLegFlip).requiredStates).not.toContain(HELD_LEG_FLIP);
  });
});

class SpriteRecord {
  x = 0; y = 0; scaleX = 1; scaleY = 1; flipX = false; visible = false; originX = 0; originY = 1; name = '';
  frame = { customPivot: false, pivotX: 0.5, pivotY: 1 };
  available = new Set<string>();
  texture = { customData: { meta: { style: 'anime', capabilities: { continuous: true } } },
    has: (name: string) => this.available.has(name), setFilter: () => undefined };
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setDepth() { return this; }
  setVisible(value: boolean) { this.visible = value; return this; }
  setFrame(name: string) { this.name = name; return this; }
  setTexture() { return this; }
  setScale(value: number) { this.scaleX = value; this.scaleY = value; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setFlipX(value: boolean) { this.flipX = value; return this; }
  setAlpha() { return this; }
  clearTint() { return this; }
  setTint() { return this; }
}

describe('FighterView conditional frame selection only', () => {
  it.each([1, -1] as const)('keeps position, facing and scale unchanged and releases immediately (%s)', facing => {
    const sim = connectedGrab(twinkleDef, 0, facing), victim = sim.state.fighters[1], art = runtime(twinkleDef, true);
    const sprite = new SpriteRecord(); sprite.available = new Set(Object.keys(art.attachments));
    const view = new FighterView({ add: { sprite: () => sprite } } as unknown as Phaser.Scene, 'candidate', 'twinkle', art.anims, art);
    const before = JSON.stringify(sim.state);
    expect(view.update(sim, victim, 130, 240, null, 1, undefined, 2)).toBe(true);
    expect(sprite.name).toBe('twinkle/held_leg_flip/0');
    expect([sprite.x, sprite.y, sprite.scaleX, sprite.scaleY, sprite.flipX]).toEqual([130, 240, 2, 2, facing === 1]);
    expect(JSON.stringify(sim.state)).toBe(before);
    while (victim.state === 'thrown') sim.step(neutral);
    expect(view.update(sim, victim, 143, 221, null, 1, undefined, 2)).toBe(true);
    expect(sprite.name).toBe('twinkle/hit_air/0');
    expect([sprite.x, sprite.y, sprite.scaleX, sprite.scaleY, sprite.flipX]).toEqual([143, 221, 2, 2, facing === 1]);
    expect(view.socket('grip')).toBeNull();
  });

  it.each(['animation', 'geometry', 'texture'] as const)('fails an active anime hold when %s is missing; never uses ordinary thrown', missing => {
    const sim = connectedGrab(), victim = sim.state.fighters[1], art = runtime(luffyDef, true), key = 'luffy/held_leg_flip/0';
    const sprite = new SpriteRecord(); sprite.available = new Set(Object.keys(art.attachments));
    if (missing === 'animation') delete art.anims[HELD_LEG_FLIP];
    if (missing === 'geometry') delete art.attachments[key];
    if (missing === 'texture') sprite.available.delete(key);
    const view = new FighterView({ add: { sprite: () => sprite } } as unknown as Phaser.Scene, 'candidate', 'luffy', art.anims, art);
    expect(view.update(sim, victim, 130, 240, null, 1)).toBe(false);
    expect(view.missingFrames).toContain(key);
    expect(sprite.visible).toBe(false);
    expect(sprite.name).not.toBe('luffy/thrown/0');
  });

  it('leaves pixel/placeholder views and old-caster ordinary anime throws on their original reaction', () => {
    const sim = connectedGrab(), victim = sim.state.fighters[1], art = runtime(luffyDef);
    const sprite = new SpriteRecord(); sprite.available = new Set(Object.keys(art.attachments));
    sprite.texture.customData.meta.style = 'pixel';
    const scene = { add: { sprite: () => sprite } } as unknown as Phaser.Scene;
    const pixel = new FighterView(scene, 'luffy-placeholder', 'luffy', art.anims);
    expect(pixel.update(sim, victim, 130, 240, null, 1)).toBe(true);
    expect(sprite.name).toBe('luffy/thrown/0');
    sim.state.fighters[0].moveId = 'throw_fwd'; sim.state.fighters[0].def = luffyDef;
    const anime = new FighterView(scene, 'candidate', 'luffy', art.anims, art);
    expect(anime.update(sim, victim, 130, 240, null, 1)).toBe(true);
    expect(sprite.name).toBe('luffy/thrown/0');
    expect(currentAnimation(sim, victim, art.anims)).toEqual({ anim: 'thrown', index: 0 });
  });
});

const ORDINARY_CASTERS = [
  { def: labubuDef, reaction: HELD_LABUBU_THROW, release: 22, duration: 44, gap: 31, damage: 116 },
  { def: twinkleDef, reaction: HELD_TWINKLE_THROW, release: 23, duration: 46, gap: 32, damage: 108 },
] as const;
type OrdinaryMove = 'throw_fwd' | 'throw_back';

function ordinaryGrab(def: FighterDef, move: OrdinaryMove, actor: PlayerIndex, facing: 1 | -1) {
  const sim = new FightSim({ p1: actor === 0 ? def : twinkleDef, p2: actor === 0 ? twinkleDef : def,
    introFrames: 0, roundTime: -1, controlModes: ['simple', 'simple'] });
  const victimPlayer: PlayerIndex = actor === 0 ? 1 : 0;
  const attacker = sim.state.fighters[actor], victim = sim.state.fighters[victimPlayer];
  attacker.x = px(-20) * facing; victim.x = attacker.x + px(40) * facing;
  attacker.facing = facing; victim.facing = facing === 1 ? -1 : 1;
  const direction = (move === 'throw_fwd' ? facing : -facing) === 1 ? Btn.Right : Btn.Left;
  const bits = direction | Btn.C;
  sim.step(actor === 0 ? { p1: bits, p2: 0 } : { p1: 0, p2: bits });
  expect(attacker.state).toBe('throw'); expect(attacker.moveId).toBe(move); expect(victim.state).toBe('thrown');
  return { sim, attacker, victim, victimPlayer };
}

describe('new-caster ordinary throws select a real conditional reaction', () => {
  for (const caster of ORDINARY_CASTERS) for (const move of ['throw_fwd', 'throw_back'] as const) {
    for (const actor of [0, 1] as const) for (const facing of [1, -1] as const) {
      it(`${caster.def.id} ${move}, P${actor + 1}, facing ${facing}: held through release-1 and restored on release`, () => {
        const { sim, attacker, victim } = ordinaryGrab(caster.def, move, actor, facing);
        const frames: number[] = [];
        for (let tick = 0; tick < caster.release; tick++) {
          frames.push(attacker.stateFrame);
          const before = JSON.stringify(sim.state);
          expect(connectedHeldReaction(sim, victim)).toEqual({ anim: caster.reaction, index: 0 });
          expect(connectedHeldReaction(sim, attacker)).toBeNull();
          expect(JSON.stringify(sim.state)).toBe(before);
          expect(victim.x - attacker.x).toBe(px(caster.gap) * facing);
          expect(victim.facing).toBe(-facing);
          sim.step(neutral);
        }
        expect(frames).toEqual(Array.from({ length: caster.release }, (_, i) => i));
        expect(attacker.stateFrame).toBe(caster.release);
        expect(attacker.hasHit).toBe(true); expect(victim.state).toBe('hit_air');
        expect(connectedHeldReaction(sim, victim)).toBeNull();
        expect(victim.hp).toBe(twinkleDef.maxHp - caster.damage);
        expect(Math.sign(victim.x - attacker.x)).toBe(move === 'throw_back' ? -facing : facing);
        expect(attacker.facing).toBe(move === 'throw_back' ? -facing : facing);
        for (let tick = caster.release; tick < caster.duration; tick++) sim.step(neutral);
        expect(attacker.state).toBe('idle'); expect(attacker.stateFrame).toBe(0);
        expect(connectedHeldReaction(sim, victim)).toBeNull();
      });

      it(`${caster.def.id} ${move}, P${actor + 1}, facing ${facing}: last legal tech clears the pose immediately`, () => {
        const { sim, attacker, victim, victimPlayer } = ordinaryGrab(caster.def, move, actor, facing);
        for (let tick = 1; tick < 8; tick++) sim.step(neutral);
        expect(connectedHeldReaction(sim, victim)?.anim).toBe(caster.reaction);
        sim.step(victimPlayer === 0 ? { p1: Btn.C, p2: 0 } : { p1: 0, p2: Btn.C });
        expect(attacker.state).toBe('throw_tech'); expect(victim.state).toBe('throw_tech');
        expect(connectedHeldReaction(sim, victim)).toBeNull();
        expect(currentAnimation(sim, victim, runtime(twinkleDef).anims)).toEqual({ anim: 'throw_tech', index: 0 });
        for (let tick = 0; tick < caster.duration; tick++) sim.step(neutral);
        expect(victim.hp).toBe(twinkleDef.maxHp);
        expect(connectedHeldReaction(sim, victim)).toBeNull();
      });
    }
  }

  it.each(ORDINARY_CASTERS)('$def.id does not turn a late tech into a premature release', caster => {
    const { sim, victim } = ordinaryGrab(caster.def, 'throw_fwd', 0, 1);
    for (let tick = 1; tick < 9; tick++) sim.step(neutral);
    sim.step({ p1: 0, p2: Btn.C });
    expect(victim.state).toBe('thrown');
    expect(connectedHeldReaction(sim, victim)?.anim).toBe(caster.reaction);
  });

  for (const caster of [luffyDef, akainuDef]) for (const move of ['throw_fwd', 'throw_back'] as const) {
    for (const actor of [0, 1] as const) for (const facing of [1, -1] as const) {
      it(`old ${caster.id} ${move}, P${actor + 1}, facing ${facing} retains ordinary thrown`, () => {
        const { sim, attacker, victim } = ordinaryGrab(caster, move, actor, facing);
        const release = sim.move(attacker)!.throwData!.releaseFrame;
        for (let tick = 0; tick < release; tick++) {
          expect(connectedHeldReaction(sim, victim)).toBeNull();
          expect(currentAnimation(sim, victim, runtime(twinkleDef).anims).anim).toBe('thrown');
          sim.step(neutral);
        }
        expect(victim.state).toBe('hit_air'); expect(connectedHeldReaction(sim, victim)).toBeNull();
      });
    }
  }
});

describe('ordinary conditional resource registration', () => {
  it.each(ORDINARY_CASTERS)('$def.id needs its own reaction for both ordinary moves, not another caster reaction', caster => {
    const own = runtime(caster.def), other = runtime(twinkleDef, true, [caster.reaction === HELD_LABUBU_THROW ? HELD_TWINKLE_THROW : HELD_LABUBU_THROW]);
    for (const id of ['throw_fwd', 'throw_back']) {
      const move = caster.def.moves.find(candidate => candidate.id === id)!;
      expect(sampleMoveIssues(move, own, other).join(' ')).toContain(`twinkle/${caster.reaction}/0`);
      expect(createSampleFighter(caster.def, own, { opponentRuntime: other }).moves).not.toContain(move);
      const supported = runtime(twinkleDef, true, [HELD_LABUBU_THROW, HELD_TWINKLE_THROW]);
      expect(sampleMoveIssues(move, own, supported)).toEqual([]);
      expect(createSampleFighter(caster.def, own, { opponentRuntime: supported }).moves).toContain(move);
      expect(validateFullCoverage(twinkleDef, other, caster.def).missingStates).toContain(caster.reaction);
    }
  });

  for (const reaction of [HELD_LABUBU_THROW, HELD_TWINKLE_THROW] as const) {
    it(`${reaction}: validates explicit exposure, root/size and a real grip while permitting an airborne virtual root`, () => {
      const art = runtime(twinkleDef, false, [reaction]), key = `twinkle/${reaction}/0`;
      art.attachments[key]!.root.y = 220;
      expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments, reaction)).toEqual([]);
      expect(validateAnimeRuntimeManifest(art, twinkleDef.moves)).toEqual([]);
      delete art.anims[reaction]!.exposures;
      expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments, reaction).join(' ')).toContain('valid exposure');
      art.anims[reaction]!.exposures = [{ frame: 1, ticks: 22 }];
      expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments, reaction).join(' ')).toContain('valid exposure');
      art.anims[reaction]!.exposures = [{ frame: 0, ticks: 22 }];
      art.attachments[key]!.root.x = Number.NaN;
      expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments, reaction).join(' ')).toContain('attachment geometry');
      art.attachments[key]!.root.x = 40; art.attachments[key]!.size.width = 0;
      expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments, reaction).join(' ')).toContain('attachment geometry');
      art.attachments[key]!.size.width = 80; delete art.attachments[key]!.sockets.grip;
      expect(heldReactionFrameIssues('twinkle', art.anims, art.attachments, reaction).join(' ')).toContain('grip socket');
    });
  }

  it.each(ORDINARY_CASTERS)('$def.id fails a missing texture, then restores the unshifted original pose after tech', caster => {
    const { sim, victim } = ordinaryGrab(caster.def, 'throw_back', 0, -1);
    const art = runtime(twinkleDef, false, [caster.reaction]), key = `twinkle/${caster.reaction}/0`;
    const sprite = new SpriteRecord(); sprite.available = new Set(Object.keys(art.attachments));
    const view = new FighterView({ add: { sprite: () => sprite } } as unknown as Phaser.Scene, 'candidate', 'twinkle', art.anims, art);
    expect(view.update(sim, victim, 100, 240, null, 1, undefined, 2)).toBe(true);
    expect(sprite.name).toBe(key);
    expect([sprite.x, sprite.y, sprite.scaleX, sprite.scaleY, sprite.flipX]).toEqual([100, 240, 2, 2, false]);
    sprite.available.delete(key);
    expect(view.update(sim, victim, 100, 240, null, 1, undefined, 2)).toBe(false);
    expect(view.missingFrames).toContain(key); expect(sprite.visible).toBe(false);
    sim.step({ p1: 0, p2: Btn.C });
    expect(view.update(sim, victim, 90, 240, null, 1, undefined, 2)).toBe(true);
    expect(sprite.name).toBe('twinkle/throw_tech/0');
    expect([sprite.x, sprite.y, sprite.scaleX, sprite.scaleY, sprite.flipX]).toEqual([90, 240, 2, 2, false]);
    expect(view.socket('grip')).toBeNull();
  });
});
