import { LOGIC_STEP_MS } from '@core/index';

/**
 * 把可变的渲染帧间隔折算成固定的逻辑帧数。
 * 单次最多推进 maxSteps 帧，避免标签页切回时"追帧"卡死。
 */
export class FixedStep {
  private acc = 0;

  constructor(private readonly maxSteps = 5) {}

  /** 返回本次应推进的逻辑帧数。 */
  advance(deltaMs: number): number {
    this.acc += Math.min(deltaMs, LOGIC_STEP_MS * this.maxSteps);
    let steps = 0;
    while (this.acc >= LOGIC_STEP_MS && steps < this.maxSteps) {
      this.acc -= LOGIC_STEP_MS;
      steps++;
    }
    return steps;
  }

  /** 当前帧内的插值比例 [0,1)，供渲染平滑用（M0 暂不用）。 */
  get alpha(): number {
    return this.acc / LOGIC_STEP_MS;
  }
}
