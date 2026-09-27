import { Btn, type Facing } from './types';

export const has = (bits: number, b: number): boolean => (bits & b) !== 0;

/**
 * 把绝对方向转成相对面向的方向：返回 -1（后）/ 0 / 1（前）。
 * 同时按左右视为 0。
 */
export function horizontalRelative(bits: number, facing: Facing): -1 | 0 | 1 {
  const left = has(bits, Btn.Left);
  const right = has(bits, Btn.Right);
  if (left === right) return 0;
  const abs: 1 | -1 = right ? 1 : -1;
  return abs === facing ? 1 : -1;
}

/** 摇杆数字记法（1-9，面朝右视角）。 */
export function toNumpad(bits: number, facing: Facing): number {
  const h = horizontalRelative(bits, facing);
  const up = has(bits, Btn.Up);
  const down = has(bits, Btn.Down);
  const v = up === down ? 0 : up ? 1 : -1;
  return 5 + h + v * 3;
}

/** 两键同按：两键都按住且至少一键是本帧刚按下。 */
export function pressedTogether(bits: number, pressed: number, a: Btn, b: Btn): boolean {
  return has(bits, a) && has(bits, b) && (has(pressed, a) || has(pressed, b));
}