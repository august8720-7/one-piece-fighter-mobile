import type { MotionId } from './types';

/**
 * 摇杆指令定义：steps 按顺序在历史中做子序列匹配，每一步允许多个方向；
 * 整个指令必须落在最近 window 帧内。
 *
 * 容错原则：
 * - 236 允许跳过 3（2 → 6），起手允许 1（蹲防后直接搓）
 * - 623 的 6 必须是刚按下的（走路中的 6 不算起手），结尾必须到 3；否则 236236 无气时会被吃成 623
 * - 22 要求中间有一帧非下方向（松开）
 */
interface MotionDef {
  steps: readonly (readonly number[])[];
  window: number;
  /** 首步必须是"刚按下"（前一帧不在首步集合内）。用于 623：避免走路时的 6 被当成起手 */
  freshStart?: boolean;
}

const DOWN = [1, 2, 3] as const;
const NOT_DOWN = [4, 5, 6, 7, 8, 9] as const;

export const MOTIONS: Record<MotionId, MotionDef> = {
  '236236': { steps: [[1, 2], [6, 9], [1, 2], [6, 9]], window: 30 },
  '214214': { steps: [[3, 2], [4, 7], [3, 2], [4, 7]], window: 30 },
  '623': { steps: [[6], [2, 1], [3]], window: 16, freshStart: true },
  '236': { steps: [[1, 2], [6, 9]], window: 12 },
  '214': { steps: [[3, 2], [4, 7]], window: 12 },
  '22': { steps: [DOWN, NOT_DOWN, DOWN], window: 14 },
};

/** 识别优先级：长指令优先，623 优先于 236（6-2-3 也包含 2-3） */
export const MOTION_PRIORITY: readonly MotionId[] = ['236236', '214214', '623', '236', '214', '22'];

/** history 末尾最新。返回是否在窗口内完成了该指令。 */
export function matchMotion(history: readonly number[], id: MotionId): boolean {
  const def = MOTIONS[id];
  const n = history.length;
  const start = Math.max(0, n - def.window);
  let si = 0;
  for (let i = start; i < n && si < def.steps.length; i++) {
    const h = history[i]!;
    if (!def.steps[si]!.includes(h)) continue;
    if (si === 0 && def.freshStart && i > 0 && def.steps[0]!.includes(history[i - 1]!)) continue;
    si++;
  }
  return si === def.steps.length;
}

/** 数字方向 → 相对水平分量（-1 后 / 0 / 1 前） */
export const numpadH = (n: number): -1 | 0 | 1 => (((n - 1) % 3) - 1) as -1 | 0 | 1;

/**
 * 双击检测（66 前冲 / 44 后撤步），基于数字方向历史。
 * 条件：最新一帧刚变为 dir 方向，且在 window 帧内此前出现过 "dir → 非 dir" 的松开。
 */
export function isDoubleTap(history: readonly number[], dir: -1 | 1, window = 10): boolean {
  const n = history.length;
  if (n < 3) return false;
  if (numpadH(history[n - 1]!) !== dir || numpadH(history[n - 2]!) === dir) return false;
  let sawRelease = false;
  for (let i = n - 2; i >= Math.max(0, n - 1 - window); i--) {
    const h = numpadH(history[i]!);
    if (!sawRelease) {
      if (h !== dir) sawRelease = true;
    } else if (h === dir) {
      return true;
    }
  }
  return false;
}
