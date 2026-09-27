import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ready: vi.fn(() => false), setModes: vi.fn() }));
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/render/assets', () => ({ areAnimeInterfacesReady: mocks.ready, interfaceFrame: vi.fn(), spriteFrame: vi.fn(), loadAnimeInterfaces: vi.fn() }));
vi.mock('../../src/input/InputHub', () => ({ getInputHub: () => ({ controlModes: ['simple', 'simple'], setControlModes: mocks.setModes }) }));
vi.mock('../../src/audio/Sfx', () => ({ sfx: vi.fn() }));
import { TitleScene } from '../../src/render/scenes/TitleScene';
import { CharacterSelectScene } from '../../src/render/scenes/CharacterSelectScene';

function mount<T extends TitleScene | CharacterSelectScene>(scene: T) {
  const values = new Map<string, unknown>(), start = vi.fn();
  Object.assign(scene, { registry: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) }, scene: { start } });
  return { scene, start };
}
beforeEach(() => { vi.clearAllMocks(); mocks.ready.mockReturnValue(false); });

describe('central menu interface gates', () => {
  it('gates a direct return to Title before drawing or reading uncreated controls', () => {
    const { scene, start } = mount(new TitleScene());
    scene.init({ art: 'anime', quality: 'high', scope: 'full' }); scene.create();
    expect(mocks.ready).toHaveBeenCalledWith(scene, ['labubu', 'twinkle']);
    expect(start).toHaveBeenCalledWith('Preload', expect.objectContaining({ destination: 'Title', art: 'anime', quality: 'high' }));
    expect(() => scene.update(0, 17)).not.toThrow();
  });

  it('gates every selection entry and preserves existing match settings', () => {
    const { scene, start } = mount(new CharacterSelectScene());
    scene.init({ p1: 'twinkle', p2: 'labubu', mode: 'cpu', difficulty: 'hard', tutorial: true,
      controlModes: ['classic', 'simple'], art: 'anime', quality: 'high', scope: 'full' }); scene.create();
    expect(mocks.ready).toHaveBeenCalledWith(scene, ['luffy', 'akainu', 'labubu', 'twinkle']);
    expect(start).toHaveBeenCalledWith('Preload', expect.objectContaining({ destination: 'CharacterSelect',
      p1: 'twinkle', p2: 'labubu', mode: 'cpu', difficulty: 'hard', tutorial: true,
      controlModes: ['classic', 'simple'], art: 'anime', quality: 'high', scope: 'full' }));
    expect(() => scene.update(0, 17)).not.toThrow();
  });
});
