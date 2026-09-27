import { describe, expect, it } from 'vitest';
import { Btn, FightSim, GROUND_Y, MAX_SEPARATION, PREJUMP_FRAMES, STAGE_LEFT, SUBPIXEL } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 42, introFrames: 0 });
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};

describe('FightSim', () => {
  it('初始面向：P1 朝右，P2 朝左', () => {
    const s = mk().state;
    expect(s.fighters[0].facing).toBe(1);
    expect(s.fighters[1].facing).toBe(-1);
  });

  it('前进 / 后退按面向解释', () => {
    const sim = mk();
    const x0 = sim.state.fighters[0].x;
    run(sim, Btn.Right, 0, 10);
    expect(sim.state.fighters[0].x).toBeGreaterThan(x0);
    expect(sim.state.fighters[0].state).toBe('walk_fwd');
    // P2 面朝左，按 Right 是后退
    const x2 = sim.state.fighters[1].x;
    run(sim, 0, Btn.Right, 10);
    expect(sim.state.fighters[1].x).toBeGreaterThan(x2);
    expect(sim.state.fighters[1].state).toBe('walk_back');
  });

  it('跳跃经过 prejump 后离地并落回地面，空中不可转向', () => {
    const sim = mk();
    run(sim, Btn.Up, 0, 1);
    expect(sim.state.fighters[0].state).toBe('prejump');
    run(sim, Btn.Up, 0, PREJUMP_FRAMES);
    const f = sim.state.fighters[0];
    expect(f.airborne).toBe(true);
    expect(f.state).toBe('jump_neutral');
    run(sim, Btn.Left, 0, 120);
    expect(sim.state.fighters[0].airborne).toBe(false);
    expect(sim.state.fighters[0].y).toBe(GROUND_Y);
  });

  it('pushbox 不重叠', () => {
    const sim = mk();
    run(sim, Btn.Right, Btn.Left, 300); // 双方一直向对方走
    const [a, b] = sim.state.fighters;
    const ba = sim.pushbox(a);
    const bb = sim.pushbox(b);
    expect(ba.x + ba.w).toBeLessThanOrEqual(bb.x);
  });

  it('不能走出舞台，且间距不超过上限', () => {
    const sim = mk();
    run(sim, Btn.Left, Btn.Right, 2000);
    const [a, b] = sim.state.fighters;
    expect(a.x).toBeGreaterThanOrEqual(STAGE_LEFT);
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(MAX_SEPARATION);
  });

  it('确定性：相同输入序列产生相同状态', () => {
    const a = mk();
    const b = mk();
    const seq = [Btn.Right, Btn.Up | Btn.Right, 0, Btn.Down, Btn.Left, 0];
    for (let i = 0; i < 600; i++) {
      const p1 = seq[i % seq.length]!;
      const p2 = seq[(i * 7) % seq.length]!;
      a.step({ p1, p2 });
      b.step({ p1, p2 });
    }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(Number.isInteger(a.state.fighters[0].x)).toBe(true); // 整数子像素
    expect(SUBPIXEL).toBe(256);
  });
});
