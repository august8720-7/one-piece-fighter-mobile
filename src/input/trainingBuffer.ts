import { ANY_ATTACK, ANY_SKILL, type InputFrame } from '@core/index';

/** 慢放或逐帧等待期间，保存最后一次新按攻击键时的方向组合。 */
export function captureTrainingInput(pending: InputFrame, previous: InputFrame, current: InputFrame): InputFrame {
  const capture = (saved: number, before: number, now: number) =>
    (now & ~before & (ANY_ATTACK | ANY_SKILL)) !== 0 ? now : (saved & (ANY_ATTACK | ANY_SKILL)) !== 0 ? saved : now;
  return { p1: capture(pending.p1, previous.p1, current.p1), p2: capture(pending.p2, previous.p2, current.p2) };
}
