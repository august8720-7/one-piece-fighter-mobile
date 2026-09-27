import { describe, expect, it } from 'vitest';
import { FightSim, SKILL_BUTTONS, px, type PlayerIndex } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';

const cases = [
  { id: 'sp_flip_upper', slot: 2, far: 62.5 },
  { id: 'sp_monster_charge', slot: 7, far: 150 },
  { id: 'ult_monster_mayhem', slot: 8, far: 220 },
] as const;

function perform(slot: number, distance: number, actor: PlayerIndex, facing: 1 | -1) {
  const sim = new FightSim({ p1: actor === 0 ? labubuDef : twinkleDef, p2: actor === 0 ? twinkleDef : labubuDef,
    controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 });
  const attacker = sim.state.fighters[actor], defender = sim.state.fighters[actor === 0 ? 1 : 0];
  attacker.x = 0; defender.x = px(distance) * facing;
  attacker.facing = facing; defender.facing = facing === 1 ? -1 : 1; attacker.meter = 300;
  const hp = defender.hp;
  sim.step(actor === 0 ? { p1: SKILL_BUTTONS[slot]!, p2: 0 } : { p1: 0, p2: SKILL_BUTTONS[slot]! });
  const started = attacker.moveId;
  for (let i = 0; i < 200 && attacker.moveId !== null; i++) sim.step({ p1: 0, p2: 0 });
  return { started, state: attacker.state, damage: hp - defender.hp };
}

describe('short-limb contact regressions from the 0927 browser review', () => {
  for (const move of cases) {
    it(`${move.id} cannot hit through the observed empty space, on either player or facing`, () => {
      for (const player of [0, 1] as const) for (const facing of [1, -1] as const) {
        const result = perform(move.slot, move.far, player, facing);
        expect(result.started).toBe(move.id);
        expect(result.state).toBe('idle');
        expect(result.damage).toBe(0);
      }
    });
    it(`${move.id} still makes contact at close range, on either player or facing`, () => {
      for (const player of [0, 1] as const) for (const facing of [1, -1] as const) {
        const result = perform(move.slot, 40, player, facing);
        expect(result.started).toBe(move.id);
        expect(result.state).toBe('idle');
        expect(result.damage).toBeGreaterThan(0);
      }
    });
  }

  it('keeps the close ultimate a five-hit attack without giving the defender a guaranteed recovery punish', () => {
    for (const opponent of [luffyDef, akainuDef, labubuDef, twinkleDef]) {
      for (const player of [0, 1] as const) for (const facing of [1, -1] as const) {
        const sim = new FightSim({ p1: player === 0 ? labubuDef : opponent, p2: player === 0 ? opponent : labubuDef,
          controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 });
        const attacker = sim.state.fighters[player], defender = sim.state.fighters[player === 0 ? 1 : 0];
        attacker.x = 0; defender.x = px(40) * facing;
        attacker.facing = facing; defender.facing = facing === 1 ? -1 : 1; attacker.meter = 300;
        const hits: number[] = [];
        let attackerReady: number | null = null, defenderReady: number | null = null;
        for (let tick = 0; tick < 220; tick++) {
          const press = tick === 0 ? SKILL_BUTTONS[8]! : 0;
          sim.step(player === 0 ? { p1: press, p2: 0 } : { p1: 0, p2: press });
          hits.push(...sim.hits.filter(hit => hit.attacker === player && hit.kind === 'hit').map(hit => hit.damage));
          if (tick > 0 && attacker.moveId === null) attackerReady ??= tick;
          if (hits.length && defender.state === 'idle') defenderReady ??= tick;
          if (attackerReady !== null && defenderReady !== null) break;
        }
        expect(hits, `${opponent.id} P${player + 1} facing ${facing}`).toEqual([58, 52, 46, 40, 34]);
        expect(attackerReady).not.toBeNull();
        expect(defenderReady).not.toBeNull();
        expect(defenderReady!).toBeGreaterThanOrEqual(attackerReady!);
      }
    }
  });
});
