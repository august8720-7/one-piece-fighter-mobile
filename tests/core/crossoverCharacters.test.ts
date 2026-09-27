import { describe, expect, it } from 'vitest';
import { ANY_ATTACK, Btn, FightSim, SKILL_BUTTONS, px, type BoxPx, type FighterDef } from '../../src/core';
import { Cpu } from '../../src/ai/cpu';
import { characterAi, characterAnims, characters, labubuDef, luffyDef, akainuDef, twinkleDef } from '../../src/characters';
import { LABUBU_MISCHIEF_DRIVE } from '../../src/characters/labubu/moves';
import { TWINKLE_PROJECTILE_KINDS } from '../../src/characters/twinkle/moves';

const NEW_FIGHTERS = [labubuDef, twinkleDef] as const;
const NORMAL_IDS = [
  'st_a', 'st_b', 'st_c', 'st_d',
  'cr_a', 'cr_b', 'cr_c', 'cr_d',
  'j_a', 'j_b', 'j_c', 'j_d',
  'cd', 'j_cd', 'throw_fwd', 'throw_back',
] as const;

const finiteBox = (box: BoxPx) => box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;

describe('crossover character definitions', () => {
  it('registers the four fighters in stable selection order with independent AI and animation entries', () => {
    expect(Object.keys(characters)).toEqual(['luffy', 'akainu', 'labubu', 'twinkle']);
    expect(Object.keys(characterAi)).toEqual(['luffy', 'akainu', 'labubu', 'twinkle']);
    expect(Object.keys(characterAnims)).toEqual(['luffy', 'akainu', 'labubu', 'twinkle']);
    expect(characters.labubu).toBe(labubuDef);
    expect(characters.twinkle).toBe(twinkleDef);
  });

  it.each(NEW_FIGHTERS)('$id has complete normals, two throws, blowback and nine unique legal skill slots', (def) => {
    const ids = def.moves.map((move) => move.id);
    for (const id of NORMAL_IDS) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(def.skillSlots).toHaveLength(9);
    expect(new Set(def.skillSlots).size).toBe(9);
    for (const id of def.skillSlots!) {
      const move = def.moves.find((entry) => entry.id === id);
      expect(move, id).toBeDefined();
      expect(move!.input.motion, id).toBeDefined();
      expect(move!.input.stance, id).toBe('stand');
    }
  });

  it.each(NEW_FIGHTERS)('$id frame, collision and projectile data is finite and grounded attacks do not claim vertical movement', (def) => {
    for (const box of [def.pushboxStand, def.pushboxCrouch, def.pushboxAir, ...def.hurtboxStand, ...def.hurtboxCrouch, ...def.hurtboxAir]) {
      expect(finiteBox(box)).toBe(true);
    }
    for (const move of def.moves) {
      expect(move.frames.length, move.id).toBeGreaterThan(0);
      for (const frame of move.frames) {
        expect(Number.isInteger(frame.duration) && frame.duration > 0, move.id).toBe(true);
        expect(frame.velocity?.y, `${move.id} must remain grounded`).toBeUndefined();
        for (const box of [...(frame.hurtboxes ?? []), ...(frame.hitboxes ?? [])]) expect(finiteBox(box), move.id).toBe(true);
      }
      for (const projectile of move.projectiles ?? []) {
        expect(Number.isInteger(projectile.frame) && projectile.frame >= 0, move.id).toBe(true);
        expect(projectile.frame, move.id).toBeLessThan(move.frames.reduce((sum, frame) => sum + frame.duration, 0));
        expect([projectile.x, projectile.y, projectile.vx, projectile.vy, projectile.ttl].every(Number.isFinite), move.id).toBe(true);
        expect(finiteBox(projectile.box), move.id).toBe(true);
      }
    }
  });

  it('keeps toy proportions readable without shrinking hit height below the old roster baseline', () => {
    expect(labubuDef.pushboxStand).toEqual([-16, -78, 32, 78]);
    expect(twinkleDef.pushboxStand).toEqual([-18, -84, 36, 84]);
    expect(labubuDef.hurtboxStand[0]![2]).toBeGreaterThan(luffyDef.hurtboxStand[0]![2]);
    expect(twinkleDef.hurtboxStand[0]![2]).toBeGreaterThan(akainuDef.hurtboxStand[0]![2]);
  });

  it('uses only the approved install and projectile identities', () => {
    expect(LABUBU_MISCHIEF_DRIVE.id).toBe('labubu_mischief_drive');
    expect(labubuDef.moves.filter((move) => move.install).map((move) => move.install!.id)).toEqual(['labubu_mischief_drive']);
    const kinds = new Set(twinkleDef.moves.flatMap((move) => move.projectiles?.map((projectile) => projectile.kind) ?? []));
    expect([...kinds]).toEqual([...TWINKLE_PROJECTILE_KINDS]);
  });

  it('does not alter the frozen old fighter definitions while registering the new roster', () => {
    expect(luffyDef.maxHp).toBe(1050);
    expect(akainuDef.maxHp).toBe(1050);
    expect(luffyDef.skillSlots).toEqual(['sp_gatling', 'sp_bazooka', 'sp_rifle', 'sp_rocket', 'sp_balloon', 'sp_gear2', 'sp_storm', 'sp_gigant_pistol', 'ult_red_hawk']);
    expect(akainuDef.skillSlots).toEqual(['sp_daifunka', 'sp_inugami', 'sp_meigou', 'sp_meteor', 'sp_ground_split', 'sp_magma_body', 'sp_daifunka_ren', 'sp_meteor_rain', 'ult_meigou_end']);
    expect(luffyDef.pushboxStand).toEqual([-14, -88, 28, 88]);
    expect(akainuDef.pushboxStand).toEqual([-17, -100, 34, 100]);
  });
});

function ready(def: FighterDef, facing: 1 | -1, mode: 'classic' | 'simple' = 'simple'): FightSim {
  const other = def === labubuDef ? twinkleDef : labubuDef;
  const sim = new FightSim({ p1: def, p2: other, controlModes: [mode, 'classic'], introFrames: 0, roundTime: -1 });
  const [me, opponent] = sim.state.fighters;
  me.x = px(-170) * facing;
  opponent.x = px(170) * facing;
  me.facing = facing;
  opponent.facing = facing === 1 ? -1 : 1;
  me.meter = 300;
  return sim;
}

function classicInput(motion: string, button: number, facing: 1 | -1): number[] {
  const forward = facing === 1 ? Btn.Right : Btn.Left;
  const back = facing === 1 ? Btn.Left : Btn.Right;
  const down = Btn.Down;
  const press = button & -button;
  switch (motion) {
    case '236': return [down, down | forward, forward | press];
    case '214': return [down, down | back, back | press];
    case '623': return [forward, 0, down, down | forward, down | forward | press];
    case '22': return [down, 0, down | press];
    case '236236': return [down, down | forward, forward, 0, down, down | forward, forward | press];
    case '214214': return [down, down | back, back, 0, down, down | back, back | press];
    default: throw new Error(`unsupported motion ${motion}`);
  }
}

describe('all eighteen crossover shortcuts execute through FightSim', () => {
  for (const def of NEW_FIGHTERS) {
    for (const [slot, id] of def.skillSlots!.entries()) {
      it(`${def.id}/${id} executes on both facings with its exact meter cost`, () => {
        const move = def.moves.find((entry) => entry.id === id)!;
        for (const facing of [1, -1] as const) {
          const sim = ready(def, facing);
          sim.step({ p1: SKILL_BUTTONS[slot]!, p2: 0 });
          expect(sim.state.fighters[0].moveId).toBe(id);
          expect(sim.state.fighters[0].meter).toBe(300 - (move.meterCost ?? 0));
          expect(sim.skillFeedback[0]).toMatchObject({ slot, reason: 'ready' });

          const classic = ready(def, facing, 'classic');
          for (const p1 of classicInput(move.input.motion!, move.input.button, facing)) classic.step({ p1, p2: 0 });
          expect(classic.state.fighters[0].moveId).toBe(id);
          expect(classic.state.fighters[0].meter).toBe(300 - (move.meterCost ?? 0));
        }
      });
    }
  }

  it('spawns every declared Twinkle projectile kind from real skill inputs', () => {
    const seen = new Set<string>();
    for (const [slot, id] of twinkleDef.skillSlots!.entries()) {
      const move = twinkleDef.moves.find((entry) => entry.id === id)!;
      if (!move.projectiles?.length) continue;
      const sim = ready(twinkleDef, 1);
      sim.step({ p1: SKILL_BUTTONS[slot]!, p2: 0 });
      for (let frame = 0; frame < 90; frame++) {
        for (const projectile of sim.state.projectiles) seen.add(projectile.kind);
        sim.step({ p1: 0, p2: 0 });
      }
    }
    expect([...seen]).toEqual([...TWINKLE_PROJECTILE_KINDS]);
  });

  it('executes LABUBU command throw, grounded anti-air and install mechanics', () => {
    const grab = new FightSim({ p1: labubuDef, p2: twinkleDef, controlModes: ['simple', 'classic'], introFrames: 0, roundTime: -1 });
    grab.state.fighters[0].x = px(-20); grab.state.fighters[1].x = px(20);
    grab.step({ p1: Btn.Skill5, p2: 0 });
    const events: string[] = [];
    for (let frame = 0; frame < 70; frame++) {
      grab.step({ p1: 0, p2: 0 });
      events.push(...grab.hits.map((event) => event.kind));
    }
    expect(events).toContain('throw');
    expect(grab.state.fighters[1].hp).toBeLessThan(twinkleDef.maxHp);

    const antiAir = new FightSim({ p1: labubuDef, p2: twinkleDef, controlModes: ['simple', 'classic'], introFrames: 0, roundTime: -1 });
    const [labubu, airborne] = antiAir.state.fighters;
    labubu.x = px(-20); airborne.x = px(20); airborne.y = px(-42); airborne.airborne = true; airborne.state = 'jump_neutral'; airborne.vy = 0;
    antiAir.step({ p1: Btn.Skill3, p2: 0 });
    const hits: string[] = [];
    for (let frame = 0; frame < 30; frame++) {
      antiAir.step({ p1: 0, p2: 0 });
      hits.push(...antiAir.hits.map((event) => event.moveId));
    }
    expect(hits).toContain('sp_flip_upper');

    const install = ready(labubuDef, 1);
    install.step({ p1: Btn.Skill6, p2: 0 });
    expect(install.state.fighters[0]).toMatchObject({ install: 'labubu_mischief_drive', installFrames: LABUBU_MISCHIEF_DRIVE.duration - 1 });
  });

  it('executes Twinkle reflection and fixed-relative falling star without target tracking', () => {
    const reflect = new FightSim({ p1: twinkleDef, p2: twinkleDef, controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 });
    reflect.state.fighters[0].x = px(-50); reflect.state.fighters[1].x = px(50);
    reflect.step({ p1: Btn.Skill5, p2: Btn.Skill1 });
    let reflected = false;
    for (let frame = 0; frame < 50; frame++) {
      reflect.step({ p1: 0, p2: 0 });
      if (reflect.hits.some((event) => event.kind === 'reflect')) reflected = true;
    }
    expect(reflected).toBe(true);

    const falling = ready(twinkleDef, 1);
    const casterX = falling.state.fighters[0].x;
    falling.state.fighters[1].x = px(-10); // 对手位置不参与生成点。
    falling.step({ p1: Btn.Skill4, p2: 0 });
    for (let frame = 0; frame < 20 && falling.state.projectiles.length === 0; frame++) falling.step({ p1: 0, p2: 0 });
    const projectile = falling.state.projectiles[0]!;
    expect(projectile.kind).toBe('twinkle_falling_star');
    expect(projectile.x).toBe(casterX + px(92));
    expect(projectile.vy).toBeGreaterThan(0);
  });

  it('LABUBU short st_a reaches every fighter at real pushbox contact on both facings', () => {
    for (const opponent of Object.values(characters)) for (const facing of [1, -1] as const) {
      const sim = new FightSim({ p1: labubuDef, p2: opponent, introFrames: 0, roundTime: -1 });
      const [me, other] = sim.state.fighters;
      me.x = px(facing === 1 ? -120 : 120);
      other.x = -me.x;
      me.facing = facing;
      other.facing = facing === 1 ? -1 : 1;
      const forward = facing === 1 ? Btn.Right : Btn.Left;
      let previous = me.x, stable = 0;
      for (let frame = 0; frame < 240 && stable < 3; frame++) {
        sim.step({ p1: forward, p2: 0 });
        stable = me.x === previous ? stable + 1 : 0;
        previous = me.x;
      }
      sim.step({ p1: 0, p2: 0 });
      sim.step({ p1: Btn.A, p2: 0 });
      const hits = [];
      for (let frame = 0; frame < 40; frame++) {
        sim.step({ p1: 0, p2: 0 });
        hits.push(...sim.hits);
      }
      expect(hits.some(event => event.attacker === 0 && event.moveId === 'st_a' && event.kind === 'hit'), `${opponent.id}/facing${facing}`).toBe(true);
    }
  });
});

describe('reviewed short-limb blowback contact', () => {
  const reviewed = [
    { def: labubuDef, moveId: 'cd', airborne: false, farDistance: 52.5 },
    { def: labubuDef, moveId: 'j_cd', airborne: true, farDistance: 52.5 },
    { def: twinkleDef, moveId: 'j_cd', airborne: true, farDistance: 79 },
  ] as const;

  function blowback(sim: FightSim, airborne: boolean): string[] {
    if (airborne) {
      sim.step({ p1: Btn.Up, p2: 0 });
      for (let frame = 0; frame < 10 && !sim.state.fighters[0].airborne; frame++) sim.step({ p1: 0, p2: 0 });
      expect(sim.state.fighters[0].airborne).toBe(true);
    }
    sim.step({ p1: Btn.C | Btn.D, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe(airborne ? 'j_cd' : 'cd');
    const hits = sim.hits.map(hit => hit.moveId);
    for (let frame = 0; frame < 80; frame++) {
      sim.step({ p1: 0, p2: 0 });
      hits.push(...sim.hits.filter(hit => hit.attacker === 0 && hit.kind === 'hit').map(hit => hit.moveId));
    }
    return hits;
  }

  it('does not damage an opponent at the detached distances reproduced in the browser', () => {
    for (const { def, airborne, farDistance } of reviewed) for (const facing of [1, -1] as const) {
      const opponent = def === labubuDef ? twinkleDef : labubuDef;
      const sim = new FightSim({ p1: def, p2: opponent, introFrames: 0, roundTime: -1 });
      const [me, other] = sim.state.fighters;
      me.x = px(-farDistance / 2) * facing; other.x = -me.x;
      me.facing = facing; other.facing = facing === 1 ? -1 : 1;
      expect(blowback(sim, airborne), `${def.id}/${airborne ? 'air' : 'ground'}/${facing}`).toEqual([]);
      expect(other.hp).toBe(opponent.maxHp);
    }
  });

  it('still connects after walking into real pushbox contact, including a neutral hop against every fighter', () => {
    for (const { def, moveId, airborne } of reviewed) for (const opponent of Object.values(characters)) for (const facing of [1, -1] as const) {
      const sim = new FightSim({ p1: def, p2: opponent, introFrames: 0, roundTime: -1 });
      const [me, other] = sim.state.fighters;
      me.x = px(-120) * facing; other.x = -me.x;
      me.facing = facing; other.facing = facing === 1 ? -1 : 1;
      const forward = facing === 1 ? Btn.Right : Btn.Left;
      let previous = Math.abs(other.x - me.x), stable = 0;
      for (let frame = 0; frame < 240 && stable < 3; frame++) {
        sim.step({ p1: forward, p2: 0 });
        const distance = Math.abs(other.x - me.x);
        stable = distance === previous ? stable + 1 : 0; previous = distance;
      }
      expect(stable, `${def.id}/${opponent.id}`).toBe(3);
      sim.step({ p1: 0, p2: 0 });
      expect(blowback(sim, airborne), `${def.id}/${moveId}/${opponent.id}/${facing}`).toContain(moveId);
    }
  });
});

describe('crossover CPU profiles', () => {
  const valid = Btn.Up | Btn.Down | Btn.Left | Btn.Right | ANY_ATTACK | Btn.Start;
  const run = () => {
    const sim = new FightSim({ p1: labubuDef, p2: twinkleDef, seed: 21, introFrames: 0, roundTime: -1 });
    const labubu = new Cpu(0, characterAi.labubu!, 'normal', 41);
    const twinkle = new Cpu(1, characterAi.twinkle!, 'normal', 42);
    const trace: number[] = [];
    const moves = new Set<string>();
    for (let frame = 0; frame < 2400 && sim.state.phase === 'fight'; frame++) {
      const p1 = labubu.input(sim), p2 = twinkle.input(sim);
      expect(p1 & ~valid).toBe(0);
      expect(p2 & ~valid).toBe(0);
      sim.step({ p1, p2 });
      for (const fighter of sim.state.fighters) if (fighter.moveId) moves.add(`${fighter.def.id}:${fighter.moveId}`);
      trace.push(p1, p2, sim.state.fighters[0].hp, sim.state.fighters[1].hp);
    }
    return { trace, moves, hp: sim.state.fighters.map((fighter) => fighter.hp) };
  };

  it('is deterministic at fixed seeds, emits only legal classic inputs and produces a real fight', () => {
    const first = run(), second = run();
    expect(second.trace).toEqual(first.trace);
    expect(first.moves.size).toBeGreaterThan(4);
    expect(first.hp[0]! < labubuDef.maxHp || first.hp[1]! < twinkleDef.maxHp).toBe(true);
  });
});
