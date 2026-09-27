/**
 * 可种子的确定性随机数（mulberry32）。core 内唯一允许的随机来源。
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** [0, 2^32) 整数 */
  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** [0, n) 整数 */
  nextInt(n: number): number {
    return this.nextU32() % n;
  }

  /** 快照 / 恢复（回放、rollback 用） */
  getState(): number {
    return this.s;
  }

  setState(s: number): void {
    this.s = s >>> 0;
  }
}
