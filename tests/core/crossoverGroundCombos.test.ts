import { describe, expect, it } from 'vitest';
import {
  Btn, FightSim, overlaps, px,
  type FighterDef, type FighterState, type HitEvent,
} from '../../src/core';
import { labubuDef, luffyDef, twinkleDef } from '../../src/characters';

const flurry = { id: 'sp_prank_flurry', button: Btn.Skill2, hits: 4 } as const;
const tumble = { id: 'sp_tumble_riot', button: Btn.Skill7, hits: 5 } as const;
type GroundSkill = typeof flurry | typeof tumble;

function make(p1: FighterDef, p2: FighterDef, distance: number): FightSim {
  const sim = new FightSim({ p1, p2, controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1, seed: 27 });
  const [a, b] = sim.state.fighters;
  a.x = 0;
  b.x = px(distance);
  a.meter = 300;
  return sim;
}

function ready(fighter: FighterState): boolean {
  return !fighter.airborne && fighter.hitstop === 0 && ['idle', 'walk_back', 'crouch'].includes(fighter.state);
}

/** One real shortcut press; optionally answer the first recovered frame with a jab while LABUBU holds back. */
function perform(skill: GroundSkill, opponent: FighterDef, distance: number, defend = false, answerJab = false) {
  const sim = make(labubuDef, opponent, distance);
  const [a, b] = sim.state.fighters;
  const contacts: HitEvent[] = [];
  let launched = false, replySent = false;
  let reply: HitEvent | undefined;
  let replyDuringRecovery = false;
  for (let tick = 0; tick < 220; tick++) {
    let p1: number = tick === 0 ? skill.button : 0;
    let p2: number = defend && !replySent ? Btn.Right : 0;
    if (answerJab && contacts.length > 0 && (replySent || ready(b))) {
      p1 = Btn.Left;
      if (!replySent) { p2 = Btn.A; replySent = true; }
    }
    const wasRecovering = a.state === 'attack' && a.moveId === skill.id;
    sim.step({ p1, p2 });
    if (tick === 0) expect(a.moveId).toBe(skill.id);
    launched ||= b.airborne;
    contacts.push(...sim.hits.filter(event => event.attacker === 0 && event.moveId === skill.id));
    reply = sim.hits.find(event => event.attacker === 1 && event.defender === 0);
    if (reply) { replyDuringRecovery = wasRecovering; break; }
    if (!answerJab && tick > 0 && a.moveId !== skill.id && ready(b)) break;
  }
  return {
    contacts, hits: contacts.filter(event => event.kind === 'hit'),
    damage: opponent.maxHp - b.hp, launched, reply, replyDuringRecovery,
  };
}

describe('calibrated crossover ground attacks', () => {
  it.each([
    { skill: flurry, opponent: twinkleDef, distance: 34 },
    { skill: tumble, opponent: luffyDef, distance: 40 },
  ])('$skill.id completes its grounded combo and can defend the recovery jab', ({ skill, opponent, distance }) => {
    const result = perform(skill, opponent, distance, false, true);
    expect(result.hits).toHaveLength(skill.hits);
    expect(result.launched).toBe(false);
    expect(result.reply?.kind).toBe('block');
  });

  it('retains a partial flurry at the edge, with less damage, and does not reach through distant empty space', () => {
    const close = perform(flurry, luffyDef, 30);
    const edge = perform(flurry, luffyDef, 40);
    expect(close.hits).toHaveLength(4);
    expect(edge.hits).toHaveLength(3);
    expect(edge.damage).toBeLessThan(close.damage);
    expect(perform(flurry, luffyDef, 71).damage).toBe(0);
    expect(perform(tumble, luffyDef, 110).damage).toBe(0);
  });

  it.each([flurry, tumble])('$id remains punishable when blocked even if LABUBU tries to guard', skill => {
    const result = perform(skill, twinkleDef, 40, true, true);
    expect(result.contacts.length).toBeGreaterThan(0);
    expect(result.contacts.every(event => event.kind === 'block')).toBe(true);
    expect(result.reply?.kind).toBe('hit');
    expect(result.replyDuringRecovery).toBe(true);
  });

  it('a completely whiffed flurry can still be approached and punished during recovery', () => {
    const sim = make(labubuDef, twinkleDef, 80);
    const [a] = sim.state.fighters;
    const hits: HitEvent[] = [];
    let approached = false, jabSent = false, punishedInRecovery = false;
    for (let tick = 0; tick < 90; tick++) {
      let p1: number = tick === 0 ? Btn.Skill2 : 0;
      let p2: number = 0;
      // Recorded whiff-punish input: wait until all four active sections have ended.
      if (a.moveId === flurry.id && a.stateFrame >= 30) {
        p1 = Btn.Left;
        if (!approached) { p2 = Btn.Left; approached = true; }
        else if (!jabSent) { p2 = Btn.A; jabSent = true; }
      }
      const recovering = a.state === 'attack' && a.moveId === flurry.id;
      sim.step({ p1, p2 });
      hits.push(...sim.hits);
      if (sim.hits.some(event => event.attacker === 1 && event.kind === 'hit')) {
        punishedInRecovery = recovering;
        break;
      }
    }
    expect(hits.some(event => event.attacker === 0)).toBe(false);
    expect(punishedInRecovery).toBe(true);
  });

  it('Twinkle can walk into standing contact and then land the crouching uppercut without shrinking its hurtbox', () => {
    const sim = make(twinkleDef, luffyDef, 80);
    const [star, other] = sim.state.fighters;
    // Reproduce the player path: both walk in standing, release movement, then press crouch + C.
    // Starting from the narrower crouch contact distance would conceal this regression.
    let previousGap = other.x - star.x, stable = 0;
    for (let tick = 0; tick < 120 && stable < 3; tick++) {
      sim.step({ p1: Btn.Right, p2: Btn.Left });
      const gap = other.x - star.x;
      stable = gap === previousGap ? stable + 1 : 0;
      previousGap = gap;
    }
    expect(stable).toBe(3);
    sim.step({ p1: 0, p2: 0 });
    expect(star.state).toBe('idle');
    expect(overlaps(sim.pushbox(star), sim.pushbox(other))).toBe(false);
    expect(twinkleDef.hurtboxCrouch).toEqual([[-22, -58, 44, 58]]);
    sim.step({ p1: Btn.Down | Btn.C, p2: 0 });
    expect(star.moveId).toBe('cr_c');
    const hits: HitEvent[] = [...sim.hits];
    for (let tick = 0; tick < 50; tick++) {
      sim.step({ p1: Btn.Down, p2: 0 });
      hits.push(...sim.hits);
    }
    expect(hits.some(event => event.attacker === 0 && event.moveId === 'cr_c' && event.kind === 'hit')).toBe(true);
  });

  it('Twinkle still takes a crouching mid normally and can block it with the same hurt surface', () => {
    for (const guard of [false, true]) {
      const sim = make(luffyDef, twinkleDef, 38);
      const hold = Btn.Down | (guard ? Btn.Right : 0);
      sim.step({ p1: Btn.Down, p2: hold });
      sim.step({ p1: Btn.Down | Btn.A, p2: hold });
      let contact = sim.hits[0];
      for (let tick = 0; tick < 25 && !contact; tick++) {
        sim.step({ p1: Btn.Down, p2: hold });
        contact = sim.hits[0];
      }
      expect(contact?.kind).toBe(guard ? 'block' : 'hit');
    }
  });

  it('Twinkle can cross sides by rolling, rise from close crouch, and move and guard normally', () => {
    const sim = make(twinkleDef, luffyDef, 70);
    const [star, other] = sim.state.fighters;
    sim.step({ p1: Btn.Right | Btn.A | Btn.B, p2: 0 });
    expect(star.state).toBe('roll_fwd');
    for (let tick = 0; tick < 40; tick++) sim.step({ p1: 0, p2: 0 });
    expect(star.x).toBeGreaterThan(other.x);
    expect(star.facing).toBe(-1);
    expect(star.state).toBe('idle');
    // The left opponent closes the extra crouch space; standing must separate, then release movement.
    for (let tick = 0; tick < 12; tick++) sim.step({ p1: Btn.Down, p2: Btn.Right });
    sim.step({ p1: 0, p2: 0 });
    expect(star.state).toBe('idle');
    expect(overlaps(sim.pushbox(star), sim.pushbox(other))).toBe(false);
    const before = star.x;
    sim.step({ p1: Btn.Right, p2: 0 }); // Back is now right, after the side switch.
    expect(star.x).toBeGreaterThan(before);
    expect(sim.isGuarding(star)).toBe(true);
  });
});
