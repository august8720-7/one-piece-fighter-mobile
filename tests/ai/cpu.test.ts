import { describe, expect, it } from 'vitest';
import { ANY_ATTACK, Btn, FightSim, LOGIC_FPS, px } from '../../src/core';
import { akainuDef, characterAi, luffyDef } from '../../src/characters';
import { Cpu } from '../../src/ai/cpu';
import { Dummy } from '../../src/ai/dummy';
import { DIFFICULTY, type AiProfile, type Difficulty } from '../../src/ai/types';

const VALID = Btn.Up | Btn.Down | Btn.Left | Btn.Right | ANY_ATTACK | Btn.Start;

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 3, introFrames: 0, roundTime: -1 });

/** CPU（P2）打站桩 P1，返回用到的帧数（-1 = 超时未 KO） */
function cpuVsStanding(diff: Difficulty, cpuChar: 'akainu' | 'luffy', seed: number, maxFrames: number): { frames: number; hpLeft: number } {
  const sim =
    cpuChar === 'akainu'
      ? new FightSim({ p1: luffyDef, p2: akainuDef, seed, introFrames: 0, roundTime: -1 })
      : new FightSim({ p1: akainuDef, p2: luffyDef, seed, introFrames: 0, roundTime: -1 });
  const cpu = new Cpu(1, characterAi[cpuChar]!, diff, seed);
  for (let f = 0; f < maxFrames; f++) {
    const bits = cpu.input(sim);
    expect(bits & ~VALID).toBe(0);
    sim.step({ p1: 0, p2: bits });
    if (sim.state.phase !== 'fight') return { frames: f, hpLeft: sim.state.fighters[0].hp };
  }
  return { frames: -1, hpLeft: sim.state.fighters[0].hp };
}

describe('Cpu', () => {
  it('首次防御抽签未选中时，中立决策也不能绕过反应延迟', () => {
    const wait = [{ weight: 1, action: { kind: 'wait' as const, frames: 8 } }];
    const profile: AiProfile = { ...characterAi.akainu!, closeRange: -1, midRange: 999, close: wait, mid: wait, far: wait, punish: [] };
    delete profile.armorBreak;
    const earlySeeds: number[] = [];
    for (let seed = 1; seed <= 64; seed++) {
      const sim = mk();
      sim.state.fighters[0].x = px(-20);
      sim.state.fighters[1].x = px(20);
      sim.step({ p1: Btn.C, p2: 0 });
      const cpu = new Cpu(1, profile, 'normal', seed);
      if (cpu.input(sim) & Btn.Right) earlySeeds.push(seed);
    }
    expect(earlySeeds).toEqual([]);
  });
  it('普通难度赤犬 60 秒内 KO 站桩', () => {
    const r = cpuVsStanding('normal', 'akainu', 11, 60 * LOGIC_FPS);
    expect(r.frames).toBeGreaterThan(0);
  });

  it('普通难度路飞 60 秒内 KO 站桩', () => {
    const r = cpuVsStanding('normal', 'luffy', 12, 60 * LOGIC_FPS);
    expect(r.frames).toBeGreaterThan(0);
  });

  it('简单难度也能造成明显伤害（不至于呆站）', () => {
    const r = cpuVsStanding('easy', 'akainu', 13, 60 * LOGIC_FPS);
    expect(r.frames > 0 || r.hpLeft < luffyDef.maxHp * 0.85).toBe(true);
  });

  it('困难 AI 看到贴身重拳起手，在反应窗口内按住防御（10 个种子中至少 8 个）', () => {
    let blocked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const sim = mk();
      for (let i = 0; i < 120; i++) sim.step({ p1: Btn.Right, p2: Btn.Left });
      sim.step({ p1: 0, p2: 0 });
      const cpu = new Cpu(1, characterAi['akainu']!, 'hard', seed);
      sim.step({ p1: Btn.C, p2: cpu.input(sim) }); // 路飞起手 橡胶手枪（startup 9）
      let sawBlock = false;
      for (let f = 0; f < 8; f++) {
        const bits = cpu.input(sim);
        sim.step({ p1: 0, p2: bits });
        if (bits & Btn.Right) sawBlock = true; // P2 面朝左，Right = 后
        if (sim.hits.some((e) => e.kind === 'block')) sawBlock = true;
      }
      if (sawBlock) blocked++;
    }
    expect(blocked).toBeGreaterThanOrEqual(8);
  });

  it('简单 AI 防御率明显低于困难 AI', () => {
    const rate = (diff: Difficulty) => {
      let blocked = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const sim = mk();
        for (let i = 0; i < 120; i++) sim.step({ p1: Btn.Right, p2: Btn.Left });
        sim.step({ p1: 0, p2: 0 });
        const cpu = new Cpu(1, characterAi['akainu']!, diff, seed);
        sim.step({ p1: Btn.C, p2: cpu.input(sim) });
        for (let f = 0; f < 16; f++) {
          sim.step({ p1: 0, p2: cpu.input(sim) });
          if (sim.hits.some((e) => e.kind === 'block')) {
            blocked++;
            break;
          }
        }
      }
      return blocked;
    };
    expect(rate('hard')).toBeGreaterThan(rate('easy'));
  });

  it('确定性：同一种子两次对局逐帧一致', () => {
    const run = () => {
      const sim = new FightSim({ p1: luffyDef, p2: akainuDef, seed: 5, introFrames: 0, roundTime: -1 });
      const a = new Cpu(0, characterAi['luffy']!, 'hard', 7);
      const b = new Cpu(1, characterAi['akainu']!, 'hard', 8);
      const trace: number[] = [];
      for (let f = 0; f < 1200; f++) {
        const p1 = a.input(sim);
        const p2 = b.input(sim);
        sim.step({ p1, p2 });
        trace.push(sim.state.fighters[0].hp, sim.state.fighters[1].hp, sim.state.fighters[0].x);
      }
      return trace.join(',');
    };
    expect(run()).toBe(run());
  });

  it('AI 会搓出特殊技（不只按普通技）', () => {
    const sim = mk();
    const cpu = new Cpu(1, characterAi['akainu']!, 'hard', 31);
    const used = new Set<string>();
    for (let f = 0; f < 30 * LOGIC_FPS; f++) {
      sim.step({ p1: 0, p2: cpu.input(sim) });
      const m = sim.state.fighters[1].moveId;
      if (m) used.add(m);
      if (sim.state.phase !== 'fight') break;
    }
    expect([...used].some((id) => id.startsWith('sp_'))).toBe(true);
  });

  it('AI 对 AI：一局能在 99 秒内分出胜负（不双双站桩）', () => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, seed: 9, introFrames: 0, roundTime: 99 });
    const a = new Cpu(0, characterAi['luffy']!, 'normal', 41);
    const b = new Cpu(1, characterAi['akainu']!, 'normal', 42);
    let f = 0;
    while (sim.state.phase === 'fight' && f < 100 * LOGIC_FPS) {
      sim.step({ p1: a.input(sim), p2: b.input(sim) });
      f++;
    }
    expect(sim.state.phase).toBe('round_end');
    const [l, k] = sim.state.fighters;
    expect(l.hp < luffyDef.maxHp || k.hp < akainuDef.maxHp).toBe(true);
    // 木桩接口兼容：Dummy 与 Cpu 都只产出位图
    expect(typeof new Dummy().input(sim, 1)).not.toBe('undefined');
  });

  it('路飞指定连段 st_a → st_c：命中后在取消窗口内执行，未命中不跳过硬直', () => {
    const profile: AiProfile = {
      ...characterAi['luffy']!,
      far: [{ weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } }],
      mid: [{ weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } }],
      close: [{ weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } }],
      confirmCombo: { from: 'st_a', action: { kind: 'normal', stance: 'stand', button: 'C' } },
    };
    const sim = new FightSim({ p1: akainuDef, p2: luffyDef, seed: 3, introFrames: 0, roundTime: -1 });
    sim.state.fighters[0].x = px(-20);
    sim.state.fighters[1].x = px(20);
    const cpu = new Cpu(1, profile, 'hard', 17);
    let sawConfirm = false;
    let illegalCancel = false;
    let prevMove: string | null = null;
    let prevHasHit = false;
    for (let f = 0; f < 20 * LOGIC_FPS; f++) {
      const me = sim.state.fighters[1];
      if (prevMove === 'st_a' && !prevHasHit && me.moveId === 'st_c') illegalCancel = true;
      if (prevMove === 'st_a' && prevHasHit && me.moveId === 'st_c' && me.state === 'attack') sawConfirm = true;
      prevMove = me.moveId;
      prevHasHit = me.hasHit;
      sim.step({ p1: 0, p2: cpu.input(sim) });
      if (sawConfirm) break;
    }
    expect(cpu.followupChecks).toBeGreaterThan(0);
    expect(sawConfirm).toBe(true);
    expect(illegalCancel).toBe(false);
  });

  it('赤犬指定连段 st_a → st_c 可复现', () => {
    const profile: AiProfile = {
      ...characterAi['akainu']!,
      far: [{ weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } }],
      mid: [{ weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } }],
      close: [{ weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } }],
      confirmCombo: { from: 'st_a', action: { kind: 'normal', stance: 'stand', button: 'C' } },
    };
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, seed: 3, introFrames: 0, roundTime: -1 });
    sim.state.fighters[0].x = px(-20);
    sim.state.fighters[1].x = px(20);
    const cpu = new Cpu(1, profile, 'hard', 19);
    let sawConfirm = false;
    for (let f = 0; f < 20 * LOGIC_FPS; f++) {
      const me = sim.state.fighters[1];
      if (me.moveId === 'st_c' && cpu.followupChecks > 0) sawConfirm = true;
      sim.step({ p1: 0, p2: cpu.input(sim) });
      if (sawConfirm) break;
    }
    expect(cpu.followupChecks).toBeGreaterThan(0);
    expect(sawConfirm).toBe(true);
  });

  it('困难 AI 看到起手后，反应帧内不立即输出防御方向', () => {
    const sim = mk();
    for (let i = 0; i < 120; i++) sim.step({ p1: Btn.Right, p2: Btn.Left });
    sim.step({ p1: 0, p2: 0 });
    const cpu = new Cpu(1, characterAi['akainu']!, 'hard', 3);
    sim.step({ p1: Btn.C, p2: 0 });
    let early = 0;
    for (let f = 0; f < DIFFICULTY.hard.reaction; f++) {
      const bits = cpu.input(sim);
      if (bits & Btn.Right) early++;
      sim.step({ p1: 0, p2: bits });
    }
    expect(early).toBe(0);
  });

  it('重拳命中后的多帧搓招不会在取消窗口里被反复重置', () => {
    const sim = mk();
    const me = sim.state.fighters[0];
    me.x = px(-35);
    sim.state.fighters[1].x = px(35);
    const profile: AiProfile = {
      ...characterAi['luffy']!,
      confirmCombo: { from: 'st_c', action: { kind: 'special', motion: '236', button: 'P' } },
      followups: [],
    };
    sim.step({ p1: Btn.C, p2: 0 });
    for (let f = 0; f < 30 && !me.hasHit; f++) sim.step({ p1: 0, p2: 0 });
    expect(me.hasHit).toBe(true);
    const cpu = new Cpu(0, profile, 'hard', 17);
    let executed = false;
    for (let f = 0; f < 35; f++) {
      sim.step({ p1: cpu.input(sim), p2: 0 });
      if (me.moveId === 'sp_gatling') {
        executed = true;
        break;
      }
    }
    expect(executed).toBe(true);
    expect(cpu.followupChecks).toBe(1); // 同一命中只选一次后续招式，逐帧把它输入完。
  });
});
