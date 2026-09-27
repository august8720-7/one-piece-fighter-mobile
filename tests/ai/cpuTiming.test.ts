import { describe, expect, it, vi } from 'vitest';
import { Btn, FightSim, px, type FighterState } from '../../src/core';
import { akainuDef, characterAi, luffyDef } from '../../src/characters';
import { Cpu } from '../../src/ai/cpu';
import { DIFFICULTY, type AiAction, type Difficulty } from '../../src/ai/types';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });

/** 固定策略，只检查调度时机；不受出招权重和攻击性抽签影响。 */
function scriptedDecisions(cpu: Cpu, action: AiAction) {
  const frames: number[] = [];
  const strategy = cpu as unknown as { decide: (sim: FightSim, me: FighterState, opp: FighterState) => AiAction | null };
  vi.spyOn(strategy, 'decide').mockImplementation((sim) => {
    frames.push(sim.state.frame);
    return action;
  });
  return frames;
}

describe('CPU 中立决策计时', () => {
  it('反应完成时短拳已经挥空收招，不再执行过期后退防御', () => {
    const sim = mk();
    sim.state.fighters[0].x = px(-40);
    sim.state.fighters[1].x = px(40);
    sim.step({ p1: Btn.A, p2: 0 });
    const cpu = new Cpu(1, characterAi.akainu!, 'normal', 6);
    scriptedDecisions(cpu, { kind: 'wait', frames: 1 });
    const blocks: number[] = [];
    for (let i = 0; i < 30; i++) {
      const bits = cpu.input(sim);
      if (bits & Btn.Right) blocks.push(sim.state.frame);
      sim.step({ p1: 0, p2: bits });
    }
    expect(sim.state.fighters[1].hp).toBe(akainuDef.maxHp);
    expect(blocks).toEqual([]);
  });

  it('延迟防御从当前剩余攻击帧计算，反应的12帧不再重复算进持防时间', () => {
    const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0, roundTime: -1 });
    sim.state.fighters[0].x = px(-105);
    sim.state.fighters[1].x = px(105);
    sim.step({ p1: Btn.C, p2: 0 });
    const cpu = new Cpu(1, characterAi.luffy!, 'normal', 6);
    scriptedDecisions(cpu, { kind: 'wait', frames: 1 });
    const blocks: number[] = [];
    for (let i = 0; i < 42; i++) {
      const bits = cpu.input(sim);
      if (bits & Btn.Right) blocks.push(sim.state.frame);
      sim.step({ p1: 0, p2: bits });
    }
    expect(sim.state.fighters[1].hp).toBe(luffyDef.maxHp);
    expect(blocks[0]).toBe(1 + DIFFICULTY.normal.reaction);
    // 赤犬的active在第16动作帧结束；保留8帧防守余量，24帧之后不继续退守。
    expect(blocks.at(-1)).toBe(24);
  });

  it('长手确反采用真实射程，超过近身分区仍可选中能打到的重拳', () => {
    const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0, roundTime: -1 });
    sim.state.fighters[0].x = px(-50);
    sim.state.fighters[1].x = px(50);
    const action: AiAction = { kind: 'normal', stance: 'stand', button: 'C' };
    const wait = [{ weight: 1, action: { kind: 'wait' as const, frames: 1 } }];
    const cpu = new Cpu(1, { ...characterAi.luffy!, punish: [{ weight: 1, action }], close: wait, mid: wait, far: wait }, 'normal', 6);
    sim.step({ p1: Btn.C, p2: Btn.Right });
    cpu.input(sim); // 先观察真实起手，之后经过完整反应延迟。
    while (sim.state.fighters[0].stateFrame < 16 && sim.state.frame < 60) sim.step({ p1: 0, p2: Btn.Right });
    cpu.input(sim);
    const [opp, me] = sim.state.fighters;
    expect(Math.abs(me.x - opp.x)).toBeGreaterThan(px(characterAi.luffy!.closeRange + 50));
    expect(Math.abs(me.x - opp.x) / 256).toBeLessThan(172);
    const strategy = cpu as unknown as {
      roll: (percent: number) => boolean;
      decide: (sim: FightSim, me: FighterState, opp: FighterState) => AiAction | null;
    };
    vi.spyOn(strategy, 'roll').mockReturnValue(true); // 只固定选择意愿，不改变模拟器范围或帧数据。
    expect(strategy.decide(sim, me, opp)).toEqual(action);
  });

  it('出招经过反应间隔后，恢复可行动的第一帧就能重新决策', () => {
    const sim = mk();
    const cpu = new Cpu(1, characterAi.akainu!, 'normal', 5);
    const decisions = scriptedDecisions(cpu, { kind: 'normal', stance: 'stand', button: 'C' });
    const me = sim.state.fighters[1];
    sim.step({ p1: 0, p2: cpu.input(sim) });
    expect(me.state).toBe('attack');
    while (me.state === 'attack' && sim.state.frame < 120) sim.step({ p1: 0, p2: cpu.input(sim) });
    expect(me.state).toBe('idle');
    const recoveredAt = sim.state.frame;
    expect(recoveredAt).toBeGreaterThan(DIFFICULTY.normal.reaction);
    sim.step({ p1: 0, p2: cpu.input(sim) });
    expect(decisions).toEqual([0, recoveredAt]);
    expect(me.state).toBe('attack');
  });

  it('持续行动超过反应间隔时，结束后不再追加一轮等待', () => {
    const sim = mk();
    const cpu = new Cpu(1, characterAi.akainu!, 'normal', 5);
    const decisions = scriptedDecisions(cpu, { kind: 'walk', dir: 1, frames: 20 });
    for (let f = 0; f <= 20; f++) sim.step({ p1: 0, p2: cpu.input(sim) });
    expect(decisions).toEqual([0, 20]);
  });

  it('真实重拳的命中定格和受击硬直结束后，不保留受击前的决策等待', () => {
    const sim = mk();
    sim.state.fighters[0].x = px(-70);
    sim.state.fighters[1].x = px(70);
    const cpu = new Cpu(1, characterAi.akainu!, 'normal', 5);
    const decisions = scriptedDecisions(cpu, { kind: 'wait', frames: 1 });
    const me = sim.state.fighters[1];
    sim.step({ p1: Btn.C, p2: cpu.input(sim) });
    while (me.hp === akainuDef.maxHp && sim.state.frame < 60) sim.step({ p1: 0, p2: cpu.input(sim) });
    expect(me.state).toBe('hit_stand');
    expect(me.hitstop).toBeGreaterThan(0);
    expect(me.stun).toBeGreaterThan(0);
    while (me.state === 'hit_stand' && sim.state.frame < 120) sim.step({ p1: 0, p2: cpu.input(sim) });
    expect(me.state).toBe('idle');
    const recoveredAt = sim.state.frame;
    cpu.input(sim);
    expect(decisions.at(-1)).toBe(recoveredAt);
  });

  it.each(['easy', 'normal', 'hard'] as Difficulty[])('%s：短行动和重复读取不能缩短逻辑帧反应间隔', (difficulty) => {
    const sim = mk();
    const cpu = new Cpu(1, characterAi.akainu!, difficulty, 5);
    const decisions = scriptedDecisions(cpu, { kind: 'wait', frames: 1 });
    const reaction = DIFFICULTY[difficulty].reaction;
    for (let f = 0; f <= reaction * 3; f++) {
      const input = cpu.input(sim);
      cpu.input(sim); // 同一逻辑帧查询两次，不得靠查询次数耗完决策等待。
      sim.step({ p1: 0, p2: input });
    }
    expect(decisions).toEqual([0, reaction, reaction * 2, reaction * 3]);
  });

  it('同一种子的普通对局包含受击和恢复时，输入与状态仍逐帧一致', () => {
    const run = () => {
      const sim = mk();
      const a = new Cpu(0, characterAi.luffy!, 'normal', 13);
      const b = new Cpu(1, characterAi.akainu!, 'normal', 19);
      const trace: number[][] = [];
      let contacts = 0;
      for (let f = 0; f < 1800 && sim.state.phase === 'fight'; f++) {
        const p1 = a.input(sim);
        const p2 = b.input(sim);
        sim.step({ p1, p2 });
        const [luffy, akainu] = sim.state.fighters;
        contacts += sim.hits.length;
        trace.push([p1, p2, luffy.hp, akainu.hp, luffy.x, akainu.x, luffy.stateFrame, akainu.stateFrame]);
      }
      expect(contacts).toBeGreaterThan(0);
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
