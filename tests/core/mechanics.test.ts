import { describe, expect, it } from 'vitest';
import { Btn, FightSim, GETUP_FRAMES, KNOCKDOWN_FRAMES, balance, px, type FightSimOptions } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const mk = (extra: Partial<FightSimOptions> = {}) =>
  new FightSim({ p1: luffyDef, p2: akainuDef, seed: 5, introFrames: 0, roundTime: -1, ...extra });
const dmg = (def: typeof luffyDef, id: string) => def.moves.find((m) => m.id === id)!.damage;
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};
/** 走到贴身，再松开两帧（让之后的 6 是"新按下"） */
const closeIn = (sim: FightSim) => {
  run(sim, Btn.Right, Btn.Left, 120);
  run(sim, 0, 0, 2);
};
const seqP1 = (sim: FightSim, inputs: number[]) => {
  for (const b of inputs) sim.step({ p1: b, p2: 0 });
};
const seqP2 = (sim: FightSim, inputs: number[]) => {
  for (const b of inputs) sim.step({ p1: 0, p2: b });
};
/**
 * P2 面朝左：前 = Left，后 = Right。
 * 236 = Down, Down|Left, Left     214 = Down, Down|Right, Right
 * 623 = Left, 中立, Down, Down|Left  22 = Down, 中立, Down
 */
const P2 = {
  qcf: (btn: number) => [Btn.Down, Btn.Down | Btn.Left, Btn.Left | btn],
  qcb: (btn: number) => [Btn.Down, Btn.Down | Btn.Right, Btn.Right | btn],
  dp: (btn: number) => [Btn.Left, 0, Btn.Down, Btn.Down | Btn.Left | btn],
  dd: (btn: number) => [Btn.Down, 0, Btn.Down | btn],
};
const P1 = {
  qcf: (btn: number) => [Btn.Down, Btn.Down | Btn.Right, Btn.Right | btn],
  dp: (btn: number) => [Btn.Right, 0, Btn.Down, Btn.Down | Btn.Right | btn],
  dd: (btn: number) => [Btn.Down, 0, Btn.Down | btn],
  qcfx2: (btn: number) => [Btn.Down, Btn.Right, Btn.Down, Btn.Right, Btn.Right | btn],
};
const collect = (sim: FightSim, frames: number, p1 = 0, p2 = 0) => {
  const events = [];
  for (let i = 0; i < frames; i++) {
    sim.step({ p1, p2 });
    events.push(...sim.hits);
  }
  return events;
};

describe('projectiles', () => {
  it('犬噛红莲：生成飞行道具，飞行后命中远处对手', () => {
    const sim = mk();
    const hp0 = sim.state.fighters[0].hp;
    seqP2(sim, P2.qcb(Btn.C));
    expect(sim.state.fighters[1].moveId).toBe('sp_inugami');
    run(sim, 0, 0, 14);
    expect(sim.state.projectiles.length).toBe(1);
    expect(sim.state.projectiles[0]!.kind).toBe('dog');
    expect(sim.state.projectiles[0]!.vx).toBeLessThan(0); // 向左飞
    const events = collect(sim, 90);
    const hit = events.find((e) => e.kind === 'hit');
    expect(hit?.projectile).toBe(true);
    expect(hit?.attacker).toBe(1);
    expect(sim.state.fighters[0].hp).toBe(hp0 - dmg(akainuDef, 'sp_inugami'));
    expect(sim.state.fighters[0].burnFrames).toBe(0); // 犬噛红莲本身不带灼烧
    expect(sim.state.projectiles.length).toBe(0); // 命中后消失
  });

  it('飞行道具可被防御', () => {
    const sim = mk();
    const hp0 = sim.state.fighters[0].hp;
    seqP2(sim, P2.qcb(Btn.C));
    const events = collect(sim, 120, Btn.Left, 0); // P1 按后防御
    expect(events.some((e) => e.kind === 'block' && e.projectile)).toBe(true);
    expect(sim.state.fighters[0].hp).toBe(hp0);
  });

  it('橡胶气球弹反：道具反向、归属换成路飞，打回赤犬', () => {
    const sim = mk();
    const hp0 = sim.state.fighters[1].hp;
    seqP2(sim, P2.qcb(Btn.C));
    run(sim, 0, 0, 14);
    // 道具从 x≈130 以 4.5 px/帧 向左飞，约 25 帧后到 P1；气球 active 22 帧，提前 6 帧起
    run(sim, 0, 0, 12);
    seqP1(sim, P1.dd(Btn.A)); // 22P
    expect(sim.state.fighters[0].moveId).toBe('sp_balloon');
    let reflected = false;
    for (let i = 0; i < 40 && !reflected; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.some((e) => e.kind === 'reflect')) reflected = true;
    }
    expect(reflected).toBe(true);
    const p = sim.state.projectiles[0];
    expect(p?.owner).toBe(0);
    expect(p?.vx).toBeGreaterThan(0);
    expect(p?.reflected).toBe(true);
    const later = collect(sim, 120);
    expect(later.some((e) => e.kind === 'hit' && e.attacker === 0 && e.projectile)).toBe(true);
    expect(sim.state.fighters[1].hp).toBeLessThan(hp0);
  });

  it('流星火山：三颗从天而降，落地消失', () => {
    const sim = mk();
    closeIn(sim);
    seqP2(sim, P2.qcb(Btn.B)); // 214K
    expect(sim.state.fighters[1].moveId).toBe('sp_meteor');
    expect(Math.max(...akainuDef.moves.find((m) => m.id === 'sp_meteor')!.frames.map((f) => f.sprite))).toBe(2);
    run(sim, 0, 0, 30);
    expect(sim.state.projectiles.length).toBe(3);
    expect(sim.state.projectiles.every((p) => p.kind === 'meteor' && p.vy > 0)).toBe(true);
    const events = collect(sim, 120);
    expect(sim.state.projectiles.length).toBe(0);
    const hit = events.find((e) => e.kind === 'hit' && e.projectile);
    if (hit) expect(sim.state.fighters[0].burnFrames).toBeGreaterThan(0);
  });

  it('双方飞行道具相碰对消（赤犬镜像对局，双方同时发犬噛红莲）', () => {
    const sim = new FightSim({ p1: akainuDef, p2: akainuDef, seed: 5, introFrames: 0, roundTime: -1 });
    // P1 面朝右：214 = Down, Down|Left, Left；P2 面朝左：214 = Down, Down|Right, Right
    const p1 = [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.C];
    const p2 = P2.qcb(Btn.C);
    for (let i = 0; i < 3; i++) sim.step({ p1: p1[i]!, p2: p2[i]! });
    expect(sim.state.fighters[0].moveId).toBe('sp_inugami');
    expect(sim.state.fighters[1].moveId).toBe('sp_inugami');
    run(sim, 0, 0, 15);
    expect(sim.state.projectiles.length).toBe(2);
    const events = collect(sim, 60);
    expect(events.some((e) => e.kind === 'clash')).toBe(true);
    expect(sim.state.projectiles.length).toBe(0);
    expect(sim.state.fighters[0].hp).toBe(akainuDef.maxHp);
    expect(sim.state.fighters[1].hp).toBe(akainuDef.maxHp);
  });
});

describe('armor', () => {
  it('贴身 236+C 出特殊技而不是投技', () => {
    const sim = mk();
    closeIn(sim);
    seqP2(sim, P2.qcf(Btn.C));
    expect(sim.state.fighters[1].moveId).toBe('sp_daifunka');
    expect(sim.state.fighters[1].state).toBe('attack');
  });

  it('大喷火启动期吃一下轻拳不中断（扣血、ARMOR 事件），第二下会被打断', () => {
    const sim = mk();
    closeIn(sim);
    seqP2(sim, P2.qcf(Btn.C)); // 大喷火 startup 18
    const hp0 = sim.state.fighters[1].hp;
    sim.step({ p1: Btn.A, p2: 0 });
    const ev = collect(sim, 8);
    expect(ev.some((e) => e.kind === 'armor')).toBe(true);
    expect(sim.state.fighters[1].state).toBe('attack');
    expect(sim.state.fighters[1].moveId).toBe('sp_daifunka');
    expect(sim.state.fighters[1].hp).toBe(hp0 - dmg(luffyDef, 'st_a'));
    for (let i = 0; i < 12 && sim.state.fighters[0].hitstop > 0; i++) sim.step({ p1: 0, p2: 0 });
    sim.step({ p1: Btn.A, p2: 0 });
    const ev2 = collect(sim, 8);
    expect(ev2.some((e) => e.kind === 'hit')).toBe(true);
  });

  it('橡胶回旋弹无视霸体', () => {
    const sim = mk();
    closeIn(sim);
    seqP2(sim, P2.qcf(Btn.C));
    seqP1(sim, P1.dp(Btn.C)); // 623P
    expect(sim.state.fighters[0].moveId).toBe('sp_rifle');
    const ev = collect(sim, 30);
    expect(ev.some((e) => e.kind === 'hit' && e.attacker === 0)).toBe(true);
    expect(ev.some((e) => e.kind === 'armor')).toBe(false);
  });
});

describe('install: 二档', () => {
  it('22K 消耗 1 气进入二档：移速变快、特殊技伤害 +15%、启动加速；到时疲劳减速', () => {
    const base = mk();
    run(base, Btn.Right, 0, 10);
    const walkNormal = base.state.fighters[0].vx;
    expect(walkNormal).toBeGreaterThan(0);

    const sim = mk();
    sim.state.fighters[0].meter = 100;
    seqP1(sim, P1.dd(Btn.B));
    expect(sim.state.fighters[0].moveId).toBe('sp_gear2');
    expect(sim.state.fighters[0].install).toBe('gear2');
    expect(sim.state.fighters[0].meter).toBe(0);
    run(sim, 0, 0, 30);
    run(sim, Btn.Right, 0, 5);
    const walkG2 = sim.state.fighters[0].vx;
    expect(walkG2).toBe(Math.floor((walkNormal * 13) / 10));

    // 机关枪伤害：22 → 25，启动跳过 3 帧
    closeIn(sim);
    seqP1(sim, P1.qcf(Btn.A));
    expect(sim.state.fighters[0].moveId).toBe('sp_gatling');
    expect(sim.state.fighters[0].stateFrame).toBe(balance.GEAR_SECOND.specialStartupSkip);
    const ev = collect(sim, 30);
    const first = ev.find((e) => e.kind === 'hit');
    expect(first?.damage).toBe(Math.floor((dmg(luffyDef, 'sp_gatling') * 23) / 20));

    // 到时：疲劳
    run(sim, 0, 0, sim.state.fighters[0].installFrames);
    expect(sim.state.fighters[0].install).toBeNull();
    expect(sim.state.fighters[0].fatigueFrames).toBeGreaterThan(0);
    run(sim, Btn.Right, 0, 5);
    expect(sim.state.fighters[0].vx).toBeLessThan(walkNormal);
    run(sim, 0, 0, balance.GEAR_SECOND.fatigueFrames);
    run(sim, Btn.Right, 0, 5);
    expect(sim.state.fighters[0].vx).toBe(walkNormal);
  });

  it('气不够不能开二档', () => {
    const sim = mk();
    seqP1(sim, P1.dd(Btn.B));
    expect(sim.state.fighters[0].moveId).not.toBe('sp_gear2');
    expect(sim.state.fighters[0].install).toBeNull();
  });
});

describe('burn', () => {
  it('灼烧按 BURN.dps 每秒扣血持续 3 秒，结束后不再掉，不会把血打到 0', () => {
    const sim = mk();
    const d = sim.state.fighters[0];
    d.burnFrames = balance.BURN.frames;
    d.burnDps = balance.BURN.dps;
    const hp0 = d.hp;
    run(sim, 0, 0, 60);
    expect(hp0 - sim.state.fighters[0].hp).toBe(balance.BURN.dps);
    run(sim, 0, 0, 120);
    expect(hp0 - sim.state.fighters[0].hp).toBe(balance.BURN.dps * 3);
    expect(sim.state.fighters[0].burnFrames).toBe(0);
    run(sim, 0, 0, 60);
    expect(hp0 - sim.state.fighters[0].hp).toBe(balance.BURN.dps * 3);

    const low = mk();
    low.state.fighters[0].hp = 3;
    low.state.fighters[0].burnFrames = 600;
    low.state.fighters[0].burnDps = 60;
    run(low, 0, 0, 120);
    expect(low.state.fighters[0].hp).toBe(1);
    expect(low.state.phase).toBe('fight');
  });

  it('赤犬投技附加灼烧；大喷火命中也附加', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: 0, p2: Btn.Left | Btn.C }); // P2 前投
    expect(sim.state.fighters[1].state).toBe('throw');
    run(sim, 0, 0, 30);
    expect(sim.state.fighters[0].burnFrames).toBeGreaterThan(0);
  });
});

describe('command grab & dodge', () => {
  it('冥狗：抓取框碰到可抓对手即抓住，不可拆投，结算伤害 + 灼烧', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[0].hp;
    seqP2(sim, P2.dp(Btn.C));
    expect(sim.state.fighters[1].moveId).toBe('sp_meigou');
    let grabbed = false;
    for (let i = 0; i < 20 && !grabbed; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.state.fighters[1].state === 'throw') grabbed = true;
    }
    expect(grabbed).toBe(true);
    expect(sim.state.fighters[0].state).toBe('thrown');
    sim.step({ p1: Btn.C, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('thrown'); // 不可拆
    run(sim, 0, 0, 40);
    // 140 投技伤害 + 释放后几帧的灼烧
    expect(sim.state.fighters[0].hp).toBeLessThanOrEqual(hp0 - 140);
    expect(sim.state.fighters[0].hp).toBeGreaterThanOrEqual(hp0 - 140 - 4);
    expect(sim.state.fighters[0].burnFrames).toBeGreaterThan(0);
    run(sim, 0, 0, KNOCKDOWN_FRAMES + GETUP_FRAMES + 60);
    expect(sim.state.fighters[1].state).toBe('idle');
  });

  it('冥狗抓空则走完招式收招', () => {
    const sim = mk();
    seqP2(sim, P2.dp(Btn.C));
    expect(sim.state.fighters[1].moveId).toBe('sp_meigou');
    run(sim, 0, 0, 20);
    expect(sim.state.fighters[1].state).toBe('attack');
    run(sim, 0, 0, 30);
    expect(sim.state.fighters[1].state).toBe('idle');
  });

  it('熔岩化：耗 1/3 气，20 帧对打击与投技全无敌', () => {
    const sim = mk();
    closeIn(sim);
    sim.state.fighters[1].meter = 50;
    seqP2(sim, P2.dd(Btn.A)); // 22P
    expect(sim.state.fighters[1].moveId).toBe('sp_magma_body');
    expect(sim.state.fighters[1].meter).toBe(50 - balance.DODGE_COST);
    const d = sim.state.fighters[1];
    expect(sim.isStrikeInvulnerable(d)).toBe(true);
    expect(sim.isThrowable(d)).toBe(false);
    const hp0 = d.hp;
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 }); // 投不到 → 变普通技，也打不中
    expect(sim.state.fighters[0].state).toBe('attack');
    run(sim, 0, 0, 12);
    expect(sim.state.fighters[1].hp).toBe(hp0);
    run(sim, 0, 0, 10);
    expect(sim.isStrikeInvulnerable(sim.state.fighters[1])).toBe(false);
  });
});

describe('command normals & ultimate', () => {
  it('j.2D 橡胶战斧 与 j.D 区分', () => {
    const a = mk();
    run(a, Btn.Up, 0, 6);
    a.step({ p1: Btn.Down | Btn.D, p2: 0 });
    expect(a.state.fighters[0].moveId).toBe('j_2d');
    const b = mk();
    run(b, Btn.Up, 0, 6);
    b.step({ p1: Btn.D, p2: 0 });
    expect(b.state.fighters[0].moveId).toBe('j_d');
  });

  it('火拳铳需要 3 气，无视霸体，命中硬倒', () => {
    const sim = mk();
    closeIn(sim);
    sim.state.fighters[0].meter = 300;
    seqP1(sim, P1.qcfx2(Btn.D));
    expect(sim.state.fighters[0].moveId).toBe('ult_red_hawk');
    expect(sim.state.fighters[0].meter).toBe(0);
    const ev = collect(sim, 60);
    expect(ev.filter((e) => e.kind === 'hit').length).toBeGreaterThanOrEqual(1);
    expect(sim.state.fighters[1].hardKnockdown).toBe(true);
  });

  it('气不足 3 格时 236236K 退化为 236K（橡胶火箭）', () => {
    const sim = mk();
    sim.state.fighters[0].meter = 200;
    seqP1(sim, P1.qcfx2(Btn.D));
    expect(sim.state.fighters[0].moveId).toBe('sp_rocket');
  });

  it('橡胶火箭 active 期间高速前进', () => {
    const sim = mk();
    const x0 = sim.state.fighters[0].x;
    seqP1(sim, P1.qcf(Btn.B));
    expect(sim.state.fighters[0].moveId).toBe('sp_rocket');
    run(sim, 0, 0, 20);
    expect(sim.state.fighters[0].x - x0).toBeGreaterThan(px(80));
  });
});
