import type { ControlModes, InputFrame } from '@core/index';
import { sfx } from '../audio/Sfx';
import { GamepadInput } from './gamepad';
import { KeyboardInput } from './keyboard';
import { loadControlModes, loadKeyConfig, muteShortcutAvailable, saveControlModes, saveKeyConfig, type KeyConfig } from './keymap';

/**
 * 输入总线：键盘 + 手柄按位或，全局单例（跨场景保留监听与键位）。
 * 场景每逻辑帧调用 snapshot()。菜单用 edges() 取"刚按下"。
 */
export class InputHub {
  readonly keyboard: KeyboardInput;
  readonly gamepad = new GamepadInput();
  private config: KeyConfig;
  private modes: ControlModes;
  private matchModes: ControlModes | null = null;
  private profiles: Record<'classic' | 'simple', KeyConfig>;
  private prev: InputFrame = { p1: 0, p2: 0 };

  constructor() {
    this.modes = loadControlModes();
    this.profiles = { classic: loadKeyConfig(), simple: loadKeyConfig(['simple', 'simple']) };
    this.config = this.keyConfigFor(this.modes);
    this.keyboard = new KeyboardInput(this.config);
    // 第一次用户手势解锁音频；M 键静音
    const unlock = () => sfx().unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && muteShortcutAvailable(this.config)) sfx().toggleMute();
    });
  }

  get keyConfig(): KeyConfig {
    return this.config;
  }

  get controlModes(): ControlModes { return this.modes; }

  keyConfigFor(modes: ControlModes): KeyConfig {
    return { p1: { ...this.profiles[modes[0]].p1 }, p2: { ...this.profiles[modes[1]].p2 } };
  }

  setControlModes(modes: ControlModes): void {
    this.modes = [...modes];
    saveControlModes(this.modes);
    this.refreshConfig();
  }

  useMatchControls(modes: ControlModes | null): void {
    this.matchModes = modes ? [...modes] : null;
    this.refreshConfig();
  }

  setKeyConfig(cfg: KeyConfig, modes: ControlModes = this.modes): void {
    this.profiles[modes[0]].p1 = { ...cfg.p1 };
    this.profiles[modes[1]].p2 = { ...cfg.p2 };
    saveKeyConfig(cfg, modes);
    this.refreshConfig();
  }

  private refreshConfig(): void {
    this.config = this.keyConfigFor(this.matchModes ?? this.modes);
    this.keyboard.setConfig(this.config);
  }

  snapshot(): InputFrame {
    const k = this.keyboard.snapshot();
    const g = this.gamepad.snapshot();
    const cur = { p1: k.p1 | g.p1, p2: k.p2 | g.p2 };
    this.prev = cur;
    return cur;
  }

  /**
   * 菜单用：返回本次快照相对上次的"刚按下"位。
   * 注意每帧只能调用一次（内部会推进 prev）。
   */
  edges(): InputFrame {
    const before = this.prev;
    const cur = this.snapshot();
    return { p1: cur.p1 & ~before.p1, p2: cur.p2 & ~before.p2 };
  }

  /** 场景切换时清空锁存，避免上一个界面的确认键漏到下一个界面 */
  flush(): void {
    this.keyboard.clear();
    this.snapshot();
    this.snapshot();
  }
}

let hub: InputHub | null = null;
export function getInputHub(): InputHub {
  hub ??= new InputHub();
  return hub;
}
