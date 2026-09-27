import { describe, expect, it } from 'vitest';
import {
  Btn,
  FightSim,
  LANDING_FRAMES,
  PREJUMP_FRAMES,
  STAGE_RIGHT,
  THROW_TECH_FRAMES,
  isDoubleTap,
  px,
} from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 3, introFrames: 0 });
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};
const closeIn = (sim: FightSim) => run(sim, Btn.Right, Btn.Left, 120);
/** 按住 p2 的防御输入，P1 出一招，推进直到出现事件或超时 */
const attackInto = (sim: FightSim, p1Move: number, p2Hold: number, timeout = 40) => {
  sim.step({ p1: p1Move, p2: p2Hold });
  for (let i = 0; i < timeout; i++) {
    sim.step({ p1: 0, p2: p2Hold });
    if (sim.hits.length) return sim.hits[0]!;
  }
  return null;
};

describe('guard', () => {
  it('站防挡住中段（mid）：不扣血、进入防御硬直、有 block 事件', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[1].hp;
    const ev = attackInto(sim, Btn.A, Btn.Right); // P2 面朝左，Right = 后
    expect(ev?.kind).toBe('block');
    const d = sim.state.fighters[1];
    expect(d.hp).toBe(hp0);
    expect(d.state).toBe('block_stand');
    expect(d.stun).toBeGreaterThan(0);
  });

  it('蹲防挡住下段（low），站防挡不住', () => {
    const a = mk();
    closeIn(a);
    const ev1 = attackInto(a, Btn.Down | Btn.B, Btn.Right | Btn.Down); // 路飞 cr_b 是 low
    expect(ev1?.kind).toBe('block');
    expect(a.state.fighters[1].state).toBe('block_crouch');

    const b = mk();
    closeIn(b);
    const ev2 = attackInto(b, Btn.Down | Btn.B, Btn.Right);
    expect(ev2?.kind).toBe('hit');
  });

  it('跳攻击（high）站防可挡，蹲防挡不住', () => {
    // P1 垂直跳，下落阶段按 D（约离地 18 帧），让攻击框落到蹲姿高度
    const jumpAttack = (p2Hold: number) => {
      const sim = mk();
      closeIn(sim);
      run(sim, Btn.Up, p2Hold, PREJUMP_FRAMES + 1);
      run(sim, 0, p2Hold, 18);
      sim.step({ p1: Btn.D, p2: p2Hold });
      for (let i = 0; i < 60; i++) {
        sim.step({ p1: 0, p2: p2Hold });
        if (sim.hits.length) return sim.hits[0]!;
      }
      return null;
    };
    expect(jumpAttack(Btn.Right)?.kind).toBe('block');
    expect(jumpAttack(Btn.Right | Btn.Down)?.kind).toBe('hit');
  });

  it('不按后方向就不防御', () => {
    const sim = mk();
    closeIn(sim);
    const ev = attackInto(sim, Btn.A, 0);
    expect(ev?.kind).toBe('hit');
  });

  it('防御击退小于命中击退', () => {
    const a = mk();
    closeIn(a);
    attackInto(a, Btn.C, Btn.Right);
    const vBlock = a.state.fighters[1].vx;
    const b = mk();
    closeIn(b);
    attackInto(b, Btn.C, 0);
    const vHit = b.state.fighters[1].vx;
    expect(vBlock).toBeGreaterThan(0);
    expect(vBlock).toBeLessThan(vHit);
  });
});

describe('throw', () => {
  it('贴身 6+C 投技：抓住 → 结算伤害 → 对手倒地', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[1].hp;
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('throw');
    expect(sim.state.fighters[1].state).toBe('thrown');
    expect(sim.hits[0]?.kind).toBe('throw');
    let released = false;
    for (let i = 0; i < 60 && !released; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.some((h) => h.kind === 'hit')) released = true;
    }
    expect(released).toBe(true);
    expect(sim.state.fighters[1].hp).toBe(hp0 - 110);
    expect(sim.state.fighters[1].state).toBe('hit_air');
    run(sim, 0, 0, 120);
    expect(sim.state.fighters[0].state).toBe('idle');
    expect(['knockdown', 'getup', 'idle']).toContain(sim.state.fighters[1].state);
  });

  it('距离不够时 6+C 出的是特殊普通技（橡胶钟），5C 是素技', () => {
    const sim = mk();
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('attack');
    expect(sim.state.fighters[0].moveId).toBe('f_c');
    const b = mk();
    b.step({ p1: Btn.C, p2: 0 });
    expect(b.state.fighters[0].moveId).toBe('st_c');
  });

  it('拆投窗口内按 C 拆投：无伤、双方弹开', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[1].hp;
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    run(sim, 0, 0, 3);
    sim.step({ p1: 0, p2: Btn.C });
    expect(sim.hits[0]?.kind).toBe('tech');
    expect(sim.state.fighters[0].state).toBe('throw_tech');
    expect(sim.state.fighters[1].state).toBe('throw_tech');
    expect(sim.state.fighters[1].hp).toBe(hp0);
    run(sim, 0, 0, THROW_TECH_FRAMES + 2);
    expect(sim.state.fighters[0].state).toBe('idle');
    expect(sim.state.fighters[1].state).toBe('idle');
  });

  it('拆投窗口过后按 C 无效', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    run(sim, 0, 0, 12);
    sim.step({ p1: 0, p2: Btn.C });
    expect(sim.state.fighters[1].state).toBe('thrown');
  });

  it('4+C 后投换边', () => {
    const sim = mk();
    closeIn(sim);
    const x0 = sim.state.fighters[0].x;
    sim.step({ p1: Btn.Left | Btn.C, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('throw_back');
    run(sim, 0, 0, 30);
    // 对手应在 P1 左侧（被甩到身后），P1 面向变为朝左
    expect(sim.state.fighters[1].x).toBeLessThan(x0);
    expect(sim.state.fighters[0].facing).toBe(-1);
  });

  it('空中 / 受击中的对手不可投', () => {
    const sim = mk();
    closeIn(sim);
    run(sim, 0, Btn.Up, PREJUMP_FRAMES + 2); // P2 起跳
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('attack'); // 变普通技
  });
});

describe('movement', () => {
  it('isDoubleTap：6 5 6 触发，长按不触发', () => {
    expect(isDoubleTap([5, 6, 5, 6], 1)).toBe(true);
    expect(isDoubleTap([6, 6, 6, 6], 1)).toBe(false);
    expect(isDoubleTap([5, 6, 6], 1)).toBe(false);
    expect(isDoubleTap([5, 4, 5, 4], -1)).toBe(true);
    // 斜方向也算同侧
    expect(isDoubleTap([5, 3, 5, 6], 1)).toBe(true);
    // 超出窗口
    const far = [6, ...new Array(12).fill(5), 6];
    expect(isDoubleTap(far, 1)).toBe(false);
  });

  it('66 前冲比行走快，松开停止', () => {
    const sim = mk();
    run(sim, Btn.Right, 0, 2);
    run(sim, 0, 0, 2);
    run(sim, Btn.Right, 0, 10);
    expect(sim.state.fighters[0].state).toBe('dash');
    expect(sim.state.fighters[0].vx).toBe(luffyDef.movement.runSpeed);
    run(sim, 0, 0, 1);
    expect(sim.state.fighters[0].state).toBe('idle');
  });

  it('44 后撤步：前段打击无敌，结束回 idle', () => {
    const sim = mk();
    closeIn(sim);
    run(sim, 0, Btn.Right, 2);
    run(sim, 0, 0, 2);
    sim.step({ p1: 0, p2: Btn.Right });
    const d = sim.state.fighters[1];
    expect(d.state).toBe('backdash');
    expect(sim.isStrikeInvulnerable(d)).toBe(true);
    run(sim, 0, 0, akainuDef.movement.backdashFrames + 1);
    expect(sim.state.fighters[1].state).toBe('idle');
  });

  it('A+B 翻滚：无敌期间打不中，可被投；结束后可被打', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: 0, p2: Btn.A | Btn.B });
    expect(sim.state.fighters[1].state).toBe('roll_fwd');
    expect(sim.hurtboxes(sim.state.fighters[1]).length).toBe(0);
    expect(sim.isThrowable(sim.state.fighters[1])).toBe(true);
    // P1 打一拳，应打空
    const hp0 = sim.state.fighters[1].hp;
    sim.step({ p1: Btn.A, p2: 0 });
    run(sim, 0, 0, 10);
    expect(sim.state.fighters[1].hp).toBe(hp0);
    // 翻滚穿过 P1 到背后
    run(sim, 0, 0, 30);
    expect(sim.state.fighters[1].state).toBe('idle');
    expect(sim.state.fighters[1].x).toBeLessThan(sim.state.fighters[0].x);
  });

  it('小跳：prejump 内松开上 → 跳得更低', () => {
    const hop = mk();
    hop.step({ p1: Btn.Up, p2: 0 });
    run(hop, 0, 0, PREJUMP_FRAMES + 1);
    expect(hop.state.fighters[0].airborne).toBe(true);
    const vyHop = hop.state.fighters[0].vy;

    const jump = mk();
    run(jump, Btn.Up, 0, PREJUMP_FRAMES + 2);
    expect(jump.state.fighters[0].airborne).toBe(true);
    const vyJump = jump.state.fighters[0].vy;
    expect(vyHop).toBeGreaterThan(vyJump); // 负数：小跳的向上速度更小

    // 小跳最高点更低
    let minHop = 0;
    let minJump = 0;
    for (let i = 0; i < 90; i++) {
      hop.step({ p1: 0, p2: 0 });
      jump.step({ p1: 0, p2: 0 });
      minHop = Math.min(minHop, hop.state.fighters[0].y);
      minJump = Math.min(minJump, jump.state.fighters[0].y);
    }
    expect(minHop).toBeGreaterThan(minJump);
  });

  it('落地有 landing 帧，期间不能出招但能防御；落地中按的键在可动后立即出招（按键缓冲）', () => {
    const sim = mk();
    run(sim, Btn.Up, 0, PREJUMP_FRAMES + 2);
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.state.fighters[0].state === 'landing') landed = true;
    }
    expect(landed).toBe(true);
    sim.step({ p1: Btn.A | Btn.Left, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('landing');
    expect(sim.isGuarding(sim.state.fighters[0])).toBe(true);
    run(sim, 0, 0, LANDING_FRAMES);
    expect(sim.state.fighters[0].state).toBe('attack');
    expect(sim.state.fighters[0].moveId).toBe('st_a');
  });
});

describe('blowback', () => {
  it('C+D 吹飞命中 → 浮空 → 撞墙反弹回来', () => {
    const sim = mk();
    // 把双方放到右墙附近
    closeIn(sim);
    run(sim, Btn.Right, Btn.Right, 400);
    expect(sim.state.fighters[1].x).toBeGreaterThan(STAGE_RIGHT - px(60));
    sim.step({ p1: Btn.C | Btn.D, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('cd');
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.some((h) => h.kind === 'hit')) hit = true;
    }
    expect(hit).toBe(true);
    const d = sim.state.fighters[1];
    expect(d.state).toBe('hit_air');
    expect(d.wallBounce).toBe(true);
    // 推进直到反弹（vx 变为负）
    let bounced = false;
    for (let i = 0; i < 60 && !bounced; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.state.fighters[1].vx < 0 && !sim.state.fighters[1].wallBounce) bounced = true;
    }
    expect(bounced).toBe(true);
  });
});
