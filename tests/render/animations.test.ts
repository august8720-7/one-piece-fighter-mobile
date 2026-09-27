import { describe, expect, it } from 'vitest';
import { Btn, FightSim } from '../../src/core';
import { akainuDef, characterAnims, luffyDef, moveFrameCounts } from '../../src/characters';
import { DEFAULT_ANIMS, animDrawScale, currentAnimation, frameName, moveVisualIndex, requiredFrames } from '../../src/render/animations';

const mk = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 1, introFrames: 0 });
const run = (sim: FightSim, p1: number, p2: number, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step({ p1, p2 });
};

describe('animations', () => {
  it('idle 按 fps 循环取帧', () => {
    const sim = mk();
    const f = sim.state.fighters[0];
    const table = DEFAULT_ANIMS;
    // 默认循环动画 4 帧 8fps；角色可以用实际素材覆盖帧数。
    run(sim, 0, 0, 1);
    expect(currentAnimation(sim, f, table)).toEqual({ anim: 'idle', index: 0 });
    run(sim, 0, 0, 8);
    expect(currentAnimation(sim, f, table).index).toBe(1);
    run(sim, 0, 0, 8 * 3);
    expect(currentAnimation(sim, f, table).index).toBe(0); // 循环回到 0
  });

  it('角色素材长时间待机仍只请求声明过的帧', () => {
    const sim = mk();
    run(sim, 0, 0, 180);
    for (const f of sim.state.fighters) {
      const table = characterAnims[f.def.id]!;
      const animation = currentAnimation(sim, f, table);
      expect(animation.anim).toBe('idle');
      expect(animation.index).toBeGreaterThanOrEqual(0);
      expect(animation.index).toBeLessThan(table.idle!.frames);
    }
  });

  it('override 支持 anim/index 定格', () => {
    const sim = mk();
    const f = sim.state.fighters[0];
    expect(currentAnimation(sim, f, {}, 'st_c/1')).toEqual({ anim: 'st_c', index: 1 });
    expect(currentAnimation(sim, f, {}, 'win')).toEqual({ anim: 'win', index: 0 });
  });

  it('招式用 FrameData.sprite 作为帧号', () => {
    const sim = mk();
    sim.step({ p1: Btn.C, p2: 0 }); // st_c: startup 9 (sprite 0) / active 4 (sprite 1) / recovery (sprite 2)
    const f = sim.state.fighters[0];
    expect(currentAnimation(sim, f, {})).toEqual({ anim: 'st_c', index: 0 });
    run(sim, 0, 0, 9);
    expect(currentAnimation(sim, f, {}).index).toBe(1);
    run(sim, 0, 0, 4);
    expect(currentAnimation(sim, f, {}).index).toBe(2);
  });

  it('非循环动画停在最后一帧', () => {
    const sim = mk();
    run(sim, Btn.Up, 0, 4); // prejump 3 → jump_neutral（2 帧 6fps，不循环）
    run(sim, 0, 0, 30);
    const f = sim.state.fighters[0];
    expect(f.state).toBe('jump_neutral');
    expect(currentAnimation(sim, f, {}).index).toBe(1);
  });

  it('requiredFrames 覆盖所有状态与所有招式的每一帧', () => {
    const names = requiredFrames('luffy', characterAnims['luffy']!, moveFrameCounts(luffyDef));
    const set = new Set(names);
    for (const state of Object.keys(DEFAULT_ANIMS)) expect(set.has(frameName('luffy', state, 0))).toBe(true);
    for (const m of luffyDef.moves) {
      const maxSprite = Math.max(...m.frames.map((fr) => fr.sprite));
      expect(set.has(frameName('luffy', m.id, maxSprite))).toBe(true);
    }
    expect(names.length).toBe(set.size); // 无重复
  });

  it('连续精灵保留原作蹲姿比例，不再单独缩小整个人', () => {
    expect(animDrawScale(characterAnims.luffy!, 'idle')).toBe(1);
    expect(animDrawScale(characterAnims.luffy!, 'crouch')).toBe(1);
    expect(animDrawScale(characterAnims.akainu!, 'crouch')).toBe(1);
  });

  it('轻拳完整视觉序列不越过真实起手、命中和收招分界', () => {
    const move = luffyDef.moves.find((m) => m.id === 'st_a')!;
    const sequences = characterAnims.luffy!.st_a!.bySprite!;
    const startup = move.frames[0]!.duration;
    const active = move.frames[1]!.duration;
    for (let frame = 0; frame < startup; frame++) expect(sequences[0]).toContain(moveVisualIndex(move, frame, sequences));
    for (let frame = startup; frame < startup + active; frame++) expect(sequences[1]).toContain(moveVisualIndex(move, frame, sequences));
    expect(sequences[2]).toContain(moveVisualIndex(move, startup + active, sequences));
    expect(moveVisualIndex(move, 0, sequences)).not.toBe(moveVisualIndex(move, startup - 1, sequences));
  });

  it('命中定格期间视觉帧也冻结', () => {
    const sim = mk();
    sim.step({ p1: Btn.A, p2: 0 });
    const f = sim.state.fighters[0];
    f.hitstop = 4;
    const before = currentAnimation(sim, f, characterAnims.luffy!);
    run(sim, 0, 0, 3);
    expect(currentAnimation(sim, f, characterAnims.luffy!)).toEqual(before);
  });

  it('霸体拆分的相同 sprite 连续推进，切段不会把动作倒回开始', () => {
    const move = akainuDef.moves.find((m) => m.id === 'st_c')!;
    const split = { ...move, frames: [{ sprite: 0, duration: 3 }, { sprite: 0, duration: 3 }, { sprite: 1, duration: 2 }] };
    const sequences = { 0: [0, 1, 2], 1: [3] };
    expect(moveVisualIndex(split, 2, sequences)).toBe(1);
    expect(moveVisualIndex(split, 3, sequences)).toBe(1);
    expect(moveVisualIndex(split, 5, sequences)).toBe(2);
    expect(moveVisualIndex(split, 6, sequences)).toBe(3);
  });
});
