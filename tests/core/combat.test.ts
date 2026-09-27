import { describe, expect, it } from 'vitest';
import { Btn, FightSim, ROUND_END_FRAMES, px, totalFrames } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 7, introFrames: 0 });
/** 从招式数据读伤害，避免数值调整时测试跟着改 */
const dmg = (def: typeof luffyDef, id: string) => def.moves.find((m) => m.id === id)!.damage;
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};
/** 先按住再松开：产生一次按键边沿 */
const tap = (sim: FightSim, p1: number, p2: number) => {
  sim.step({ p1, p2 });
  sim.step({ p1: 0, p2: 0 });
};
/** 双方走到贴身 */
const closeIn = (sim: FightSim) => run(sim, Btn.Right, Btn.Left, 120);

describe('combat', () => {
  it('按键边沿触发普通技，招式结束回到 idle', () => {
    const sim = mk();
    tap(sim, Btn.A, 0);
    const f = sim.state.fighters[0];
    expect(f.state).toBe('attack');
    expect(f.moveId).toBe('st_a');
    const total = totalFrames(luffyDef.moves.find((m) => m.id === 'st_a')!);
    run(sim, 0, 0, total);
    expect(sim.state.fighters[0].state).toBe('idle');
  });

  it('同帧 ↓+按键 出蹲技；已蹲下再按键也出蹲技', () => {
    const a = mk();
    tap(a, Btn.Down | Btn.B, 0);
    expect(a.state.fighters[0].moveId).toBe('cr_b');
    const b = mk();
    run(b, Btn.Down, 0, 5);
    b.step({ p1: Btn.Down | Btn.B, p2: 0 });
    expect(b.state.fighters[0].moveId).toBe('cr_b');
  });

  it('按住不放不会连续出招', () => {
    const sim = mk();
    run(sim, Btn.A, 0, 60);
    const f = sim.state.fighters[0];
    expect(f.state).toBe('idle');
  });

  it('贴身轻拳命中：扣血、双方 hitstop、对手进入受击硬直', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[1].hp;
    tap(sim, Btn.A, 0);
    let hit = false;
    for (let i = 0; i < 12 && !hit; i++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.length) hit = true;
    }
    expect(hit).toBe(true);
    const [a, d] = sim.state.fighters;
    expect(d.hp).toBe(hp0 - dmg(luffyDef, 'st_a'));
    expect(d.state).toBe('hit_stand');
    expect(a.hitstop).toBeGreaterThan(0);
    expect(d.hitstop).toBe(a.hitstop);
    expect(sim.hits[0]!.moveId).toBe('st_a');
  });

  it('每招只命中一次', () => {
    const sim = mk();
    closeIn(sim);
    const hp0 = sim.state.fighters[1].hp;
    tap(sim, Btn.A, 0);
    run(sim, 0, 0, 40);
    expect(sim.state.fighters[1].hp).toBe(hp0 - dmg(luffyDef, 'st_a'));
  });

  it('hitstop 期间双方冻结', () => {
    const sim = mk();
    closeIn(sim);
    tap(sim, Btn.C, 0); // 橡胶手枪 startup 9
    for (let i = 0; i < 20 && sim.hits.length === 0; i++) sim.step({ p1: 0, p2: 0 });
    expect(sim.hits.length).toBe(1);
    const [a, d] = sim.state.fighters;
    const sfA = a.stateFrame;
    const xD = d.x;
    sim.step({ p1: 0, p2: 0 });
    expect(sim.state.fighters[0].stateFrame).toBe(sfA);
    expect(sim.state.fighters[1].x).toBe(xD);
  });

  it('蹲重脚击倒 → 倒地 → 起身 → idle', () => {
    const sim = mk();
    closeIn(sim);
    tap(sim, Btn.Down | Btn.D, 0);
    for (let i = 0; i < 30 && sim.hits.length === 0; i++) sim.step({ p1: 0, p2: 0 });
    expect(sim.hits[0]?.moveId).toBe('cr_d');
    const d = sim.state.fighters[1];
    expect(d.state).toBe('hit_air');
    expect(d.airborne).toBe(true);
    // 落地
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      sim.step({ p1: 0, p2: 0 });
      seen.add(sim.state.fighters[1].state);
    }
    expect(seen.has('knockdown')).toBe(true);
    expect(seen.has('getup')).toBe(true);
    expect(sim.state.fighters[1].state).toBe('idle');
  });

  it('击退方向远离攻击者', () => {
    const sim = mk();
    closeIn(sim);
    tap(sim, Btn.C, 0);
    for (let i = 0; i < 20 && sim.hits.length === 0; i++) sim.step({ p1: 0, p2: 0 });
    // P1 在左朝右，P2 应被推向右
    expect(sim.state.fighters[1].vx).toBeGreaterThan(0);
  });

  it('未贴身出招不命中', () => {
    const sim = mk();
    const hp0 = sim.state.fighters[1].hp;
    tap(sim, Btn.A, 0);
    run(sim, 0, 0, 30);
    expect(sim.state.fighters[1].hp).toBe(hp0);
  });

  it('血量归零 → round_end、winner；结束后自动进入下一局', () => {
    const sim = mk();
    closeIn(sim);
    sim.state.fighters[1].hp = 10;
    tap(sim, Btn.A, 0);
    run(sim, 0, 0, 10);
    expect(sim.state.roundOver).toBe(true);
    expect(sim.state.winner).toBe(0);
    expect(sim.state.fighters[1].hp).toBe(0);
    // KO 一击必定击飞，落地后 ko
    expect(sim.state.fighters[1].airborne).toBe(true);
    run(sim, 0, 0, 100);
    expect(sim.state.fighters[1].state).toBe('ko');
    run(sim, 0, 0, ROUND_END_FRAMES);
    expect(sim.state.roundOver).toBe(false);
    expect(sim.state.round).toBe(2);
    expect(sim.state.wins).toEqual([1, 0]);
    expect(sim.state.fighters[1].hp).toBe(akainuDef.maxHp);
    expect(sim.state.fighters[0].x).toBe(px(-90));
  });

  it('出招中不转身', () => {
    const sim = mk();
    // P1 跳过 P2 头顶后落地时会转身；出招中不转
    closeIn(sim);
    tap(sim, Btn.C, 0);
    const facing = sim.state.fighters[0].facing;
    // 人为把 P2 挪到 P1 背后
    sim.state.fighters[1].x = sim.state.fighters[0].x - px(150);
    sim.step({ p1: 0, p2: 0 });
    expect(sim.state.fighters[0].state).toBe('attack');
    expect(sim.state.fighters[0].facing).toBe(facing);
  });

  it('确定性：含战斗的输入序列结果一致', () => {
    const a = mk();
    const b = mk();
    closeIn(a);
    closeIn(b);
    const seq = [Btn.Right, Btn.A, 0, Btn.Right | Btn.C, 0, Btn.Down | Btn.D, 0, Btn.Up, Btn.B, 0];
    for (let i = 0; i < 900; i++) {
      const p1 = seq[i % seq.length]!;
      const p2 = seq[(i * 3) % seq.length]!;
      a.step({ p1, p2 });
      b.step({ p1, p2 });
    }
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.fighters[0].hp + a.state.fighters[1].hp).toBeLessThan(luffyDef.maxHp + akainuDef.maxHp);
  });
});
