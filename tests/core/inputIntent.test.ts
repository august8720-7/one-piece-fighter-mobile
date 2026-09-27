import { describe, expect, it } from 'vitest';
import { Btn, FightSim, PREJUMP_FRAMES, px, type Facing } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const make = (facing: Facing = 1, distance = 40) => {
  const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
  const [a, b] = sim.state.fighters;
  a.x = px(-distance / 2) * facing;
  b.x = px(distance / 2) * facing;
  a.facing = facing;
  b.facing = facing === 1 ? -1 : 1;
  return sim;
};

function untilContact(sim: FightSim, p2 = 0): void {
  for (let i = 0; i < 60 && !sim.state.fighters[0].hasHit; i++) sim.step({ p1: 0, p2 });
  expect(sim.state.fighters[0].hasHit).toBe(true);
}

function releaseHitstop(sim: FightSim, p2 = 0): void {
  for (let i = 0; i < 30 && sim.state.fighters[0].hitstop > 0; i++) sim.step({ p1: 0, p2 });
  sim.step({ p1: 0, p2 });
}

describe('buffered attack intent', () => {
  for (const facing of [1, -1] as const) {
    for (const guarded of [false, true]) {
      it(`朝向 ${facing}，吹飞${guarded ? '被挡' : '命中'}后立即搓招与稍晚搓招均可取消`, () => {
        for (const delay of [0, 5]) {
          const sim = make(facing);
          const forward = facing === 1 ? Btn.Right : Btn.Left;
          const p2 = guarded ? forward : 0;
          sim.step({ p1: Btn.C | Btn.D, p2 });
          untilContact(sim, p2);
          for (let i = 0; i < delay; i++) sim.step({ p1: 0, p2 });
          for (const p1 of [Btn.Down, Btn.Down | forward, forward | Btn.A]) sim.step({ p1, p2 });
          releaseHitstop(sim, p2);
          expect(sim.state.fighters[0].moveId).toBe('sp_gatling');
        }
      });
    }

    it(`朝向 ${facing}，定格中点下重脚再松开仍出蹲重脚`, () => {
      const sim = make(facing);
      sim.step({ p1: Btn.A, p2: 0 });
      untilContact(sim);
      sim.step({ p1: Btn.Down | Btn.D, p2: 0 });
      releaseHitstop(sim);
      expect(sim.state.fighters[0].moveId).toBe('cr_d');
    });

    it(`朝向 ${facing}，定格中点前重拳再松开仍出方向派生`, () => {
      const sim = make(facing);
      sim.step({ p1: Btn.A, p2: 0 });
      untilContact(sim);
      sim.step({ p1: (facing === 1 ? Btn.Right : Btn.Left) | Btn.C, p2: 0 });
      releaseHitstop(sim);
      expect(sim.state.fighters[0].moveId).toBe('f_c');
    });
  }

  it('定格中分开轻点 A 再 B，只执行最后的 B，不把两次输入拼成双键', () => {
    const sim = make();
    sim.step({ p1: Btn.A, p2: 0 });
    untilContact(sim);
    sim.step({ p1: Btn.A, p2: 0 });
    sim.step({ p1: Btn.B, p2: 0 });
    releaseHitstop(sim);
    expect(sim.state.fighters[0].moveId).toBe('st_b');
  });

  it('攻击按键之后补方向，不能把已经缓冲的普通技追认为特殊技', () => {
    const sim = make();
    sim.step({ p1: Btn.A, p2: 0 });
    untilContact(sim);
    sim.step({ p1: Btn.A, p2: 0 });
    sim.step({ p1: Btn.Down, p2: 0 });
    sim.step({ p1: Btn.Right, p2: 0 });
    releaseHitstop(sim);
    expect(sim.state.fighters[0].moveId).toBe('st_a');
    expect(sim.state.fighters[0].moveInstance).toBe(2);
  });

  it('空挥收招早期的缓冲仍按原窗口过期，不能自动排队到收招结束', () => {
    const sim = make(1, 300);
    sim.step({ p1: Btn.C, p2: 0 });
    sim.step({ p1: Btn.Down | Btn.D, p2: 0 });
    for (let i = 0; i < 60; i++) sim.step({ p1: 0, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('idle');
    expect(sim.state.fighters[0].moveInstance).toBe(1);
    expect(sim.state.fighters[1].hp).toBe(akainuDef.maxHp);
  });

  it('定格之外没有延长搓招窗口，过期的下前不被识别', () => {
    const sim = make(1, 300);
    sim.step({ p1: Btn.Down, p2: 0 });
    for (let i = 0; i < 12; i++) sim.step({ p1: 0, p2: 0 });
    sim.step({ p1: Btn.Right | Btn.A, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('st_a');
  });

  it('落地中轻点双重攻击再松开，仍缓冲为吹飞而非单键重拳', () => {
    const sim = make(1, 300);
    sim.step({ p1: Btn.Up, p2: 0 });
    for (let i = 0; i < 90 && sim.state.fighters[0].state !== 'landing'; i++) sim.step({ p1: 0, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('landing');
    sim.step({ p1: Btn.C | Btn.D, p2: 0 });
    for (let i = 0; i < 3; i++) sim.step({ p1: 0, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('cd');
  });
});

describe('short diagonal hops', () => {
  for (const facing of [1, -1] as const) {
    for (const relative of [1, -1] as const) {
      it(`朝向 ${facing}，轻点${relative === 1 ? '前' : '后'}斜上 1–3 帧后全部松开仍向指定方向小跳`, () => {
        for (const held of [1, 2, 3]) {
          const sim = make(facing, 300);
          const direction = facing * relative > 0 ? Btn.Right : Btn.Left;
          for (let i = 0; i < PREJUMP_FRAMES + 2; i++) {
            sim.step({ p1: i < held ? Btn.Up | direction : 0, p2: 0 });
          }
          const me = sim.state.fighters[0];
          expect(me.state).toBe(relative === 1 ? 'jump_fwd' : 'jump_back');
          expect(me.vx).toBe(facing * relative * luffyDef.movement.jumpVelocityX);
          const neutralHop = make(facing, 300);
          neutralHop.step({ p1: Btn.Up, p2: 0 });
          for (let i = 0; i < PREJUMP_FRAMES + 1; i++) neutralHop.step({ p1: 0, p2: 0 });
          expect(me.y).toBe(neutralHop.state.fighters[0].y);
        }
      });
    }
  }
});
