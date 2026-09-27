import { describe, expect, it } from 'vitest';
import { balanceOptions, classifyMatch, RoundClock } from '../../src/ai/balanceStats';

describe('balance sampling', () => {
  it('后续回合独立计时，排除回合间等待与入场', () => {
    const clock = new RoundClock();
    expect(clock.observe('fight', 0)).toBeNull();
    expect(clock.observe('round_end', 60)).toBe(60);
    expect(clock.observe('round_end', 61)).toBeNull();
    clock.observe('intro', 210);
    clock.observe('fight', 270);
    expect(clock.observe('round_end', 330)).toBe(60);
  });
  it('样本成对换边，拒绝会生成无意义报告的参数', () => {
    expect(balanceOptions()).toEqual({ matches: 40, difficulty: 'normal' });
    for (const count of ['0', '-2', '3', '2.5', 'NaN']) expect(() => balanceOptions(count)).toThrow();
    expect(() => balanceOptions('4', 'impossible')).toThrow();
  });
});

describe('classifyMatch', () => {
  it('未打完算超时，不按局分给胜', () => {
    expect(classifyMatch('fight', [2, 0])).toBe('timeout');
    expect(classifyMatch('round_end', [1, 0])).toBe('timeout');
  });

  it('打完按局分，平局单独计', () => {
    expect(classifyMatch('match_end', [2, 0])).toBe('p1');
    expect(classifyMatch('match_end', [0, 2])).toBe('p2');
    expect(classifyMatch('match_end', [1, 1])).toBe('draw');
  });
});
