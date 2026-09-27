import { describe, expect, it } from 'vitest';
import { Btn, FightSim, STAGE_LEFT, STAGE_RIGHT, px, type Facing, type PlayerIndex } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

function make(player: PlayerIndex, facing: Facing, corner = true): FightSim {
  const sim = new FightSim({
    p1: player === 0 ? luffyDef : akainuDef,
    p2: player === 1 ? luffyDef : akainuDef,
    introFrames: 0, roundTime: -1,
  });
  const a = sim.state.fighters[player];
  const b = sim.state.fighters[player === 0 ? 1 : 0];
  b.x = corner ? (facing === 1 ? STAGE_RIGHT - px(17) : STAGE_LEFT + px(17)) : 0;
  a.x = b.x - px(35) * facing;
  a.facing = facing;
  b.facing = facing === 1 ? -1 : 1;
  return sim;
}

function step(sim: FightSim, player: PlayerIndex, attack: number, defend: number): void {
  sim.step(player === 0 ? { p1: attack, p2: defend } : { p1: defend, p2: attack });
}

describe('corner pushback', () => {
  for (const player of [0, 1] as const) {
    for (const facing of [1, -1] as const) {
      for (const guarded of [false, true]) {
        it(`P${player + 1} 朝向 ${facing}，墙角轻拳${guarded ? '被挡' : '命中'}后拉开距离并恢复防守方操作`, () => {
          const sim = make(player, facing);
          const a = sim.state.fighters[player];
          const b = sim.state.fighters[player === 0 ? 1 : 0];
          const initialAttackerX = a.x;
          const back = facing === 1 ? Btn.Right : Btn.Left;
          let contacts = 0;
          let recovered = false;
          for (let i = 0; i < 360; i++) {
            step(sim, player, i % 14 === 0 ? Btn.A : 0, guarded ? back : 0);
            contacts += sim.hits.filter((e) => e.kind === (guarded ? 'block' : 'hit')).length;
            if (contacts > 0 && ['idle', 'walk_back', 'crouch'].includes(b.state)) recovered = true;
          }
          expect(contacts).toBeGreaterThanOrEqual(2);
          expect(contacts).toBeLessThan(10);
          expect(recovered).toBe(true);
          expect(b.hp).toBeGreaterThan(b.def.maxHp / 2);
          expect((initialAttackerX - a.x) * facing).toBeGreaterThan(0);
          expect(sim.state.phase).toBe('fight');
          expect(Number.isInteger(a.x)).toBe(true);
          expect(Number.isInteger(b.x)).toBe(true);
        });
      }

      it(`P${player + 1} 朝向 ${facing}，中场与墙角一拳产生相同的分离距离`, () => {
        const midscreen = make(player, facing, false);
        const corner = make(player, facing);
        for (let i = 0; i < 40; i++) {
          step(midscreen, player, i === 0 ? Btn.A : 0, 0);
          step(corner, player, i === 0 ? Btn.A : 0, 0);
        }
        const distance = (sim: FightSim) => Math.abs(sim.state.fighters[0].x - sim.state.fighters[1].x);
        expect(distance(corner)).toBe(distance(midscreen));
      });
    }
  }

  it('中场保留轻拳短连，未通过禁止同招取消修复墙角问题', () => {
    const sim = make(0, 1, false);
    let maxCombo = 0;
    for (let i = 0; i < 180; i++) {
      sim.step({ p1: i % 12 === 0 ? Btn.A : 0, p2: 0 });
      maxCombo = Math.max(maxCombo, sim.state.fighters[1].comboHits);
    }
    expect(maxCombo).toBeGreaterThanOrEqual(2);
    expect(sim.state.fighters[1].hp).toBeGreaterThan(0);
  });

  it('墙角吃飞行道具不会把远处施放者隔空反推', () => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
    const [defender, caster] = sim.state.fighters;
    defender.x = STAGE_RIGHT - px(14);
    defender.facing = -1;
    caster.x = px(200);
    caster.facing = 1;
    for (const p2 of [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.C]) sim.step({ p1: 0, p2 });
    let hit = false;
    const casterX = caster.x;
    for (let i = 0; i < 120; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.some((e) => e.projectile && e.kind === 'hit')) hit = true;
    }
    expect(hit).toBe(true);
    expect(caster.x).toBe(casterX);
  });
});
