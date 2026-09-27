import { ANY_ATTACK, ANY_SKILL, Btn } from '@core/index';

/** Touch controls intentionally exclude Start: pause/exit stay UI callbacks. */
export const TOUCH_INPUT_MASK =
  Btn.Up | Btn.Down | Btn.Left | Btn.Right | ANY_ATTACK | ANY_SKILL;

/**
 * Multi-pointer P1 source. A press shorter than one logical frame remains
 * visible in the next snapshot, matching the keyboard latch contract.
 */
export class TouchInput {
  private readonly pointers = new Map<number, number>();
  private held = 0;
  private latched = 0;

  setPointer(pointerId: number, bits: number): void {
    if (!Number.isSafeInteger(pointerId)) throw new TypeError('pointerId must be an integer');
    const before = this.held;
    const accepted = Number.isSafeInteger(bits) ? bits & TOUCH_INPUT_MASK : 0;
    if (accepted) this.pointers.set(pointerId, accepted);
    else this.pointers.delete(pointerId);
    this.held = this.combineHeld();
    // A second finger on an already-held control is not a second press.
    this.latched |= this.held & ~before;
  }

  releasePointer(pointerId: number): void {
    this.pointers.delete(pointerId);
    this.held = this.combineHeld();
  }

  snapshot(): number {
    const bits = this.held | this.latched;
    this.latched = 0;
    return bits;
  }

  clear(): void {
    this.pointers.clear();
    this.held = 0;
    this.latched = 0;
  }

  private combineHeld(): number {
    let bits = 0;
    for (const value of this.pointers.values()) bits |= value;
    return bits;
  }
}

export const touchInput = new TouchInput();
