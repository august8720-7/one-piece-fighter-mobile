import { Btn, type ControlMode, type ControlModes } from '@core/index';

/** 可重绑的动作（Start 固定为 Enter / NumpadEnter / 手柄 Start） */
export const CLASSIC_ACTIONS = ['Up', 'Down', 'Left', 'Right', 'A', 'B', 'C', 'D', 'Roll', 'Blowback'] as const;
export const SKILL_ACTIONS = ['Skill1', 'Skill2', 'Skill3', 'Skill4', 'Skill5', 'Skill6', 'Skill7', 'Skill8', 'Skill9'] as const;
export const ACTIONS = [...CLASSIC_ACTIONS, ...SKILL_ACTIONS] as const;
export type Action = (typeof ACTIONS)[number];
export function actionsFor(mode: ControlMode): readonly Action[] { return mode === 'simple' ? ACTIONS : CLASSIC_ACTIONS; }

export const ACTION_LABEL: Record<Action, string> = {
  Up: '上 / 跳',
  Down: '下 / 蹲',
  Left: '左',
  Right: '右',
  A: 'A 轻拳',
  B: 'B 轻脚',
  C: 'C 重拳',
  D: 'D 重脚',
  Roll: '翻滚 (A+B)',
  Blowback: '吹飞 (C+D)',
  Skill1: '技能1', Skill2: '技能2', Skill3: '技能3', Skill4: '技能4', Skill5: '技能5', Skill6: '技能6',
  Skill7: '超必杀1', Skill8: '超必杀2', Skill9: '终极技',
};

/** 动作 → 位图（Roll / Blowback 是宏） */
export const ACTION_BITS: Record<Action, number> = {
  Up: Btn.Up,
  Down: Btn.Down,
  Left: Btn.Left,
  Right: Btn.Right,
  A: Btn.A,
  B: Btn.B,
  C: Btn.C,
  D: Btn.D,
  Roll: Btn.A | Btn.B,
  Blowback: Btn.C | Btn.D,
  Skill1: Btn.Skill1, Skill2: Btn.Skill2, Skill3: Btn.Skill3, Skill4: Btn.Skill4, Skill5: Btn.Skill5,
  Skill6: Btn.Skill6, Skill7: Btn.Skill7, Skill8: Btn.Skill8, Skill9: Btn.Skill9,
};

/** 动作 → KeyboardEvent.code */
export type KeyBinding = Record<(typeof CLASSIC_ACTIONS)[number], string> & Partial<Record<(typeof SKILL_ACTIONS)[number], string>>;

export const DEFAULT_P1: KeyBinding = {
  Up: 'KeyW',
  Down: 'KeyS',
  Left: 'KeyA',
  Right: 'KeyD',
  A: 'KeyJ',
  B: 'KeyK',
  C: 'KeyU',
  D: 'KeyI',
  Roll: 'KeyL',
  Blowback: 'KeyO',
};

export const DEFAULT_P2: KeyBinding = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  A: 'Numpad1',
  B: 'Numpad2',
  C: 'Numpad4',
  D: 'Numpad5',
  Roll: 'Numpad3',
  Blowback: 'Numpad6',
};

/** 无小键盘时的 P2：方向键 + N/M , . / */
export const P2_NO_NUMPAD: KeyBinding = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  A: 'KeyN',
  B: 'KeyM',
  C: 'Comma',
  D: 'Period',
  Roll: 'Slash',
  Blowback: 'ShiftRight',
};

const STORAGE_KEY = 'opf.keys.v1';
const SIMPLE_STORAGE_KEY = 'opf.keys.simple.v2';
const MODE_STORAGE_KEY = 'opf.controls.v2';

export const DEFAULT_SIMPLE_P1: KeyBinding = {
  ...DEFAULT_P1, Skill1: 'KeyQ', Skill2: 'KeyE', Skill3: 'KeyR', Skill4: 'KeyF', Skill5: 'KeyG',
  Skill6: 'KeyZ', Skill7: 'KeyX', Skill8: 'KeyC', Skill9: 'KeyV',
};
export const DEFAULT_SIMPLE_P2: KeyBinding = {
  ...DEFAULT_P2, Skill1: 'Numpad7', Skill2: 'Numpad8', Skill3: 'Numpad9', Skill4: 'NumpadDivide', Skill5: 'NumpadMultiply',
  Skill6: 'NumpadSubtract', Skill7: 'NumpadAdd', Skill8: 'NumpadDecimal', Skill9: 'Numpad0',
};
export const P2_SIMPLE_NO_NUMPAD: KeyBinding = {
  ...P2_NO_NUMPAD, Skill1: 'Digit1', Skill2: 'Digit2', Skill3: 'Digit3', Skill4: 'Digit4', Skill5: 'Digit5',
  Skill6: 'Digit6', Skill7: 'Digit7', Skill8: 'Digit8', Skill9: 'Digit9',
};

export function loadControlModes(): ControlModes {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(MODE_STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every(mode => mode === 'classic' || mode === 'simple')) {
      return [parsed[0] as ControlMode, parsed[1] as ControlMode];
    }
  } catch { /* Unavailable storage does not block play. */ }
  return ['simple', 'simple'];
}

export function saveControlModes(modes: ControlModes): void {
  try { globalThis.localStorage?.setItem(MODE_STORAGE_KEY, JSON.stringify(modes)); } catch { /* Keep session choices. */ }
}

export interface KeyConfig {
  p1: KeyBinding;
  p2: KeyBinding;
}

export function defaultKeyConfig(modes: ControlModes = ['classic', 'classic']): KeyConfig {
  return { p1: { ...(modes[0] === 'simple' ? DEFAULT_SIMPLE_P1 : DEFAULT_P1) }, p2: { ...(modes[1] === 'simple' ? DEFAULT_SIMPLE_P2 : DEFAULT_P2) } };
}

/** 动作优先：M 被玩家绑定时，静音改在设置页操作。 */
export function muteShortcutAvailable(cfg: KeyConfig): boolean {
  return ![...Object.values(cfg.p1), ...Object.values(cfg.p2)].includes('KeyM');
}

/** 读取本地保存的键位；损坏或缺失时用默认值补齐。 */
function loadProfile(mode: ControlMode): KeyConfig {
  const cfg = defaultKeyConfig([mode, mode]);
  try {
    const raw = globalThis.localStorage?.getItem(mode === 'classic' ? STORAGE_KEY : SIMPLE_STORAGE_KEY);
    if (!raw) return cfg;
    const parsed = JSON.parse(raw) as Partial<Record<'p1' | 'p2', Partial<Record<string, unknown>>>>;
    for (const side of ['p1', 'p2'] as const) {
      const src = parsed[side];
      if (!src) continue;
      for (const a of actionsFor(mode)) {
        const v = src[a];
        if (typeof v === 'string' && v.length > 0) cfg[side][a] = v;
      }
    }
  } catch {
    // 忽略损坏的存档
  }
  return cfg;
}

export function loadKeyConfig(modes: ControlModes = ['classic', 'classic']): KeyConfig {
  return { p1: loadProfile(modes[0]).p1, p2: loadProfile(modes[1]).p2 };
}

export function saveKeyConfig(cfg: KeyConfig, modes: ControlModes = ['classic', 'classic']): void {
  for (const mode of ['classic', 'simple'] as const) {
    if (!modes.includes(mode)) continue;
    const profile = loadProfile(mode);
    for (const [index, side] of ['p1', 'p2'].entries()) {
      if (modes[index] !== mode) continue;
      const player = side as keyof KeyConfig;
      for (const action of actionsFor(mode)) {
        const code = cfg[player][action];
        if (code) profile[player][action] = code;
      }
    }
    try { globalThis.localStorage?.setItem(mode === 'classic' ? STORAGE_KEY : SIMPLE_STORAGE_KEY, JSON.stringify(profile)); }
    catch { /* Privacy mode does not block play. */ }
  }
}

/** 键位表 → code → 位图（同一个键可同时属于两个玩家，位图分开） */
export function toKeyMap(b: KeyBinding): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of ACTIONS) {
    const code = b[a];
    if (code) out[code] = (out[code] ?? 0) | ACTION_BITS[a];
  }
  return out;
}

/** 同一物理键被两侧或多个动作占用时返回说明，供设置页提示 */
export function keyConflicts(cfg: KeyConfig): string[] {
  const map = new Map<string, string[]>();
  for (const side of ['p1', 'p2'] as const) {
    for (const a of ACTIONS) {
      const code = cfg[side][a];
      if (!code) continue;
      const arr = map.get(code) ?? [];
      arr.push(`${side.toUpperCase()} ${ACTION_LABEL[a]}`);
      map.set(code, arr);
    }
  }
  const out: string[] = [];
  for (const [code, owners] of map) {
    if (isReservedKey(code)) out.push(`${keyLabel(code)} 是菜单或调试保留键`);
    if (owners.length > 1) out.push(`${keyLabel(code)} → ${owners.join(' / ')}`);
  }
  return out;
}

/** 给人看的键名 */
export function isReservedKey(code: string): boolean {
  return ['Enter', 'NumpadEnter', 'Escape', 'Tab'].includes(code) || /^F\d{1,2}$/.test(code);
}

export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  if (code.startsWith('Numpad')) return 'Num' + ({ Divide: '/', Multiply: '*', Subtract: '-', Add: '+', Decimal: '.', Enter: 'Enter' }[code.slice(6)] ?? code.slice(6));
  const extra: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', ShiftRight: 'RShift', Quote: "'", Semicolon: ';' };
  return extra[code] ?? code;
}
