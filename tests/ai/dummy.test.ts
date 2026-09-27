import { describe, expect, it } from 'vitest';
import { Btn, FightSim } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { Dummy } from '../../src/ai/dummy';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 9, introFrames: 0, roundTime: -1 });

describe('Dummy', () => {
  it('human 模式返回 null；stand 返回 0；crouch 返回 Down', () => {
    const sim = mk();
    const d = new Dummy();
    d.mode = 'human';
    expect(d.input(sim, 1)).toBeNull();
    d.mode = 'stand';
    expect(d.input(sim, 1)).toBe(0);
    d.mode = 'crouch';
    expect(d.input(sim, 1)).toBe(Btn.Down);
  });

  it('block 模式：默认蹲防，对手出中段技时站防；方向按面向取后方', () => {
    const sim = mk();
    const d = new Dummy();
    d.mode = 'block';
    // P2 面朝左 → 后 = Right
    expect(d.input(sim, 1)).toBe(Btn.Right | Btn.Down);
    // P1 在投技范围外出橡胶钟（high）
    for (let i = 0; i < 120; i++) sim.step({ p1: Btn.Right, p2: Btn.Left });
    for (let i = 0; i < 15; i++) sim.step({ p1: Btn.Left, p2: 0 });
    sim.step({ p1: 0, p2: 0 });
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('f_c');
    expect(d.input(sim, 1)).toBe(Btn.Right);
  });

  it('block 木桩能挡住路飞的连段压制（不掉血）', () => {
    const sim = mk();
    const d = new Dummy();
    d.mode = 'block';
    for (let i = 0; i < 120; i++) sim.step({ p1: Btn.Right, p2: d.input(sim, 1)! });
    const hp0 = sim.state.fighters[1].hp;
    const seq = [Btn.A, 0, Btn.C, 0, Btn.Down | Btn.B, 0, Btn.Down | Btn.D, 0];
    for (let i = 0; i < 200; i++) sim.step({ p1: seq[i % seq.length]!, p2: d.input(sim, 1)! });
    expect(sim.state.fighters[1].hp).toBe(hp0);
  });

  it('jump 模式在地面时按上，空中不输入', () => {
    const sim = mk();
    const d = new Dummy();
    d.mode = 'jump';
    expect(d.input(sim, 1)).toBe(Btn.Up);
    for (let i = 0; i < 6; i++) sim.step({ p1: 0, p2: d.input(sim, 1)! });
    expect(sim.state.fighters[1].airborne).toBe(true);
    expect(d.input(sim, 1)).toBe(0);
  });

  it('F5 循环模式', () => {
    const d = new Dummy();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      seen.add(d.mode);
      d.next();
    }
    expect(seen.size).toBe(8);
    expect(d.mode).toBe('stand');
  });

  it('attack 模式：远了走近，近了出轻拳', () => {
    const sim = mk();
    const d = new Dummy();
    d.mode = 'attack';
    expect(d.input(sim, 1)).toBe(Btn.Left);
    sim.state.fighters[1]!.x = sim.state.fighters[0]!.x + 10;
    expect(d.input(sim, 1)).toBe(Btn.A);
  });

  it('tech 模式在浮空 / 倒地时按 A，站立不输入', () => {
    const sim = mk();
    const d = new Dummy();
    d.mode = 'tech';
    expect(d.input(sim, 1)).toBe(0);
    sim.state.fighters[1]!.state = 'hit_air';
    expect(d.input(sim, 1)).toBe(Btn.A);
    sim.state.fighters[1]!.state = 'knockdown';
    expect(d.input(sim, 1)).toBe(Btn.A);
  });
});
