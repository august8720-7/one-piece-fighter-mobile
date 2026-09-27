import { Btn } from '@core/index';

/**
 * 手柄输入：标准映射（W3C "standard"）。手柄 0 → P1，手柄 1 → P2。
 * 按钮：X(2)=A  A(0)=B  Y(3)=C  B(1)=D  LB(4)=A+B 翻滚  RB(5)=C+D 吹飞  Start(9)=Start
 * 方向：D-Pad(12-15) 或 左摇杆（死区 0.5）
 *
 * 每逻辑帧 poll 一次。Gamepad API 是采样式的，两次 poll 之间的按下-松开无法感知，
 * 这是平台限制；60Hz 采样对手柄足够。
 */
const DEADZONE = 0.5;

const BUTTON_BITS: Record<number, number> = {
  2: Btn.A,
  0: Btn.B,
  3: Btn.C,
  1: Btn.D,
  4: Btn.A | Btn.B,
  5: Btn.C | Btn.D,
  9: Btn.Start,
  12: Btn.Up,
  13: Btn.Down,
  14: Btn.Left,
  15: Btn.Right,
};

export class GamepadInput {
  /** 是否有任何手柄连接 */
  get connected(): boolean {
    return this.pads().length > 0;
  }

  private pads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null && p.connected);
  }

  /** 读取当前两名玩家的位图 */
  snapshot(): { p1: number; p2: number } {
    const pads = this.pads();
    return { p1: pads[0] ? readPad(pads[0]) : 0, p2: pads[1] ? readPad(pads[1]) : 0 };
  }
}

function readPad(pad: Gamepad): number {
  let bits = 0;
  pad.buttons.forEach((b, i) => {
    if (b.pressed && BUTTON_BITS[i]) bits |= BUTTON_BITS[i]!;
  });
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  if (ax < -DEADZONE) bits |= Btn.Left;
  else if (ax > DEADZONE) bits |= Btn.Right;
  if (ay < -DEADZONE) bits |= Btn.Up;
  else if (ay > DEADZONE) bits |= Btn.Down;
  return bits;
}
