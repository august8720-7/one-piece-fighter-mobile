import { beforeEach, describe, expect, it, vi } from 'vitest';
import { totalFrames, type FighterDef } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { DEFAULT_ANIMS, type AnimeRuntimeManifest } from '../../src/render/animations';
import type { AnimeLoadResult, AssetFailure, PresentationAssetLoadResult } from '../../src/render/assets';

const mocks = vi.hoisted(() => ({
  loadAnime: vi.fn(), loadInterfaces: vi.fn(async () => ({ ok: true, failures: [] as AssetFailure[] })),
  loadLegacy: vi.fn(async () => ({})), loadStage: vi.fn(), releaseUnused: vi.fn(),
  preloadAudio: vi.fn(async () => ({ fetched: 0, decoded: 0, failed: [] as string[] })),
  preloadMenu: vi.fn(async () => ({ fetched: 0, decoded: 0, failed: [] as string[] })),
  retryAudio: vi.fn(async () => ({ fetched: 0, decoded: 0, failed: [] as string[] })),
  playMusic: vi.fn(), stopMusic: vi.fn(),
}));
vi.mock('phaser', () => ({ default: { Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown' } } } }));
vi.mock('../../src/render/assets', () => ({
  ANIME_LOAD_RESULT: 'animeLoadResult', SPRITE_KEYS: 'spriteKeys',
  loadAnimeCharacters: mocks.loadAnime, loadAnimeInterfaces: mocks.loadInterfaces, loadCharacterAtlases: mocks.loadLegacy, loadPresentationAssets: mocks.loadStage,
  releaseUnusedFightAssets: mocks.releaseUnused,
}));
vi.mock('../../src/audio/Sfx', () => ({ sfx: () => ({ preload: mocks.preloadAudio, preloadMenu: mocks.preloadMenu, useDownloads: vi.fn(), retryFailed: mocks.retryAudio, playMusic: mocks.playMusic, stopMusic: mocks.stopMusic, muted: false }) }));
vi.mock('../../src/render/ui/audioQuickControls', () => ({ audioQuickControls: () => {} }));
vi.mock('../../src/render/ui/MenuList', () => ({ UI: { font: 'sans-serif', mono: 'monospace', title: '#fff', text: '#fff', dim: '#ccc', accent: '#eee' } }));
import { PreloadScene, type PreloadData } from '../../src/render/scenes/PreloadScene';

function sampleRuntime(def: FighterDef, full = false): AnimeRuntimeManifest {
  const value: AnimeRuntimeManifest = { schemaVersion: 1, characterId: def.id, style: 'anime', continuous: true, atlas: { image: 'atlas.png', data: 'atlas.json' }, anims: {}, attachments: {} };
  // Synthetic schema fixtures exercise the loader gate, not artwork quality.
  const names = full ? [...new Set([...Object.keys(DEFAULT_ANIMS), ...def.moves.map(move => move.id)])]
    : ['idle', 'walk_fwd', 'walk_back', 'crouch', 'block_stand', 'block_crouch', 'hit_stand', 'hit_crouch', 'st_a', ...(def.id === 'luffy' ? ['st_c'] : [])];
  for (const name of names) {
    const move = def.moves.find(move => move.id === name);
    value.anims[name] = { frames: 1, fps: 60, pixelArt: false, loop: !move, exposures: [{ frame: 0, ticks: move ? totalFrames(move) : 8 }] };
    if (move?.throwData) value.anims[name]!.throwExposures = [{ frame: 0, ticks: move.throwData.duration ?? totalFrames(move) }];
    value.attachments[`${def.id}/${name}/0`] = { size: { width: 40, height: 80 }, root: { x: 20, y: 80 }, sockets: {} };
  }
  return value;
}
function valid(full = false): AnimeLoadResult {
  return { ok: true, requested: ['luffy', 'akainu'], assets: { luffy: { key: 'luffy-new', runtime: sampleRuntime(luffyDef, full) }, akainu: { key: 'akainu-new', runtime: sampleRuntime(akainuDef, full) } }, failures: [], errors: {} };
}
const stageKeys = ['marineford-backdrop', 'marineford-floor', 'fx-akainu', 'fx-luffy'];
const stageReady = (): PresentationAssetLoadResult => ({ ok: true, required: true, requested: stageKeys, loaded: stageKeys, failures: [] });
const stageFailed = (key: string): PresentationAssetLoadResult => ({ ...stageReady(), ok: false, loaded: stageKeys.filter(item => item !== key), failures: [{ key, code: 'invalid', message: `${key}：必需资源损坏` }] });

const entry: PreloadData = { p1: 'luffy', p2: 'akainu', mode: 'training', art: 'anime', scope: 'sample', quality: 'high' };
function fixture(data: PreloadData = entry) {
  const values = new Map<string, unknown>();
  const controls = new Map<string, () => void>();
  const text = (label = '') => {
    const object = {
      visible: true, destroy: vi.fn(),
      setOrigin: () => object, setDepth: () => object, setInteractive: () => object,
      setVisible: (visible: boolean) => { object.visible = visible; return object; },
      setText: () => object,
      once: (_event: string, callback: () => void) => { controls.set(label, callback); return object; },
      on: (_event: string, callback: () => void) => { controls.set(label, callback); return object; },
    };
    return object;
  };
  const scene = new PreloadScene();
  const navigation = { start: vi.fn(), restart: vi.fn(), isActive: () => true };
  Object.assign(scene, {
    scene: navigation,
    registry: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) },
    add: { rectangle: () => text(), text: (_x: number, _y: number, label: string) => text(label) },
    events: { once: vi.fn() },
  });
  scene.init(data);
  return { scene, navigation, values, controls };
}
const flush = async () => { for (let tick = 0; tick < 10; tick++) await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.loadStage.mockResolvedValue(stageReady());
  mocks.loadInterfaces.mockResolvedValue({ ok: true, failures: [] });
  mocks.preloadAudio.mockResolvedValue({ fetched: 0, decoded: 0, failed: [] });
});

describe('preload prevents invalid battles', () => {
  it('does not create Fight until resource loading has finished', async () => {
    const current = fixture();
    let resolve!: (result: AnimeLoadResult) => void;
    mocks.loadAnime.mockImplementation(() => new Promise<AnimeLoadResult>(done => { resolve = done; }));
    current.scene.create();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(mocks.preloadAudio).toHaveBeenCalledTimes(1);
    current.values.set('animeLoadResult', valid());
    resolve(valid());
    await flush();
    expect(current.navigation.start).toHaveBeenCalledWith('Fight', expect.objectContaining({ art: 'anime', scope: 'sample', quality: 'high' }));
    expect(mocks.loadLegacy).not.toHaveBeenCalled();
    expect(mocks.preloadAudio).toHaveBeenCalledTimes(1);
  });

  it('download failure shows retry and explicit legacy, and retry carries the original profile', async () => {
    const current = fixture();
    const failure: AnimeLoadResult = { ok: false, requested: ['luffy'], assets: {}, errors: { luffy: 'HTTP 404' }, failures: [{ characterId: 'luffy', code: 'unavailable', message: 'HTTP 404' }] };
    mocks.loadAnime.mockImplementation(async () => { current.values.set('animeLoadResult', failure); return failure; });
    current.scene.create();
    await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(mocks.loadLegacy).not.toHaveBeenCalled();
    expect(mocks.preloadAudio).toHaveBeenCalledTimes(1);
    current.controls.get('重新载入')!();
    expect(current.navigation.restart).toHaveBeenLastCalledWith(expect.objectContaining({ art: 'anime', scope: 'sample', quality: 'high' }));
    current.controls.get('主动进入旧版')!();
    expect(current.navigation.restart).toHaveBeenLastCalledWith(expect.objectContaining({ art: 'legacy', scope: 'full', quality: 'high' }));
  });

  it('full-mode requests stay blocked when only sample coverage exists', async () => {
    const current = fixture({ ...entry, mode: 'cpu', scope: 'full' });
    mocks.loadAnime.mockImplementation(async () => { current.values.set('animeLoadResult', valid()); return valid(); });
    current.scene.create();
    await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(current.values.get('presentationLoadResult')).toMatchObject({ ok: false, art: 'anime', scope: 'full' });
  });

  it('a defensive Fight failure renders directly without entering a reload loop', () => {
    const current = fixture({ ...entry, failure: ['纹理已丢失'] });
    current.scene.create();
    expect(mocks.loadAnime).not.toHaveBeenCalled();
    expect(current.navigation.start).not.toHaveBeenCalled();
    current.controls.get('重新载入')!();
    const data = current.navigation.restart.mock.calls[0]![0] as PreloadData;
    expect(data.failure).toBeUndefined();
    expect(data.art).toBe('anime');
  });

  it.each(stageKeys)('full anime blocks %s failure and retries the same full match successfully', async key => {
    const current = fixture({ ...entry, mode: 'cpu', scope: 'full' });
    mocks.loadAnime.mockImplementation(async () => { const result = valid(true); current.values.set('animeLoadResult', result); return result; });
    mocks.loadStage.mockResolvedValue(stageFailed(key));
    current.scene.create();
    await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(current.values.get('presentationLoadResult')).toMatchObject({ ok: false, scope: 'full', issues: [`${key}：必需资源损坏`] });
    expect(mocks.loadLegacy).not.toHaveBeenCalled();
    current.controls.get('重新载入')!();
    const retry = current.navigation.restart.mock.calls[0]![0] as PreloadData;
    expect(retry).toMatchObject({ mode: 'cpu', art: 'anime', scope: 'full' });
    mocks.loadStage.mockResolvedValue(stageReady());
    current.scene.init(retry); current.scene.create();
    await flush();
    expect(current.navigation.start).toHaveBeenCalledWith('Fight', expect.objectContaining({ art: 'anime', scope: 'full', mode: 'cpu' }));
  });

  it('the menu gate still blocks a missing required backdrop', async () => {
    const current = fixture({ ...entry, scope: 'full', destination: 'Title' });
    mocks.loadAnime.mockImplementation(async () => { current.values.set('animeLoadResult', valid()); return valid(); });
    let complete!: (result: PresentationAssetLoadResult) => void;
    mocks.loadStage.mockImplementation(() => new Promise<PresentationAssetLoadResult>(resolve => { complete = resolve; }));
    current.scene.create(); await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    complete(stageFailed('marineford-backdrop')); await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(current.controls.has('重新载入')).toBe(true);
  });

  it('admits an interactive menu without requesting the complete combat atlas or battle sounds', async () => {
    const current = fixture({ ...entry, scope: 'full', destination: 'Title' });
    mocks.loadStage.mockResolvedValue({ ...stageReady(), requested: ['marineford-backdrop'], loaded: ['marineford-backdrop'] });
    current.scene.create(); await flush();
    expect(current.navigation.start).toHaveBeenCalledWith('Title', expect.objectContaining({ art: 'anime' }));
    expect(mocks.loadAnime).not.toHaveBeenCalled();
    expect(mocks.preloadAudio).not.toHaveBeenCalled();
    expect(mocks.loadInterfaces).toHaveBeenCalledWith(current.scene, ['labubu', 'twinkle'], expect.anything());
    expect(mocks.preloadMenu).toHaveBeenCalledTimes(1);
    expect(mocks.playMusic).not.toHaveBeenCalled();
    expect(mocks.stopMusic).not.toHaveBeenCalled();
    expect(mocks.loadStage).toHaveBeenCalledWith(current.scene, expect.anything(), 'menu', []);
    expect(mocks.releaseUnused).not.toHaveBeenCalled();
  });

  it('waits for the whole selection UI and preserves match choices without leaking routing flags', async () => {
    const current = fixture({ ...entry, p1: 'twinkle', p2: 'labubu', mode: 'cpu', difficulty: 'hard', tutorial: true,
      controlModes: ['classic', 'simple'], scope: 'full', destination: 'CharacterSelect', retryAudio: true });
    let done!: (result: { ok: boolean; failures: [] }) => void;
    mocks.loadInterfaces.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
    current.scene.create();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(mocks.loadInterfaces).toHaveBeenCalledWith(current.scene, ['luffy', 'akainu', 'labubu', 'twinkle'], expect.anything());
    expect(mocks.playMusic).not.toHaveBeenCalled();
    expect(mocks.releaseUnused).not.toHaveBeenCalled();
    done({ ok: true, failures: [] }); await flush();
    expect(current.navigation.start).toHaveBeenCalledWith('CharacterSelect', expect.objectContaining({
      p1: 'twinkle', p2: 'labubu', mode: 'cpu', difficulty: 'hard', tutorial: true, controlModes: ['classic', 'simple'], art: 'anime', scope: 'full',
    }));
    const data = current.navigation.start.mock.calls[0]![1];
    expect(data).not.toHaveProperty('destination'); expect(data).not.toHaveProperty('retryAudio');
    expect(mocks.loadAnime).not.toHaveBeenCalled();
  });

  it('a missing selection portrait stops at the retry page instead of bouncing between scenes', async () => {
    const current = fixture({ ...entry, scope: 'full', destination: 'CharacterSelect' });
    mocks.loadInterfaces.mockResolvedValueOnce({ ok: false, failures: [{ characterId: 'luffy', code: 'invalid', message: 'missing portrait' }] });
    current.scene.create(); await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(current.controls.has('重新载入')).toBe(true);
    current.controls.get('重新载入')!();
    expect(current.navigation.restart).toHaveBeenCalledWith(expect.objectContaining({ destination: 'CharacterSelect' }));
  });

  it('releases only old combat textures before loading the selected fight pair', async () => {
    mocks.loadAnime.mockResolvedValue(valid());
    const current = fixture();
    current.scene.create(); await flush();
    expect(mocks.releaseUnused).toHaveBeenCalledWith(current.scene, ['luffy', 'akainu']);
  });

  it('does not admit a full match with failed required sounds', async () => {
    const current = fixture({ ...entry, mode: 'cpu', scope: 'full' });
    mocks.loadAnime.mockResolvedValue(valid(true));
    mocks.preloadAudio.mockResolvedValue({ fetched: 1, decoded: 1, failed: ['voice.ogg'] });
    current.scene.create(); await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(current.values.get('presentationLoadResult')).toMatchObject({ ok: false, issues: ['声音未能载入：voice.ogg'] });
    expect(mocks.playMusic).not.toHaveBeenCalled();
    expect(mocks.stopMusic).toHaveBeenCalledTimes(1);
    current.controls.get('重新载入')!();
    expect(current.navigation.restart).toHaveBeenCalledWith(expect.objectContaining({ retryAudio: true }));
  });

  it.each(['legacy', 'sample'] as const)('%s retains optional presentation loading', async mode => {
    const current = fixture(mode === 'legacy' ? { ...entry, art: 'legacy', mode: 'cpu' } : entry);
    mocks.loadAnime.mockImplementation(async () => { current.values.set('animeLoadResult', valid()); return valid(); });
    mocks.loadStage.mockResolvedValue({ ...stageFailed('fx-luffy'), required: false });
    current.scene.create(); await flush();
    expect(current.navigation.start).toHaveBeenCalledWith('Fight', expect.objectContaining({ art: mode === 'legacy' ? 'legacy' : 'anime' }));
  });

  it('a missing structured presentation result cannot silently admit full anime', async () => {
    const current = fixture({ ...entry, mode: 'cpu', scope: 'full' });
    mocks.loadAnime.mockImplementation(async () => { current.values.set('animeLoadResult', valid(true)); return valid(true); });
    mocks.loadStage.mockResolvedValue(undefined);
    current.scene.create(); await flush();
    expect(current.navigation.start).not.toHaveBeenCalled();
    expect(current.values.get('presentationLoadResult')).toMatchObject({ ok: false, issues: ['舞台与技能贴图加载未完成'] });
  });
});
