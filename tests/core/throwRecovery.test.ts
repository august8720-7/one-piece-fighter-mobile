import { describe, expect, it } from 'vitest';
import { Btn, FightSim, THROW_TECH_FRAMES, px } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

type Grab = 'forward' | 'back' | 'command' | 'ultimate';

function startGrab(character: 'luffy' | 'akainu', grab: Grab = 'forward') {
  const sim = new FightSim({ p1: character === 'luffy' ? luffyDef : akainuDef, p2: character === 'luffy' ? akainuDef : luffyDef, introFrames: 0, roundTime: -1 });
  const [attacker, defender] = sim.state.fighters;
  attacker.x = px(-20);
  defender.x = px(20);
  attacker.meter = 300;
  const input = grab === 'forward' ? [Btn.Right | Btn.C]
    : grab === 'back' ? [Btn.Left | Btn.C]
    : grab === 'command' ? [Btn.Right, 0, Btn.Down, Btn.Down | Btn.Right | Btn.C]
    : [Btn.Down, Btn.Down | Btn.Right, Btn.Right, 0, Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.D];
  for (const p1 of input) sim.step({ p1, p2: 0 });
  for (let f = 0; f < 20 && attacker.state !== 'throw'; f++) sim.step({ p1: 0, p2: 0 });
  expect(attacker.state).toBe('throw');
  expect(defender.state).toBe('thrown');
  const move = sim.move(attacker)!;
  return { sim, attacker, defender, move, timing: move.throwData! };
}

describe('投技放人后的收招', () => {
  it.each([
    ['luffy', 'forward'], ['luffy', 'back'], ['akainu', 'forward'], ['akainu', 'back'],
    ['akainu', 'command'], ['akainu', 'ultimate'],
  ] as const)('%s %s：按原 releaseFrame 放人，在原 duration 才结束收招', (character, grab) => {
    const { sim, attacker, defender, move, timing } = startGrab(character, grab);
    const hpBefore = defender.hp;
    let releaseCount = 0;
    for (let frame = 1; frame < timing.releaseFrame; frame++) {
      sim.step({ p1: 0, p2: 0 });
      expect(attacker.state).toBe('throw');
      expect(sim.isStrikeInvulnerable(attacker)).toBe(true);
      expect(sim.isThrowable(attacker)).toBe(false);
    }
    sim.step({ p1: 0, p2: 0 });
    expect(attacker.stateFrame).toBe(timing.releaseFrame);
    expect(defender.state).toBe('hit_air');
    expect(defender.hp).toBe(hpBefore - move.damage);
    releaseCount += sim.hits.filter((hit) => hit.kind === 'hit' && hit.moveId === move.id).length;
    expect(sim.isStrikeInvulnerable(attacker)).toBe(false);
    expect(sim.isThrowable(attacker)).toBe(true);
    for (let frame = timing.releaseFrame + 1; frame < timing.duration; frame++) {
      // 持续攻击输入也不能跳过已经声明的收招。
      sim.step({ p1: frame % 2 === 0 ? Btn.A : 0, p2: 0 });
      expect(attacker.state).toBe('throw');
      expect(attacker.stateFrame).toBe(frame);
      releaseCount += sim.hits.filter((hit) => hit.kind === 'hit' && hit.moveId === move.id).length;
    }
    sim.step({ p1: 0, p2: 0 });
    expect(attacker.state).toBe('idle');
    expect(attacker.moveId).toBeNull();
    expect(releaseCount).toBe(1);
  });

  it('对手先发出的飞行道具能在放人后命中并打断收招', () => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
    for (const p2 of [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.C]) sim.step({ p1: 0, p2 });
    for (let f = 0; f < 14; f++) sim.step({ p1: 0, p2: 0 });
    const projectile = sim.state.projectiles[0]!;
    expect(projectile.kind).toBe('dog');
    const [attacker, defender] = sim.state.fighters;
    // 布置已经发出的道具于远处，让其在抓取结束后飞到攻击者身边。
    attacker.x = px(-20);
    defender.x = px(20);
    projectile.x = attacker.x + px(150);
    sim.step({ p1: Btn.Right | Btn.C, p2: 0 });
    expect(attacker.state).toBe('throw');
    const timing = sim.move(attacker)!.throwData!;
    let contactAt = -1;
    for (let frame = 1; frame < timing.duration; frame++) {
      sim.step({ p1: 0, p2: 0 });
      if (sim.hits.some((hit) => hit.projectile && hit.defender === 0 && hit.kind === 'hit')) {
        contactAt = frame;
        break;
      }
    }
    expect(contactAt).toBeGreaterThanOrEqual(timing.releaseFrame);
    expect(contactAt).toBeLessThan(timing.duration);
    expect(attacker.state).toBe('hit_stand');
    expect(attacker.moveId).toBeNull();
    for (let f = 0; f < timing.duration + 30; f++) {
      sim.step({ p1: 0, p2: 0 });
      expect(attacker.state).not.toBe('throw');
    }
  });

  it('拆投后按拆投时长恢复，不继续原投技或延迟结算伤害', () => {
    const { sim, attacker, defender, timing } = startGrab('luffy');
    sim.step({ p1: 0, p2: Btn.C });
    expect(attacker.state).toBe('throw_tech');
    expect(defender.state).toBe('throw_tech');
    for (let frame = 1; frame <= THROW_TECH_FRAMES; frame++) sim.step({ p1: 0, p2: 0 });
    expect(attacker.state).toBe('idle');
    expect(sim.state.frame).toBeLessThan(timing.duration);
    for (let frame = 0; frame < timing.duration; frame++) sim.step({ p1: 0, p2: 0 });
    expect(attacker.hp).toBe(luffyDef.maxHp);
    expect(defender.hp).toBe(akainuDef.maxHp);
  });

  it('正常放人前抓取对象被解除，攻击方立即退出而不强行演完', () => {
    const { sim, attacker, defender, timing } = startGrab('luffy');
    defender.state = 'idle'; // 模拟抓取被外部状态切换中断。
    sim.step({ p1: 0, p2: 0 });
    expect(attacker.state).toBe('idle');
    expect(attacker.moveId).toBeNull();
    for (let frame = 0; frame < timing.duration; frame++) sim.step({ p1: 0, p2: 0 });
    expect(defender.hp).toBe(akainuDef.maxHp);
  });
});
