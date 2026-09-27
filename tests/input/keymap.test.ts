import { describe, expect, it } from 'vitest';
import { DEFAULT_P1, P2_NO_NUMPAD, defaultKeyConfig, keyConflicts } from '../../src/input/keymap';

describe('keyConflicts', () => {
  it('默认 P1/P2 小键盘方案无共享键', () => {
    expect(keyConflicts(defaultKeyConfig())).toEqual([]);
  });

  it('无小键盘 P2 与默认 P1 无冲突', () => {
    expect(keyConflicts({ p1: { ...DEFAULT_P1 }, p2: { ...P2_NO_NUMPAD } })).toEqual([]);
  });

  it('同一键分给两侧时会报', () => {
    const cfg = defaultKeyConfig();
    cfg.p2.A = cfg.p1.A;
    const hits = keyConflicts(cfg);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toContain('J');
  });
});
