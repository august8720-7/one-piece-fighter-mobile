import { describe, expect, it } from 'vitest';
import {
  Btn,
  FightSim,
  INTRO_FRAMES,
  LOGIC_FPS,
  MAX_JUGGLE,
  ROUND_END_FRAMES,
  matchMotion,
  scaledDamage,
  type FightSimOptions,
} from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const mk = (extra: Partial<FightSimOptions> = {}) =>
  new FightSim({ p1: luffyDef, p2: akainuDef, seed: 11, introFrames: 0, ...extra });
const dmg = (def: typeof luffyDef, id: string) => def.moves.find((m) => m.id === id)!.damage;
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};
const closeIn = (sim: FightSim) => run(sim, Btn.Right, Btn.Left, 120);
/** P1 面朝右：2=Down 3=Down|Right 6=Right 4=Left 1=Down|Left */
const seq = (sim: FightSim, inputs: number[], p2 = 0) => {
  for (const b of inputs) sim.step({ p1: b, p2 });
};
const untilEvent = (sim: FightSim, kind: string, p1 = 0, p2 = 0, timeout = 60) => {
  for (let i = 0; i < timeout; i++) {
    sim.step({ p1, p2 });
    const e = sim.hits.find((h) => h.kind === kind);
    if (e) return e;
  }
  return null;
};
/** 熬过 P1 的打击定格，再走一帧（取消在定格结束后的第一个可动帧执行） */
const settle = (sim: FightSim, p2 = 0) => {
  for (let i = 0; i < 20 && sim.state.fighters[0].hitstop > 0; i++) sim.step({ p1: 0, p2 });
  sim.step({ p1: 0, p2 });
};

describe('matchMotion', () => {
  it('236 及其容错形式', () => {
    expect(matchMotion([5, 2, 3, 6], '236')).toBe(true);
    expect(matchMotion([5, 2, 6], '236')).toBe(true); // 跳过 3
    expect(matchMotion([5, 1, 2, 3, 6], '236')).toBe(true); // 蹲防起手
    expect(matchMotion([5, 6, 6, 6], '236')).toBe(false); // 没有 2
    expect(matchMotion([5, 3, 3, 3], '236')).toBe(false); // 只按住 3 不算
    expect(matchMotion([2, ...new Array(12).fill(5), 6], '236')).toBe(false); // 超时
  });
  it('214 / 623 / 22 / 236236', () => {
    expect(matchMotion([5, 2, 1, 4], '214')).toBe(true);
    expect(matchMotion([5, 6, 5, 2, 3], '623')).toBe(true);
    expect(matchMotion([5, 6, 2, 3], '623')).toBe(true);
    expect(matchMotion([5, 6, 2, 6], '623')).toBe(false); // 必须到 3
    expect(matchMotion([5, 6, 6, 6, 2, 3], '623')).toBe(true); // 刚按下 6 后短暂按住仍算
    expect(matchMotion([...new Array(20).fill(6), 2, 3], '623')).toBe(false); // 走路中的长按 6 不算起手
    expect(matchMotion([5, 2, 3, 6], '623')).toBe(false);
    expect(matchMotion([5, 2, 5, 2], '22')).toBe(true);
    expect(matchMotion([5, 2, 2, 2], '22')).toBe(false);
    expect(matchMotion([5, 2, 3, 6, 5, 2, 3, 6], '236236')).toBe(true);
    expect(matchMotion([5, 2, 3, 6], '236236')).toBe(false);
  });
});

describe('specials', () => {
  it('236 + P 出橡胶机关枪；按键可晚几帧（缓冲）', () => {
    const sim = mk();
    seq(sim, [Btn.Down, Btn.Down | Btn.Right, Btn.Right, 0, 0, Btn.A]);
    expect(sim.state.fighters[0].moveId).toBe('sp_gatling');
    expect(sim.state.fighters[0].state).toBe('attack');
  });

  it('623 + P 优先于 236（6-2-3 也包含 2-3）', () => {
    const sim = mk();
    seq(sim, [Btn.Right, 0, Btn.Down, Btn.Down | Btn.Right, Btn.Down | Btn.Right | Btn.C]);
    expect(sim.state.fighters[0].moveId).toBe('sp_rifle');
  });

  it('22 + K：收招时按着下也能出（地面搓招不分站蹲）', () => {
    const sim = mk();
    // P2 面朝左：Down|Left = 1（下前），纯 Down = 2
    for (const b of [Btn.Down, 0, Btn.Down, Btn.Down | Btn.B]) sim.step({ p1: 0, p2: b });
    expect(sim.state.fighters[1].moveId).toBe('sp_ground_split');
  });

  it('走路（长按 6）后接 236 不会被误判为 623', () => {
    const sim = mk();
    run(sim, Btn.Right, 0, 20);
    seq(sim, [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]);
    expect(sim.state.fighters[0].moveId).toBe('sp_gatling');
  });

  it('多段攻击每段独立命中，段间进入连段', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[1].hp;
    seq(sim, [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]);
    expect(sim.state.fighters[0].moveId).toBe('sp_gatling');
    let hits = 0;
    let maxCombo = 0;
    for (let i = 0; i < 100; i++) {
      sim.step({ p1: 0, p2: 0 }); // 5 段 + 每段 7 帧定格
      for (const e of sim.hits) if (e.kind === 'hit') hits++;
      maxCombo = Math.max(maxCombo, sim.state.fighters[1].comboHits);
    }
    expect(hp0 - sim.state.fighters[1].hp).toBeGreaterThan(dmg(luffyDef, 'sp_gatling') * 3);
    expect(hits).toBe(5);
    expect(maxCombo).toBe(5);
  });

  it('无气搓 236236 退化为 236 特殊技；有气则出超必杀并扣气', () => {
    const a = mk();
    seq(a, [Btn.Down, Btn.Right, Btn.Down, Btn.Right, Btn.Right | Btn.C]);
    expect(a.state.fighters[0].moveId).toBe('sp_gatling');

    const b = mk();
    b.state.fighters[0].meter = 150;
    seq(b, [Btn.Down, Btn.Right, Btn.Down, Btn.Right, Btn.Right | Btn.C]);
    expect(b.state.fighters[0].moveId).toBe('sp_storm');
    expect(b.state.fighters[0].meter).toBe(50);
    expect(b.isStrikeInvulnerable(b.state.fighters[0])).toBe(true); // 启动无敌
  });
});

describe('cancel chain', () => {
  it('轻拳命中后可取消进重拳，再取消进特殊技，再取消进超必杀', () => {
    const sim = mk();
    sim.state.fighters[0].meter = 100;
    closeIn(sim);
    // st_a
    sim.step({ p1: Btn.A, p2: 0 });
    expect(untilEvent(sim, 'hit')).not.toBeNull();
    // 定格中按 C → 定格结束后取消进 st_c（chain）
    sim.step({ p1: Btn.C, p2: 0 });
    settle(sim);
    expect(sim.state.fighters[0].moveId).toBe('st_c');
    expect(untilEvent(sim, 'hit')).not.toBeNull();
    // 定格中搓 236 + A → 机关枪
    seq(sim, [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]);
    settle(sim);
    expect(sim.state.fighters[0].moveId).toBe('sp_gatling');
    expect(untilEvent(sim, 'hit')).not.toBeNull();
    // 236236 + C → 暴风雨（超必杀）
    seq(sim, [Btn.Down, Btn.Right, Btn.Down, Btn.Right | Btn.C]);
    settle(sim);
    expect(sim.state.fighters[0].moveId).toBe('sp_storm');
    expect(sim.state.fighters[1].comboHits).toBeGreaterThanOrEqual(3);
  });

  it('未命中不能取消', () => {
    const sim = mk();
    sim.step({ p1: Btn.A, p2: 0 }); // 远距离打空
    run(sim, 0, 0, 3);
    sim.step({ p1: Btn.C, p2: 0 });
    expect(sim.state.fighters[0].moveId).toBe('st_a');
  });

  it('被防御也能取消（防御硬直连段压制）', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: Btn.A, p2: Btn.Right });
    expect(untilEvent(sim, 'block', 0, Btn.Right)).not.toBeNull();
    sim.step({ p1: Btn.C, p2: Btn.Right });
    settle(sim, Btn.Right);
    expect(sim.state.fighters[0].moveId).toBe('st_c');
  });

  it('重拳不能取消进轻拳（等级不够且不在 chain 内）', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: Btn.C, p2: 0 });
    expect(untilEvent(sim, 'hit')).not.toBeNull();
    sim.step({ p1: Btn.A, p2: 0 });
    settle(sim);
    expect(sim.state.fighters[0].moveId).toBe('st_c');
  });

  it('取消窗口过后不能取消', () => {
    const sim = mk();
    closeIn(sim);
    // st_c：startup 9 / active 4 / recovery 16，hitstop 11，默认窗口 12 帧
    sim.step({ p1: Btn.C, p2: 0 });
    expect(untilEvent(sim, 'hit')).not.toBeNull();
    run(sim, 0, 0, 11 + 13); // 熬过 hitstop，再走 13 帧 > 窗口
    const f = sim.state.fighters[0];
    expect(f.state).toBe('attack');
    expect(f.stateFrame).toBeGreaterThan(f.cancelUntil);
    seq(sim, [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]);
    expect(sim.state.fighters[0].moveId).toBe('st_c');
  });
});

describe('damage / counter / meter / juggle / tech', () => {
  it('连段衰减公式', () => {
    expect(scaledDamage(100, 1)).toBe(100);
    expect(scaledDamage(100, 2)).toBe(90);
    expect(scaledDamage(100, 5)).toBe(60);
    expect(scaledDamage(100, 8)).toBe(30);
    expect(scaledDamage(100, 20)).toBe(30);
  });

  it('连段第二段伤害打 9 折', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: Btn.A, p2: 0 });
    const e1 = untilEvent(sim, 'hit')!;
    expect(e1.damage).toBe(dmg(luffyDef, 'st_a'));
    expect(e1.comboHits).toBe(1);
    sim.step({ p1: Btn.C, p2: 0 });
    settle(sim);
    const e2 = untilEvent(sim, 'hit')!;
    expect(e2.comboHits).toBe(2);
    expect(e2.damage).toBe(Math.floor(dmg(luffyDef, 'st_c') * 0.9));
  });

  it('反击：打中对手出招前摇伤害 ×1.25 并标记 counter', () => {
    const sim = mk();
    closeIn(sim);
    // P2 出慢招（熔岩拳 startup 12），P1 同时出轻拳
    sim.step({ p1: Btn.A, p2: Btn.C });
    const e = untilEvent(sim, 'hit');
    expect(e?.attacker).toBe(0);
    expect(e?.counter).toBe(true);
    expect(e?.damage).toBe((dmg(luffyDef, 'st_a') * 5) >> 2);
  });

  it('命中双方积累气，攻击方更多；防御也涨少量', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: Btn.C, p2: 0 });
    untilEvent(sim, 'hit');
    const [a, d] = sim.state.fighters;
    expect(a.meter).toBeGreaterThan(d.meter);
    expect(d.meter).toBeGreaterThan(0);
  });

  it('浮空最多 MAX_JUGGLE 段，之后普通攻击打不中；超必杀不受限', () => {
    const sim = mk();
    closeIn(sim);
    const d = sim.state.fighters[1];
    d.airborne = true;
    d.y = -256 * 30;
    d.state = 'hit_air';
    d.juggle = MAX_JUGGLE;
    expect(sim.hurtboxes(d).length).toBe(0);
    expect(sim.hurtboxes(d, true).length).toBeGreaterThan(0);
    d.juggle = MAX_JUGGLE - 1;
    expect(sim.hurtboxes(d).length).toBeGreaterThan(0);
  });

  it('同一招的多段只算一次浮空段数', () => {
    const sim = mk();
    closeIn(sim);
    const d = sim.state.fighters[1];
    d.airborne = true;
    d.y = -256 * 30;
    d.vy = -256 * 2; // 还在上升，留足空中时间
    d.state = 'hit_air';
    d.stun = 60;
    seq(sim, [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]); // 机关枪 5 段
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      sim.step({ p1: 0, p2: 0 });
      for (const e of sim.hits) if (e.kind === 'hit') hits++;
    }
    expect(hits).toBeGreaterThan(MAX_JUGGLE);
    expect(sim.state.fighters[1].juggle).toBeLessThanOrEqual(2);
  });

  it('软倒可受身：落地时按住攻击键直接起身；硬倒不可', () => {
    // 软倒：蹲重拳（浮空但非 knockdown）
    const soft = mk();
    closeIn(soft);
    soft.step({ p1: Btn.Down | Btn.C, p2: 0 });
    expect(untilEvent(soft, 'hit')).not.toBeNull();
    const seen = new Set<string>();
    for (let i = 0; i < 90; i++) {
      soft.step({ p1: 0, p2: Btn.A });
      seen.add(soft.state.fighters[1].state);
    }
    expect(seen.has('getup')).toBe(true);
    expect(seen.has('knockdown')).toBe(false);

    // 硬倒：橡胶鞭
    const hard = mk();
    closeIn(hard);
    hard.step({ p1: Btn.Down | Btn.D, p2: 0 });
    expect(untilEvent(hard, 'hit')).not.toBeNull();
    const seen2 = new Set<string>();
    for (let i = 0; i < 90; i++) {
      hard.step({ p1: 0, p2: Btn.A });
      seen2.add(hard.state.fighters[1].state);
    }
    expect(seen2.has('knockdown')).toBe(true);
  });

  it('回到中立后连段计数清零', () => {
    const sim = mk();
    closeIn(sim);
    sim.step({ p1: Btn.A, p2: 0 });
    untilEvent(sim, 'hit');
    expect(sim.state.fighters[1].comboHits).toBe(1);
    run(sim, 0, 0, 40);
    expect(sim.state.fighters[1].comboHits).toBe(0);
  });
});

describe('rounds', () => {
  it('intro 冻结 → fight；计时器倒数', () => {
    const sim = mk({ introFrames: INTRO_FRAMES, roundTime: 10 });
    expect(sim.state.phase).toBe('intro');
    run(sim, Btn.Right, 0, 10);
    expect(sim.state.fighters[0].state).toBe('idle'); // 冻结中不动
    run(sim, 0, 0, INTRO_FRAMES - 10);
    expect(sim.state.phase).toBe('fight');
    expect(sim.state.timer).toBe(10 * LOGIC_FPS);
    run(sim, 0, 0, LOGIC_FPS);
    expect(sim.state.timer).toBe(9 * LOGIC_FPS);
  });

  it('时间到：血多者胜；平血平局不计胜场', () => {
    const win = mk({ roundTime: 1 });
    win.state.fighters[1].hp = 500;
    run(win, 0, 0, LOGIC_FPS);
    expect(win.state.phase).toBe('round_end');
    expect(win.state.roundWinner).toBe(0);
    run(win, 0, 0, ROUND_END_FRAMES);
    expect(win.state.wins).toEqual([1, 0]);

    const draw = mk({ roundTime: 1 });
    draw.state.fighters[0].hp = 700;
    draw.state.fighters[1].hp = 700;
    run(draw, 0, 0, LOGIC_FPS);
    expect(draw.state.roundWinner).toBeNull();
    run(draw, 0, 0, ROUND_END_FRAMES);
    expect(draw.state.wins).toEqual([0, 0]);
    expect(draw.state.round).toBe(2);
  });

  it('两胜结束比赛，Start 重开整场；气槽跨局保留、跨场清零', () => {
    const sim = mk({ roundTime: 1 });
    sim.state.fighters[0].meter = 120;
    sim.state.fighters[1].hp = 1;
    run(sim, 0, 0, LOGIC_FPS + ROUND_END_FRAMES);
    expect(sim.state.round).toBe(2);
    expect(sim.state.fighters[0].meter).toBe(120);
    sim.state.fighters[1].hp = 1;
    run(sim, 0, 0, LOGIC_FPS + ROUND_END_FRAMES);
    expect(sim.state.phase).toBe('match_end');
    expect(sim.state.wins).toEqual([2, 0]);
    run(sim, 0, 0, 5);
    sim.step({ p1: Btn.Start, p2: 0 });
    expect(sim.state.phase).toBe('fight');
    expect(sim.state.round).toBe(1);
    expect(sim.state.wins).toEqual([0, 0]);
    expect(sim.state.fighters[0].meter).toBe(0);
  });

  it('round_end 期间不接受输入', () => {
    const sim = mk({ roundTime: 1 });
    sim.state.fighters[1].hp = 1;
    run(sim, 0, 0, LOGIC_FPS);
    expect(sim.state.phase).toBe('round_end');
    run(sim, Btn.A, 0, 5);
    expect(sim.state.fighters[0].state).not.toBe('attack');
  });
});
