import { describe, expect, it } from 'vitest';
import { FightSim } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { currentAnimation, spriteAnimations } from '../../src/render/animations';

// 用分离的视觉帧号确认阶段，不依赖尚在迭代的角色裁图。
const visual = { frames: [0, 1, 2, 3, 4, 5], startup: [0, 1], active: [2, 3], recovery: [4, 5] };

function fixture(id: string) {
  const move = akainuDef.moves.find((m) => m.id === id)!;
  const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0 });
  const table = spriteAnimations({}, { [id]: visual }, [move]);
  const f = sim.state.fighters[0];
  f.state = 'attack';
  f.moveId = id;
  return {
    f,
    frame: (time: number) => { f.stateFrame = time; return currentAnimation(sim, f, table); },
  };
}

describe('发射与投技的视觉时机', () => {
  it('犬噛在真实发射帧显示发力，随后进入收招，不跳过无hitbox的active', () => {
    const { frame } = fixture('sp_inugami');
    expect(frame(13).index).toBe(1);
    expect(frame(14).index).toBe(2);
    expect(frame(15).index).toBe(3);
    expect(frame(16).index).toBe(4);
    expect(frame(41).index).toBe(5);
  });

  it('流星火山的cast切段不重播起手，最后一颗射出以后才开始收招', () => {
    const { frame } = fixture('sp_meteor_rain');
    expect(frame(11).index).toBe(1);
    expect(frame(12).index).toBe(1);
    expect(frame(20).index).toBe(2);
    expect([2, 3]).toContain(frame(30).index);
    expect(frame(48).index).toBe(3);
    expect(frame(49).index).toBe(4);
    expect(frame(59).index).toBe(5);
  });

  it('终极投抓取过程中持续发力，放人时终结，收招末帧才完成动作', () => {
    const { f, frame } = fixture('ult_meigou_end');
    f.state = 'throw';
    expect(frame(0)).toEqual({ anim: 'ult_meigou_end', index: 0 });
    const holding = new Set(Array.from({ length: 40 }, (_, i) => frame(25 + i).index));
    expect(holding).toEqual(new Set([2, 3]));
    expect(frame(70).index).toBe(3);
    expect(frame(89).index).toBe(5);
  });
});
