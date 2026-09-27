import { describe, expect, it } from 'vitest';
import { Btn, FightSim, px, type HitEvent, type InputFrame, type ProjectileEndEvent } from '../../src/core';
import { luffyDef, twinkleDef } from '../../src/characters';

/** One input pulse, then enough neutral frames to catch a surviving wave hitting again. */
function cast(sim: FightSim, input: InputFrame) {
  const hits: HitEvent[] = [];
  const ends: ProjectileEndEvent[] = [];
  sim.step(input);
  const started = sim.state.fighters.map(fighter => fighter.moveId);
  const meterAfterInput = sim.state.fighters[0].meter;
  hits.push(...sim.hits);
  ends.push(...sim.projectileEnds);
  for (let tick = 0; tick < 180; tick++) {
    sim.step({ p1: 0, p2: 0 });
    hits.push(...sim.hits);
    ends.push(...sim.projectileEnds);
  }
  return { started, meterAfterInput, hits, ends };
}

describe('Twinkle shining wave finite-meter budget', () => {
  it('one real shortcut costs a bar, hits once for 186, and cannot refund the whole starting bar', () => {
    const sim = new FightSim({ p1: twinkleDef, p2: luffyDef, controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 });
    const [caster, defender] = sim.state.fighters;
    // Unit-test initial conditions, with no infinite-meter training or direct projectile manipulation.
    const startingMeter = 100;
    caster.meter = startingMeter;
    caster.x = 0;
    defender.x = px(120);
    const result = cast(sim, { p1: Btn.Skill8, p2: 0 });

    expect(result.started[0]).toBe('sp_shining_wave');
    expect(result.meterAfterInput).toBe(0);
    expect(result.hits.filter(event => event.attacker === 0 && event.kind === 'hit').map(event => event.damage)).toEqual([186]);
    expect(defender.hp).toBe(luffyDef.maxHp - 186);
    expect(caster.meter).toBeLessThan(startingMeter);
    expect(result.ends.filter(event => event.moveId === 'sp_shining_wave').map(event => event.reason)).toEqual(['hit']);
  });

  it('the wave is exhausted by one actual opposing star instead of passing through the clash', () => {
    const sim = new FightSim({ p1: twinkleDef, p2: twinkleDef, controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 });
    const [caster, opponent] = sim.state.fighters;
    caster.meter = 100;
    caster.x = px(-140);
    opponent.x = px(140);
    const result = cast(sim, { p1: Btn.Skill8, p2: Btn.Skill1 });

    expect(result.started).toEqual(['sp_shining_wave', 'sp_tiny_star']);
    expect(result.hits.some(event => event.kind === 'clash')).toBe(true);
    expect(result.ends.filter(event => event.moveId === 'sp_shining_wave').map(event => event.reason)).toEqual(['clash']);
    expect(result.hits.some(event => event.kind === 'hit')).toBe(false);
    expect([caster.hp, opponent.hp]).toEqual([twinkleDef.maxHp, twinkleDef.maxHp]);
  });
});
