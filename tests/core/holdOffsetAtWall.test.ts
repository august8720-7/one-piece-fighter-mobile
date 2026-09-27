import { describe, expect, it } from 'vitest';
import { Btn, FightSim, SKILL_BUTTONS, STAGE_LEFT, STAGE_RIGHT, SUBPIXEL, px } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import type { FighterDef, PlayerIndex } from '../../src/core';

const opponents = [luffyDef, akainuDef, labubuDef, twinkleDef];

function setup(opponent: FighterDef, player: PlayerIndex, facing: 1 | -1, wall: boolean) {
  const sim = new FightSim({
    p1: player === 0 ? labubuDef : opponent,
    p2: player === 0 ? opponent : labubuDef,
    controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1,
  });
  const attacker = sim.state.fighters[player];
  const defender = sim.state.fighters[player === 0 ? 1 : 0];
  // Pure-logic fixture: only the starting roots and facing are placed; all state
  // transitions below come from InputFrame through FightSim.step.
  attacker.x = px((wall ? 476 : -40) * facing);
  defender.x = px((wall ? 510 : -2) * facing);
  attacker.facing = facing;
  defender.facing = facing === 1 ? -1 : 1;
  const step = (actorBits: number, victimBits = 0) => sim.step(player === 0
    ? { p1: actorBits, p2: victimBits } : { p1: victimBits, p2: actorBits });
  return { sim, attacker, defender, step };
}

describe('LABUBU leg-flip wall hold', () => {
  it('keeps both roots legal and the full 30 px hold through rolling wall capture', () => {
    for (const opponent of opponents) for (const player of [0, 1] as const) for (const facing of [1, -1] as const) {
      const { sim, attacker, defender, step } = setup(opponent, player, facing, true);
      const forward = facing === 1 ? Btn.Right : Btn.Left;
      const victimBack = facing === 1 ? Btn.Right : Btn.Left;
      step(forward, victimBack | Btn.A | Btn.B);
      step(0);
      for (let i = 0; i < 5; i++) step(forward);
      step(SKILL_BUTTONS[4]!);
      expect(attacker.moveId, `${opponent.id} P${player + 1} facing ${facing}`).toBe('sp_leg_flip');
      let held = 0;
      let damage = 0;
      for (let i = 0; i < 85; i++) {
        step(0);
        if (attacker.state === 'throw' && defender.state === 'thrown') {
          held++;
          expect((defender.x - attacker.x) * facing).toBe(px(30));
          for (const fighter of [attacker, defender]) {
            const half = (fighter.def.pushboxStand[2] * SUBPIXEL) >> 1;
            expect(fighter.x).toBeGreaterThanOrEqual(STAGE_LEFT + half);
            expect(fighter.x).toBeLessThanOrEqual(STAGE_RIGHT - half);
          }
        }
        damage += sim.hits.filter(hit => hit.moveId === 'sp_leg_flip' && hit.kind === 'hit').reduce((sum, hit) => sum + hit.damage, 0);
      }
      expect(held).toBe(24);
      expect(damage).toBe(148);
      expect(attacker.state).toBe('idle');
      expect(defender.state).not.toBe('thrown');
    }
  });

  it('keeps the same hold and release in the center', () => {
    for (const opponent of opponents) for (const player of [0, 1] as const) for (const facing of [1, -1] as const) {
      const { attacker, defender, step } = setup(opponent, player, facing, false);
      step(SKILL_BUTTONS[4]!);
      let held = 0;
      for (let i = 0; i < 70; i++) {
        step(0);
        if (attacker.state === 'throw' && defender.state === 'thrown') {
          held++;
          expect((defender.x - attacker.x) * facing).toBe(px(30));
        }
      }
      expect(held).toBe(24);
      expect(attacker.state).toBe('idle');
      expect(defender.state).not.toBe('thrown');
    }
  });

  it('does not opt ordinary throws into wall correction', () => {
    const enabled = labubuDef.moves.filter(move => move.throwData?.keepHoldOffsetAtWall);
    expect(enabled.map(move => move.id)).toEqual(['sp_leg_flip']);
    for (const id of ['throw_fwd', 'throw_back']) {
      expect(labubuDef.moves.find(move => move.id === id)?.throwData?.keepHoldOffsetAtWall).toBeUndefined();
    }
    for (const opponent of opponents) {
      const { attacker, defender, step } = setup(opponent, 0, 1, false);
      step(Btn.Right | Btn.C);
      expect(attacker.state).toBe('throw');
      expect(defender.state).toBe('thrown');
      expect((defender.x - attacker.x) / SUBPIXEL).toBe(31);
    }
    for (const oldDef of [luffyDef, akainuDef]) for (const facing of [1, -1] as const) {
      for (const direction of ['forward', 'back'] as const) {
        const sim = new FightSim({ p1: oldDef, p2: oldDef === luffyDef ? akainuDef : luffyDef,
          introFrames: 0, roundTime: -1 });
        const [attacker, defender] = sim.state.fighters;
        attacker.x = px(-20 * facing);
        defender.x = px(20 * facing);
        attacker.facing = facing;
        defender.facing = facing === 1 ? -1 : 1;
        const motion = direction === 'forward' ? facing : -facing;
        sim.step({ p1: (motion === 1 ? Btn.Right : Btn.Left) | Btn.C, p2: 0 });
        expect(attacker.state).toBe('throw');
        expect(defender.state).toBe('thrown');
        const move = sim.move(attacker)!;
        expect(move.throwData?.keepHoldOffsetAtWall).toBeUndefined();
        expect((defender.x - attacker.x) * facing).toBe(px(move.throwData!.holdOffset));
        const hpBefore = defender.hp;
        let hits = 0;
        for (let i = 0; i < move.throwData!.duration; i++) {
          sim.step({ p1: 0, p2: 0 });
          hits += sim.hits.filter(hit => hit.moveId === move.id && hit.kind === 'hit').length;
        }
        expect(hits).toBe(1);
        expect(defender.hp).toBeLessThan(hpBefore);
        expect(attacker.state).toBe('idle');
        expect(defender.state).not.toBe('thrown');
      }
    }
  });
});
