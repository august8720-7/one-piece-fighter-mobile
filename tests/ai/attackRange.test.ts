import { describe, expect, it } from 'vitest';
import { Btn, FightSim, px, type Facing } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { actionCanReach } from '../../src/ai/attackRange';

const make = (facing: Facing, distance: number) => {
  const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0, roundTime: -1 });
  const [me, opp] = sim.state.fighters;
  me.x = 0;
  me.facing = facing;
  opp.x = px(distance) * facing;
  opp.facing = facing === 1 ? -1 : 1;
  return sim;
};

function actualHits(sim: FightSim, p2 = 0): number {
  let hits = 0;
  for (let i = 0; i < 70; i++) {
    sim.step({ p1: 0, p2 });
    hits += sim.hits.filter((e) => e.kind === 'hit' && e.attacker === 0).length;
  }
  return hits;
}

describe('CPU attack range', () => {
  it.each([1, -1] as const)('朝向 %i：重脚够不到时不能原地空挥，近身可以出招', (facing) => {
    const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0 });
    const [me, opp] = sim.state.fighters;
    me.x = 0;
    me.facing = facing;
    opp.facing = facing === 1 ? -1 : 1;
    opp.x = px(140 * facing);
    const kick = { kind: 'normal', stance: 'stand', button: 'D' } as const;
    expect(actionCanReach(kick, me, opp)).toBe(false);
    opp.x = px(55 * facing);
    expect(actionCanReach(kick, me, opp)).toBe(true);
  });

  it('普通投检查距离与空中状态，远距离仍能选择飞行道具', () => {
    const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0 });
    const [me, opp] = sim.state.fighters;
    expect(actionCanReach({ kind: 'throw' }, me, opp)).toBe(false);
    expect(actionCanReach({ kind: 'special', motion: '214', button: 'P' }, me, opp)).toBe(true);
    opp.x = me.x + px(30);
    expect(actionCanReach({ kind: 'throw' }, me, opp)).toBe(true);
    opp.airborne = true;
    expect(actionCanReach({ kind: 'throw' }, me, opp)).toBe(false);
  });

  it('长手普通技和带前进位移的特殊技保留各自的射程', () => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0 });
    const [me, opp] = sim.state.fighters;
    me.x = 0;
    opp.x = px(140);
    expect(actionCanReach({ kind: 'normal', stance: 'stand', button: 'C' }, me, opp)).toBe(true);
    expect(actionCanReach({ kind: 'normal', stance: 'stand', button: 'A' }, me, opp)).toBe(false);
    expect(actionCanReach({ kind: 'special', motion: '236', button: 'K' }, me, opp)).toBe(true);
  });

  it.each([1, -1] as const)('朝向 %i：启动前移不能虚算到 active，201px 赤犬重拳确实够不到', (facing) => {
    const sim = make(facing, 201);
    const [me, opp] = sim.state.fighters;
    expect(actionCanReach({ kind: 'normal', stance: 'stand', button: 'C' }, me, opp)).toBe(false);
    sim.step({ p1: Btn.C, p2: 0 });
    expect(actualHits(sim)).toBe(0);
    expect(me.x).toBe(px(18) * facing);
  });

  it.each([1, -1] as const)('朝向 %i：前跳接近时保留来得及命中的蹲重拳对空', (facing) => {
    for (const elapsed of [5, 8, 10]) {
      const sim = make(facing, 80);
      const [me, opp] = sim.state.fighters;
      const towardsCpu = facing === 1 ? Btn.Left : Btn.Right;
      sim.step({ p1: 0, p2: Btn.Up | towardsCpu });
      for (let i = 0; i < elapsed; i++) sim.step({ p1: 0, p2: i < 3 ? Btn.Up | towardsCpu : 0 });
      expect(opp.airborne).toBe(true);
      expect(opp.y).toBeLessThan(px(-20));
      expect(actionCanReach({ kind: 'normal', stance: 'crouch', button: 'C' }, me, opp)).toBe(true);
      sim.step({ p1: Btn.Down | Btn.C, p2: 0 });
      expect(actualHits(sim)).toBeGreaterThan(0);
    }
  });

  it('远处原地跳仍在对空射程之外，不因增加空中包络就全部放行', () => {
    const sim = make(1, 300);
    sim.step({ p1: 0, p2: Btn.Up });
    for (let i = 0; i < 5; i++) sim.step({ p1: 0, p2: 0 });
    const [me, opp] = sim.state.fighters;
    expect(opp.airborne).toBe(true);
    expect(actionCanReach({ kind: 'normal', stance: 'crouch', button: 'C' }, me, opp)).toBe(false);
  });

  it.each([1, -1] as const)('朝向 %i：对手正在出蹲技时按蹲姿判断，高轻拳真实打空', (facing) => {
    const sim = make(facing, 50);
    const [me, opp] = sim.state.fighters;
    sim.step({ p1: 0, p2: Btn.Down | Btn.D });
    expect(opp.state).toBe('attack');
    expect(sim.stance(opp)).toBe('crouch');
    expect(actionCanReach({ kind: 'normal', stance: 'stand', button: 'A' }, me, opp)).toBe(false);
    sim.step({ p1: Btn.A, p2: Btn.Down });
    expect(actualHits(sim, Btn.Down)).toBe(0);
  });

  it.each([1, -1] as const)('朝向 %i：当前攻击帧伸出的手臂也属于可攻击范围', (facing) => {
    const sim = make(facing, 200);
    const [me, opp] = sim.state.fighters;
    sim.step({ p1: 0, p2: Btn.C });
    expect(opp.moveId).toBe('st_c');
    expect(actionCanReach({ kind: 'normal', stance: 'stand', button: 'D' }, me, opp)).toBe(true);
    sim.step({ p1: Btn.D, p2: 0 });
    expect(actualHits(sim)).toBeGreaterThan(0);
  });

  it('普通投的距离等号与 core 相同', () => {
    const sim = make(1, 50);
    const [me, opp] = sim.state.fighters;
    expect(actionCanReach({ kind: 'throw' }, me, opp)).toBe(true);
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    expect(me.state).toBe('throw');
  });

  it('飞行道具保持保守豁免，近身粗筛不冒充投射物射程预测', () => {
    const sim = make(1, 400);
    const [me, opp] = sim.state.fighters;
    expect(actionCanReach({ kind: 'special', motion: '214', button: 'K' }, me, opp)).toBe(true);
  });
});
