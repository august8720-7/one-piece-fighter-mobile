import { describe, expect, it } from 'vitest';
import { Btn, FightSim, MAX_METER, px } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 9, introFrames: 0, roundTime: -1 });
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};

describe('training options', () => {
  it('infiniteMeter：气槽每帧回满', () => {
    const sim = mk();
    sim.training.infiniteMeter = true;
    sim.step({ p1: 0, p2: 0 });
    expect(sim.state.fighters[0].meter).toBe(MAX_METER);
    expect(sim.state.fighters[1].meter).toBe(MAX_METER);
  });

  it('infiniteHp：连段结束、双方回到中立后回满血；连段中不回', () => {
    const sim = mk();
    sim.training.infiniteHp = true;
    run(sim, Btn.Right, Btn.Left, 120);
    sim.step({ p1: Btn.C, p2: 0 });
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.some((h) => h.kind === 'hit')) hit = true;
    }
    expect(hit).toBe(true);
    expect(sim.state.fighters[1].hp).toBeLessThan(akainuDef.maxHp); // 受击中不回
    run(sim, 0, 0, 90);
    expect(sim.state.fighters[1].hp).toBe(akainuDef.maxHp);
  });

  it('resetPositions：回到初始位置与 idle，保留血量', () => {
    const sim = mk();
    run(sim, Btn.Right, Btn.Left, 60);
    sim.state.fighters[1].hp = 500;
    sim.resetPositions();
    expect(sim.state.fighters[0].x).toBe(px(-90));
    expect(sim.state.fighters[1].x).toBe(px(90));
    expect(sim.state.fighters[0].state).toBe('idle');
    expect(sim.state.fighters[1].hp).toBe(500);
    expect(sim.state.projectiles.length).toBe(0);
  });
});
