import { describe, expect, it } from 'vitest';
import { Btn } from '../../src/core';
import { TOUCH_INPUT_MASK, TouchInput } from '../../src/input/touch';

describe('TouchInput', () => {
  it('短按在snapshot前释放仍锁存一帧，之后被消费', () => {
    const input = new TouchInput();
    input.setPointer(1, Btn.A);
    input.releasePointer(1);
    expect(input.snapshot()).toBe(Btn.A);
    expect(input.snapshot()).toBe(0);
  });

  it('多触点可同时方向、斜向、普通攻击和技能', () => {
    const input = new TouchInput();
    input.setPointer(1, Btn.Down | Btn.Right);
    input.setPointer(2, Btn.C);
    input.setPointer(3, Btn.Skill9);
    expect(input.snapshot()).toBe(Btn.Down | Btn.Right | Btn.C | Btn.Skill9);
    expect(input.snapshot()).toBe(Btn.Down | Btn.Right | Btn.C | Btn.Skill9);
    input.releasePointer(2);
    expect(input.snapshot()).toBe(Btn.Down | Btn.Right | Btn.Skill9);
  });

  it('拖动同一触点会替换方向并锁存新方向，不保留旧方向', () => {
    const input = new TouchInput();
    input.setPointer(7, Btn.Left);
    expect(input.snapshot()).toBe(Btn.Left);
    input.setPointer(7, Btn.Up | Btn.Right);
    expect(input.snapshot()).toBe(Btn.Up | Btn.Right);
  });

  it('多个触点按同一键只形成一次全局按下沿', () => {
    const input = new TouchInput();
    input.setPointer(1, Btn.B);
    expect(input.snapshot()).toBe(Btn.B);
    input.setPointer(2, Btn.B);
    input.releasePointer(1);
    expect(input.snapshot()).toBe(Btn.B);
    input.releasePointer(2);
    expect(input.snapshot()).toBe(0);
  });

  it('clear清除持有与未消费锁存，非法位不会进入core', () => {
    const input = new TouchInput();
    input.setPointer(1, Btn.A | Btn.Start | (1 << 29));
    expect(input.snapshot()).toBe(Btn.A);
    input.setPointer(2, Btn.Skill1);
    input.clear();
    expect(input.snapshot()).toBe(0);
    expect(TOUCH_INPUT_MASK & Btn.Start).toBe(0);
  });
});
