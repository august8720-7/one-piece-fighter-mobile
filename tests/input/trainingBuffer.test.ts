import { describe, expect, it } from 'vitest';
import { Btn } from '../../src/core';
import { captureTrainingInput } from '../../src/input/trainingBuffer';

const empty = { p1: 0, p2: 0 };
describe('training input capture', () => {
  it('逐帧等待中点下重脚再松开仍保存下重脚', () => {
    const chord = { p1: Btn.Down | Btn.D, p2: 0 };
    const pending = captureTrainingInput(empty, empty, chord);
    expect(captureTrainingInput(pending, chord, empty)).toEqual(chord);
  });
  it('新攻击替换旧输入，单纯改变方向不把旧攻击改成另一招', () => {
    const old = { p1: Btn.Down | Btn.D, p2: 0 };
    expect(captureTrainingInput(old, empty, { p1: Btn.Right, p2: 0 })).toEqual(old);
    const fresh = { p1: Btn.Left | Btn.A, p2: 0 };
    expect(captureTrainingInput(old, empty, fresh)).toEqual(fresh);
  });
  it('没有待执行攻击时使用实时方向，不把左右同时锁住', () => {
    expect(captureTrainingInput({ p1: Btn.Left, p2: 0 }, empty, { p1: Btn.Right, p2: 0 })).toEqual({ p1: Btn.Right, p2: 0 });
  });
});
