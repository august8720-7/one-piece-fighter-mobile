import { describe, expect, it } from 'vitest';
import { Btn, FightSim, px, type Facing, type FighterDef, type MoveData } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

function position(sim: FightSim, distance: number, facing: Facing): void {
  const [attacker, defender] = sim.state.fighters;
  attacker.x = 0;
  attacker.facing = facing;
  defender.x = px(distance) * facing;
  defender.facing = facing === 1 ? -1 : 1;
}

function strike(sim: FightSim, attack = Btn.C, defense = 0): void {
  for (let frame = 0; frame < 40; frame++) {
    sim.step({ p1: frame === 0 ? attack : 0, p2: defense });
    if (sim.hits.length > 0) return;
  }
  throw new Error('contact fixture did not connect');
}

describe('打击事件的真实接触坐标', () => {
  it.each([1, -1] as const)('朝向%i：路飞远端命中取交叠中心，近身命中随接触位置变化', (facing) => {
    const far = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0 });
    position(far, 156, facing);
    strike(far);
    // 攻击14..154，赤犬身体139..173：交叠139..154，中心146.5。
    expect(far.hits[0]).toMatchObject({ kind: 'hit', moveId: 'st_c', x: px(146.5) * facing, y: px(-70), projectile: false });
    const near = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0 });
    position(near, 60, facing);
    strike(near);
    expect(near.hits[0]).toMatchObject({ kind: 'hit', x: px(60) * facing, y: px(-70) });
    expect(near.hits[0]!.damage).toBe(far.hits[0]!.damage);
  });

  it.each([1, -1] as const)('朝向%i：格挡使用实际蹲姿交叠点，不使用站姿或整条手臂中心', (facing) => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0 });
    position(sim, 156, facing);
    strike(sim, Btn.C, Btn.Down | (facing === 1 ? Btn.Right : Btn.Left));
    // 蹲姿身体137..175、-68..0，攻击14..154、-80..-60。
    expect(sim.hits[0]).toMatchObject({ kind: 'block', damage: 0, x: px(145.5) * facing, y: px(-64) });
    expect(sim.state.fighters[1].hp).toBe(akainuDef.maxHp);
  });

  it.each([1, -1] as const)('朝向%i：多个攻击框/受击框中使用真正相交的组合', (facing) => {
    const base = luffyDef.moves.find(move => move.id === 'st_a')!;
    const move: MoveData = { ...base, id: 'pair_probe', frames: [
      { duration: 1, sprite: 0 },
      { duration: 2, sprite: 1, hitboxes: [[10, -100, 10, 10], [70, -40, 30, 20]] },
      { duration: 6, sprite: 2 },
    ] };
    const attacker: FighterDef = { ...luffyDef, moves: [move] };
    const defender: FighterDef = { ...akainuDef, hurtboxStand: [[-5, -100, 10, 10], [-10, -40, 20, 20]] };
    const sim = new FightSim({ p1: attacker, p2: defender, introFrames: 0 });
    position(sim, 90, facing);
    strike(sim, Btn.A);
    expect(sim.hits).toHaveLength(1);
    expect(sim.hits[0]).toMatchObject({ kind: 'hit', moveId: 'pair_probe', x: px(90) * facing, y: px(-30) });
  });

  it('同帧互击的两个交叠点都在第一方受击改变姿态之前捕获', () => {
    const base = luffyDef.moves.find(move => move.id === 'st_a')!;
    const leftMove: MoveData = { ...base, id: 'left_trade', frames: [
      { duration: 1, sprite: 0 },
      { duration: 2, sprite: 1, hitboxes: [[75, -40, 35, 20]], hurtboxes: [[10, -80, 30, 20]] },
      { duration: 6, sprite: 2 },
    ] };
    const rightMove: MoveData = { ...base, id: 'right_trade', frames: [
      { duration: 1, sprite: 0 },
      { duration: 2, sprite: 1, hitboxes: [[75, -80, 35, 20]], hurtboxes: [[10, -40, 30, 20]] },
      { duration: 6, sprite: 2 },
    ] };
    const left: FighterDef = { ...luffyDef, moves: [leftMove], hurtboxStand: [[-10, -50, 20, 50]] };
    const right: FighterDef = { ...akainuDef, moves: [rightMove], hurtboxStand: [[-10, -50, 20, 50]] };
    const sim = new FightSim({ p1: left, p2: right, introFrames: 0 });
    position(sim, 100, 1);
    sim.step({ p1: Btn.A, p2: Btn.A });
    sim.step({ p1: 0, p2: 0 });
    expect(sim.hits).toHaveLength(2);
    expect(sim.hits[0]).toMatchObject({ attacker: 0, defender: 1, moveId: 'left_trade', x: px(82.5), y: px(-30) });
    expect(sim.hits[1]).toMatchObject({ attacker: 1, defender: 0, moveId: 'right_trade', x: px(17.5), y: px(-70) });
    expect(sim.state.fighters.every(fighter => fighter.state === 'hit_stand')).toBe(true);
  });
});
