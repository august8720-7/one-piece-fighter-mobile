import { describe, expect, it } from 'vitest';
import { Btn, FightSim, GROUND_Y, STAGE_LEFT, px, type ProjectileEndEvent } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const idle = { p1: 0, p2: 0 };
const make = () => new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });

function spawnDog(sim = make()) {
  for (const p2 of [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.C]) sim.step({ p1: 0, p2 });
  for (let frame = 0; frame < 14; frame++) sim.step(idle);
  expect(sim.state.projectiles).toHaveLength(1);
  return { sim, projectile: sim.state.projectiles[0]! };
}

function spawnPair() {
  const sim = new FightSim({ p1: akainuDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
  const p1 = [Btn.Down, Btn.Down | Btn.Left, Btn.Left | Btn.C];
  const p2 = [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.C];
  for (let frame = 0; frame < p1.length; frame++) sim.step({ p1: p1[frame]!, p2: p2[frame]! });
  for (let frame = 0; frame < 14; frame++) sim.step(idle);
  expect(sim.state.projectiles).toHaveLength(2);
  return sim;
}

function untilEnd(sim: FightSim, p1 = 0): readonly ProjectileEndEvent[] {
  for (let frame = 0; frame < 180; frame++) {
    sim.step({ p1, p2: 0 });
    if (sim.projectileEnds.length) return sim.projectileEnds;
  }
  throw new Error('道具没有在预期时间内结束');
}

describe('projectile end events', () => {
  it.each([false, true])('真实犬噛红莲接触：guard=%s，结束原因与命中事件一致', (guarded) => {
    const { sim, projectile } = spawnDog();
    const hp = sim.state.fighters[0].hp;
    const events = untilEnd(sim, guarded ? Btn.Left : 0);
    const reason = guarded ? 'block' : 'hit';
    expect(events).toEqual([{
      id: projectile.id, kind: 'dog', owner: 1, moveId: 'sp_inugami',
      x: projectile.x, y: projectile.y, frame: sim.state.frame - 1, reason,
    }]);
    expect(sim.hits.some((event) => event.projectile && event.kind === reason)).toBe(true);
    expect(sim.state.fighters[0].hp).toBe(guarded ? hp : hp - projectile.damage);
    expect(sim.state.projectiles).toHaveLength(0);
  });

  it('霸体接触消耗道具时报告 hit，保留原霸体结算', () => {
    const sim = new FightSim({ p1: akainuDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
    const { projectile } = spawnDog(sim);
    const defender = sim.state.fighters[0];
    defender.state = 'attack';
    defender.moveId = 'sp_daifunka';
    defender.stateFrame = 0;
    projectile.x = defender.x + px(30);
    sim.step(idle);
    expect(sim.hits.some((event) => event.kind === 'armor')).toBe(true);
    expect(sim.projectileEnds).toHaveLength(1);
    expect(sim.projectileEnds[0]!.reason).toBe('hit');
    expect(defender.state).toBe('attack');
    expect(defender.armorBroken).toBe(true);
  });

  it('双方道具相消时每个消失 id 只报告一次', () => {
    const sim = spawnPair();
    const ids = sim.state.projectiles.map((projectile) => projectile.id);
    const events = untilEnd(sim);
    expect(events.map((event) => event.id)).toEqual(ids);
    expect(events.every((event) => event.reason === 'clash')).toBe(true);
    expect(events.map((event) => event.owner)).toEqual([0, 1]);
    expect(sim.hits.filter((event) => event.kind === 'clash')).toHaveLength(1);
    expect(sim.state.projectiles).toHaveLength(0);
  });

  it('相消后仍有耐久的道具不报告结束', () => {
    const sim = spawnPair();
    const [strong, weak] = sim.state.projectiles;
    strong!.durability = 2;
    const events = untilEnd(sim);
    expect(events.map((event) => event.id)).toEqual([weak!.id]);
    expect(events[0]!.reason).toBe('clash');
    expect(sim.state.projectiles.map((projectile) => projectile.id)).toEqual([strong!.id]);
    expect(strong!.durability).toBe(1);
  });

  it('命中后仍有耐久的道具不提前报告结束', () => {
    const { sim, projectile } = spawnDog();
    projectile.durability = 2;
    const defender = sim.state.fighters[0];
    projectile.x = defender.x + px(30);
    sim.step(idle);
    expect(sim.hits.some((event) => event.kind === 'hit' && event.projectile)).toBe(true);
    expect(sim.projectileEnds).toEqual([]);
    expect(projectile.durability).toBe(1);
    expect(sim.state.projectiles[0]!.id).toBe(projectile.id);
  });

  it('落地事件使用道具实际结束坐标，无需通过消失推测触地', () => {
    const sim = make();
    for (const p2 of [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.D]) sim.step({ p1: 0, p2 });
    for (let frame = 0; frame < 18; frame++) sim.step(idle);
    const projectile = sim.state.projectiles[0]!;
    expect(projectile.kind).toBe('meteor');
    projectile.y = GROUND_Y - px(1);
    projectile.vy = px(2);
    projectile.gravity = 0;
    const frame = sim.state.frame;
    sim.step(idle);
    expect(sim.projectileEnds).toEqual([{
      id: projectile.id, kind: 'meteor', owner: 1, moveId: 'sp_meteor',
      x: projectile.x, y: GROUND_Y + px(1), frame, reason: 'ground',
    }]);
    expect(sim.hits).toEqual([]);
  });

  it('同时超时、触地和越界时，保留原先超时优先的移除顺序', () => {
    const { sim, projectile } = spawnDog();
    projectile.ttl = 1;
    projectile.dieOnGround = true;
    projectile.y = GROUND_Y;
    projectile.x = STAGE_LEFT - px(90);
    sim.step(idle);
    expect(sim.projectileEnds).toHaveLength(1);
    expect(sim.projectileEnds[0]!.reason).toBe('timeout');
    expect(sim.state.projectiles).toHaveLength(0);
  });

  it('移出既定舞台缓冲区报告越界，不冒充命中或落地', () => {
    const { sim, projectile } = spawnDog();
    projectile.x = STAGE_LEFT - px(80);
    sim.step(idle);
    expect(sim.projectileEnds).toHaveLength(1);
    expect(sim.projectileEnds[0]!.reason).toBe('out_of_bounds');
    expect(sim.projectileEnds[0]!.x).toBe(projectile.x);
    expect(sim.hits).toEqual([]);
  });

  it('弹反时不结束，随后命中的结束事件保留 id 并报告新的 owner', () => {
    const { sim, projectile } = spawnDog();
    for (let frame = 0; frame < 12; frame++) sim.step(idle);
    for (const p1 of [Btn.Down, 0, Btn.Down | Btn.A]) sim.step({ p1, p2: 0 });
    for (let frame = 0; frame < 40 && !projectile.reflected; frame++) sim.step(idle);
    expect(projectile.reflected).toBe(true);
    expect(sim.hits.some((event) => event.kind === 'reflect')).toBe(true);
    expect(sim.projectileEnds).toEqual([]);
    const ends = untilEnd(sim);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ id: projectile.id, owner: 0, moveId: 'sp_inugami', reason: 'hit' });
  });

  it.each([
    ['resetRound', 'round_reset'], ['resetMatch', 'round_reset'], ['resetPositions', 'position_reset'],
  ] as const)('直接 %s 清除上一批事件并报告本次清理', (method, reason) => {
    const sim = spawnPair();
    const [expired, survivor] = sim.state.projectiles;
    expired!.ttl = 1;
    sim.step(idle);
    expect(sim.projectileEnds).toHaveLength(1);
    expect(sim.projectileEnds[0]!.id).toBe(expired!.id);
    const frame = sim.state.frame;
    const position = { x: survivor!.x, y: survivor!.y };
    sim[method]();
    expect(sim.state.frame).toBe(frame);
    expect(sim.projectileEnds).toEqual([{
      id: survivor!.id, kind: 'dog', owner: 1, moveId: 'sp_inugami', ...position, frame, reason,
    }]);
    expect(sim.state.projectiles).toEqual([]);
    expect(sim.hits).toEqual([]);
    sim[method]();
    expect(sim.projectileEnds).toEqual([]);
  });

  it('同一步的致命命中与回合清理均保留，而且每个 id 只有一个原因', () => {
    const sim = spawnPair();
    const [remaining, lethal] = sim.state.projectiles;
    remaining!.x = px(-300);
    remaining!.vx = 0;
    lethal!.x = sim.state.fighters[0].x + px(30);
    sim.state.fighters[0].hp = 1;
    sim.step(idle);
    expect(sim.state.phase).toBe('round_end');
    expect(sim.projectileEnds.map(({ id, reason }) => ({ id, reason }))).toEqual([
      { id: lethal!.id, reason: 'hit' }, { id: remaining!.id, reason: 'round_end' },
    ]);
    expect(sim.hits.some((event) => event.projectile && event.kind === 'hit')).toBe(true);
    expect(sim.state.projectiles).toEqual([]);
    sim.step(idle);
    expect(sim.projectileEnds).toEqual([]);
  });

  it('结束事件是值快照；重读不消费，下一次 step 或直接 reset 才清空', () => {
    const { sim, projectile } = spawnDog();
    const ends = untilEnd(sim);
    const snapshot = ends[0]!;
    const x = snapshot.x;
    projectile.x += px(100);
    expect(snapshot.x).toBe(x);
    expect(sim.projectileEnds[0]).toBe(snapshot);
    expect(sim.hits.length).toBeGreaterThan(0);
    sim.resetPositions();
    expect(sim.projectileEnds).toEqual([]);
    expect(sim.hits).toEqual([]);
    expect(snapshot.x).toBe(x);
  });

  it('相同输入逐帧得到相同结束事件顺序、原因和坐标', () => {
    const run = () => {
      const sim = spawnPair();
      const trace: ProjectileEndEvent[][] = [];
      for (let frame = 0; frame < 90; frame++) {
        sim.step(idle);
        trace.push([...sim.projectileEnds]);
      }
      expect(trace.flat()).toHaveLength(2);
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
