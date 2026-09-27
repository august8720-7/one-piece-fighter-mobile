import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Btn } from '../../src/core';
import { KeyboardInput } from '../../src/input/keyboard';
import { InputHub } from '../../src/input/InputHub';
import { DEFAULT_SIMPLE_P1, P2_SIMPLE_NO_NUMPAD, defaultKeyConfig, isReservedKey, keyConflicts, loadControlModes, loadKeyConfig, saveControlModes, saveKeyConfig } from '../../src/input/keymap';

vi.mock('../../src/audio/Sfx', () => ({ sfx: () => ({ unlock: vi.fn(), toggleMute: vi.fn() }) }));
let surface: EventTarget;
let saved: Map<string, string>;
function key(code: string, down: boolean, repeat = false) {
  const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
  Object.assign(event, { code, repeat });
  surface.dispatchEvent(event);
}
beforeEach(() => {
  surface = new EventTarget(); saved = new Map();
  vi.stubGlobal('window', surface);
  vi.stubGlobal('localStorage', { getItem: (name: string) => saved.get(name) ?? null, setItem: (name: string, value: string) => saved.set(name, value) });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('simple keyboard bindings', () => {
  it('both simple layouts contain every skill with no default collisions', () => {
    expect(keyConflicts(defaultKeyConfig(['simple', 'simple']))).toEqual([]);
    expect(keyConflicts({ p1: DEFAULT_SIMPLE_P1, p2: P2_SIMPLE_NO_NUMPAD })).toEqual([]);
    expect(isReservedKey('KeyF')).toBe(false);
    for (const reserved of ['Enter', 'NumpadEnter', 'Tab', 'Escape', 'F1', 'F12']) expect(isReservedKey(reserved)).toBe(true);
  });

  it('short press between snapshots is latched, long hold is not a second edge, blur releases it', () => {
    const input = new KeyboardInput(defaultKeyConfig(['simple', 'simple']));
    key('KeyQ', true); key('KeyQ', false);
    expect(input.snapshot().p1).toBe(Btn.Skill1);
    expect(input.snapshot().p1).toBe(0);
    key('KeyV', true);
    expect(input.snapshot().p1).toBe(Btn.Skill9);
    key('KeyV', true, true);
    expect(input.snapshot().p1).toBe(Btn.Skill9);
    surface.dispatchEvent(new Event('blur'));
    expect(input.snapshot()).toEqual({ p1: 0, p2: 0 });
    key('KeyV', true, true);
    expect(input.snapshot().p1).toBe(0);
    input.destroy();
  });

  it('P2 numpad and no-numpad keys emit all nine slots independently', () => {
    const input = new KeyboardInput(defaultKeyConfig(['simple', 'simple']));
    for (const [index, code] of ['Numpad7', 'Numpad8', 'Numpad9', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract', 'NumpadAdd', 'NumpadDecimal', 'Numpad0'].entries()) {
      key(code, true); key(code, false);
      expect(input.snapshot()).toEqual({ p1: 0, p2: 1 << (9 + index) }); input.snapshot();
    }
    input.setConfig({ p1: DEFAULT_SIMPLE_P1, p2: P2_SIMPLE_NO_NUMPAD });
    for (let index = 1; index <= 9; index++) {
      key(`Digit${index}`, true); key(`Digit${index}`, false);
      expect(input.snapshot().p2).toBe(1 << (8 + index)); input.snapshot();
    }
    input.destroy();
  });

  it('simple edits and defaults never overwrite classic custom keys', () => {
    const classic = defaultKeyConfig(); classic.p1.A = 'KeyH';
    saveKeyConfig(classic);
    const original = saved.get('opf.keys.v1');
    const simple = defaultKeyConfig(['simple', 'simple']); simple.p1.Skill1 = 'KeyT';
    saveKeyConfig(simple, ['simple', 'simple']);
    expect(saved.get('opf.keys.v1')).toBe(original);
    expect(loadKeyConfig().p1.A).toBe('KeyH');
    expect(loadKeyConfig(['simple', 'simple']).p1.Skill1).toBe('KeyT');
    expect(loadControlModes()).toEqual(['simple', 'simple']);
    saveControlModes(['classic', 'simple']);
    expect(loadControlModes()).toEqual(['classic', 'simple']);
  });

  it('mode preference changed in settings does not replace the current match mappings', () => {
    const hub = new InputHub();
    hub.useMatchControls(['simple', 'classic']);
    hub.setControlModes(['classic', 'simple']);
    expect(hub.controlModes).toEqual(['classic', 'simple']);
    expect(hub.keyConfig.p1.Skill1).toBe('KeyQ');
    expect(hub.keyConfig.p2.Skill1).toBeUndefined();
    hub.useMatchControls(null);
    expect(hub.keyConfig.p1.Skill1).toBeUndefined();
    expect(hub.keyConfig.p2.Skill1).toBe('Numpad7');
    hub.keyboard.destroy();
  });

  it('storage failure keeps changes available within the running game', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Unavailable'); }, setItem: () => { throw new Error('Unavailable'); } });
    const hub = new InputHub();
    const config = hub.keyConfigFor(['simple', 'simple']); config.p1.Skill1 = 'KeyT';
    hub.setKeyConfig(config, ['simple', 'simple']);
    hub.setControlModes(['classic', 'simple']); hub.setControlModes(['simple', 'simple']);
    expect(hub.keyConfig.p1.Skill1).toBe('KeyT');
    hub.keyboard.destroy();
  });
});
