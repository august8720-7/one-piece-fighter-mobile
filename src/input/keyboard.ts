import { Btn } from '@core/index';
import { loadKeyConfig, toKeyMap, type KeyConfig } from './keymap';

/**
 * 监听 window 键盘事件，维护两名玩家当前按下的位图。
 * 渲染层每逻辑帧调用 snapshot() 取一次。
 *
 * 锁存（latch）：一次按下-松开若发生在两次 snapshot 之间（短于一逻辑帧），
 * 仍必须在下一次 snapshot 中出现一帧，否则轻点会被吞（AGENTS.md 硬约束 8）。
 */
export class KeyboardInput {
  private held: [number, number] = [0, 0];
  private latched: [number, number] = [0, 0];
  private maps: [Record<string, number>, Record<string, number>];
  /** 最近一次按下的键（键位设置界面用） */
  private lastCode: string | null = null;
  private readonly onDown: (e: KeyboardEvent) => void;
  private readonly onUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;

  constructor(cfg: KeyConfig = loadKeyConfig()) {
    this.maps = [toKeyMap(cfg.p1), toKeyMap(cfg.p2)];
    this.onDown = this.onKey(true);
    this.onUp = this.onKey(false);
    this.onBlur = () => this.clear();
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  setConfig(cfg: KeyConfig): void {
    this.maps = [toKeyMap(cfg.p1), toKeyMap(cfg.p2)];
    this.clear();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }

  clear(): void {
    this.held = [0, 0];
    this.latched = [0, 0];
  }

  private onKey(down: boolean) {
    return (e: KeyboardEvent): void => {
      // repeat 只表示键还按着，不能再写 held/latch。
      // 否则场景 flush 清掉按住的确认键后，下一次 repeat 会立刻再点一次（标题进菜单直接选中对战）。
      if (down && e.repeat) return;
      if (down) this.lastCode = e.code;
      const b1 = this.maps[0][e.code];
      const b2 = this.maps[1][e.code];
      // Start：Enter → P1，NumpadEnter → P2
      const s1 = e.code === 'Enter' ? Btn.Start : 0;
      const s2 = e.code === 'NumpadEnter' ? Btn.Start : 0;
      const bits1 = (b1 ?? 0) | s1;
      const bits2 = (b2 ?? 0) | s2;
      if (bits1) this.apply(0, bits1, down);
      if (bits2) this.apply(1, bits2, down);
      if (bits1 || bits2 || e.code.startsWith('F')) {
        // F 键留给调试快捷键，其余绑定键阻止浏览器默认行为（滚动 / 聚焦）
        if (bits1 || bits2) e.preventDefault();
      }
    };
  }

  private apply(i: 0 | 1, b: number, down: boolean): void {
    if (down) {
      this.held[i] |= b;
      this.latched[i] |= b;
    } else {
      this.held[i] &= ~b;
    }
  }

  snapshot(): { p1: number; p2: number } {
    const p1 = this.held[0] | this.latched[0];
    const p2 = this.held[1] | this.latched[1];
    this.latched = [0, 0];
    return { p1, p2 };
  }

  /** 取走最近按下的键 code（一次性），键位设置界面用 */
  takeLastCode(): string | null {
    const c = this.lastCode;
    this.lastCode = null;
    return c;
  }
}
