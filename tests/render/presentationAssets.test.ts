import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPresentationAssets, PRESENTATION_ASSET_LOAD_RESULT, releaseUnusedFightAssets, REQUIRED_FX_FRAMES } from '../../src/render/assets';
import { adoptPresentation } from '../../src/render/presentation';

vi.mock('../../src/render/deliveryManifest.json', () => ({ default: { version: 'fixtures', records: {} } }));

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } } } }));

// These names are the inspected stage/effect contract, independent of the generated local PNGs.
const frameNames = {
  common: ['impact', 'rebound', 'smoke'],
  akainu: ['dog', 'eruption', 'fissure', 'flame', 'magma_fist', 'melt', 'meteor', 'pierce', 'smoke'],
  luffy: ['gatling', 'giant_fist', 'impact', 'rebound', 'red_hawk', 'rubber_fist', 'shockwave', 'steam', 'wind'],
  labubu: ['impact', 'wind', 'charge'],
  twinkle: ['star', 'wave', 'impact', 'spark', 'shield'],
};
type Frame = { frame: { x: number; y: number; w: number; h: number }; rotated?: boolean; sourceSize?: { w: number; h: number } };
type Atlas = { frames: Record<string, Frame>; meta: { size: { w: number; h: number } } };
function atlas(id: keyof typeof frameNames): Atlas {
  return { frames: Object.fromEntries(frameNames[id].map((name, index) => [name, { frame: { x: index * 20, y: 0, w: 16, h: 16 } }])), meta: { size: { w: 512, h: 512 } } };
}

type FakeTexture = { image: HTMLImageElement; data: Atlas | null; getSourceImage(): HTMLImageElement; has(name: string): boolean; get(name: string): { cutX: number; cutY: number; cutWidth: number; cutHeight: number } };
function fixture(art: 'anime' | 'legacy' = 'anime', scope: 'full' | 'sample' = 'full') {
  const values = new Map<string, unknown>();
  const textures = new Map<string, FakeTexture>();
  const failedRegistrations = new Set<string>();
  const add = (key: string, image: HTMLImageElement, data: Atlas | null) => {
    if (failedRegistrations.has(key)) return null;
    const texture: FakeTexture = {
      image, data, getSourceImage: () => image,
      has: name => !!data && Object.hasOwn(data.frames, name),
      get: name => { const f = data!.frames[name]!.frame; return { cutX: f.x, cutY: f.y, cutWidth: f.w, cutHeight: f.h }; },
    };
    textures.set(key, texture); return texture;
  };
  const manager = {
    exists: (key: string) => textures.has(key), get: (key: string) => textures.get(key),
    addAtlas: vi.fn((key: string, image: HTMLImageElement, data: Atlas) => add(key, image, data)),
    addImage: vi.fn((key: string, image: HTMLImageElement) => add(key, image, null)),
    remove: vi.fn((key: string) => textures.delete(key)),
  };
  const registry = { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) };
  adoptPresentation(registry, { art, scope });
  return { scene: { registry, textures: manager } as unknown as Phaser.Scene, values, textures, manager, failedRegistrations };
}

let bundles: { common: Atlas; akainu: Atlas; luffy: Atlas; labubu: Atlas; twinkle: Atlas };
let httpFailures: Set<string>;
let brokenImages: Set<string>;
let stalledImages: Set<string>;
let jsonOverrides: Map<string, string>;
beforeEach(() => {
  bundles = { common: atlas('common'), akainu: atlas('akainu'), luffy: atlas('luffy'), labubu: atlas('labubu'), twinkle: atlas('twinkle') };
  httpFailures = new Set(); brokenImages = new Set(); stalledImages = new Set(); jsonOverrides = new Map();
  const blobSources = new WeakMap<Blob, string>();
  const NativeBlob = Blob;
  vi.stubGlobal('Blob', class extends NativeBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      if (parts[0] instanceof ArrayBuffer) blobSources.set(this, new TextDecoder().decode(parts[0]));
    }
  });
  const imageSources = new Map<string, string>();
  let nextImage = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = `blob:presentation-${++nextImage}`;
    imageSources.set(url, blobSources.get(blob as Blob)!); return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('Image', class {
    width = 512; height = 512; naturalWidth = 512; naturalHeight = 512;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(url: string) {
      if (!url) return;
      const source = imageSources.get(url)!;
      if (stalledImages.has(source)) return;
      queueMicrotask(() => brokenImages.has(source) ? this.onerror?.() : this.onload?.());
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (httpFailures.has(url)) return new Response('', { status: 404 });
    if (url.endsWith('.json')) {
      const id = url.includes('akainu') ? 'akainu' : url.includes('labubu') ? 'labubu'
        : url.includes('twinkle') ? 'twinkle' : url.includes('common') ? 'common' : 'luffy';
      return new Response(jsonOverrides.get(url) ?? JSON.stringify(bundles[id]), { headers: { 'Content-Type': 'application/json' } });
    }
    const response = new Response(url, { headers: { 'Content-Type': url.endsWith('.webp') ? 'image/webp' : 'image/png' } });
    const blob = new Blob([url]); blobSources.set(blob, url);
    response.blob = async () => blob;
    return response;
  }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('full anime stage and effect resources', () => {
  it('loads both stage files and both complete effect atlases, then validates cached textures without growth', async () => {
    const current = fixture();
    expect(REQUIRED_FX_FRAMES).toEqual({ akainu: frameNames.akainu, labubu: frameNames.labubu, luffy: frameNames.luffy, twinkle: frameNames.twinkle });
    const result = await loadPresentationAssets(current.scene);
    expect(result).toMatchObject({ ok: true, required: true, failures: [], loaded: ['marineford-backdrop', 'marineford-floor', 'fx-common', 'fx-luffy', 'fx-akainu'] });
    expect(current.values.get(PRESENTATION_ASSET_LOAD_RESULT)).toBe(result);
    for (const id of ['common', 'akainu', 'luffy'] as const) for (const name of frameNames[id]) expect(current.textures.get(`fx-${id}`)!.has(name)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(await loadPresentationAssets(current.scene)).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(current.textures.size).toBe(5);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5);
    expect(fetch).toHaveBeenCalledWith('assets/stages/marineford/backdrop.webp', expect.objectContaining({ cache: 'no-cache' }));
  });

  it.each(['backdrop', 'floor'])('reports a missing %s instead of accepting procedural scenery, and retries', async name => {
    const current = fixture(); const url = `assets/stages/marineford/${name}.webp`;
    httpFailures.add(url);
    const result = await loadPresentationAssets(current.scene);
    expect(result).toMatchObject({ ok: false, required: true, failures: [{ key: `marineford-${name}`, code: 'unavailable', message: expect.stringContaining('404') }] });
    expect(current.textures.has(`marineford-${name}`)).toBe(false);
    httpFailures.delete(url);
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true, failures: [] });
    expect(current.textures.size).toBe(5);
  });

  it.each((['common', 'akainu', 'luffy'] as const).flatMap(id => frameNames[id].map(name => [id, name] as const)))('rejects missing required %s/%s despite other valid frames', async (id, name) => {
    const current = fixture();
    delete bundles[id].frames[name];
    const result = await loadPresentationAssets(current.scene);
    expect(result).toMatchObject({ ok: false, failures: [{ key: `fx-${id}`, code: 'invalid', message: expect.stringContaining(`必需帧：${name}`) }] });
    expect(current.textures.has(`fx-${id}`)).toBe(false);
    bundles[id] = atlas(id);
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true, failures: [] });
  });

  it.each(['bad-json', 'null', 'array', 'frame-null', 'fractional', 'outside', 'rotated', 'source-size', 'meta-size'] as const)('rejects %s atlas data before registration', async issue => {
    const current = fixture(); const url = 'assets/fx/akainu.json';
    if (issue === 'bad-json') jsonOverrides.set(url, '{broken');
    if (issue === 'null') jsonOverrides.set(url, 'null');
    if (issue === 'array') jsonOverrides.set(url, '{"frames":[]}');
    if (issue === 'frame-null') jsonOverrides.set(url, JSON.stringify({ frames: { ...bundles.akainu.frames, dog: null } }));
    if (issue === 'fractional') bundles.akainu.frames.dog!.frame.x = 0.5;
    if (issue === 'outside') bundles.akainu.frames.dog!.frame.w = 513;
    if (issue === 'rotated') bundles.akainu.frames.dog!.rotated = true;
    if (issue === 'source-size') bundles.akainu.frames.dog!.sourceSize = { w: 9000, h: 16 };
    if (issue === 'meta-size') bundles.akainu.meta.size.w = 1024;
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: false, failures: [{ key: 'fx-akainu', code: 'invalid' }] });
    expect(current.manager.addAtlas.mock.calls.some(call => call[0] === 'fx-akainu')).toBe(false);
  });

  it.each(['http', 'decode'] as const)('retries a failed FX image %s without a poisoned cache or leaked object URL', async reason => {
    const current = fixture(); const url = 'assets/fx/luffy.png';
    (reason === 'http' ? httpFailures : brokenImages).add(url);
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: false, failures: [{ key: 'fx-luffy', code: reason === 'http' ? 'unavailable' : 'decode' }] });
    expect(current.textures.has('fx-luffy')).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(reason === 'http' ? 4 : 5);
    httpFailures.clear(); brokenImages.clear();
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true, failures: [] });
    expect(current.textures.size).toBe(5);
  });

  it('finishes an aborted image decode before offering retry', async () => {
    vi.useFakeTimers();
    const current = fixture(); stalledImages.add('assets/fx/akainu.png');
    const loading = loadPresentationAssets(current.scene);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await loading).toMatchObject({ ok: false, failures: [{ key: 'fx-akainu', code: 'timeout' }] });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
    stalledImages.clear();
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true, failures: [] });
  });

  it('rejects missing cached frames and removes the invalid registration so a retry really reloads it', async () => {
    const current = fixture(); await loadPresentationAssets(current.scene);
    delete current.textures.get('fx-akainu')!.data!.frames.dog;
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: false, failures: [{ key: 'fx-akainu', code: 'texture', message: expect.stringContaining('dog') }] });
    expect(current.manager.remove).toHaveBeenCalledWith('fx-akainu');
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true, failures: [] });
    expect(current.textures.size).toBe(5);
  });

  it('rejects a cached image whose dimensions have become invalid', async () => {
    const current = fixture(); await loadPresentationAssets(current.scene);
    current.textures.get('marineford-floor')!.image.width = 0;
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: false, failures: [{ key: 'marineford-floor', code: 'texture' }] });
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true });
  });

  it.each(['marineford-backdrop', 'fx-luffy'])('does not claim %s is loaded when texture registration fails', async key => {
    const current = fixture(); current.failedRegistrations.add(key);
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: false, failures: [{ key, code: 'texture' }] });
    current.failedRegistrations.clear();
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: true });
  });

  it.each([['legacy', 'full'], ['anime', 'sample']] as const)('%s/%s keeps failures optional while returning an inspectable result', async (art, scope) => {
    const current = fixture(art, scope); httpFailures.add('assets/fx/akainu.json');
    expect(await loadPresentationAssets(current.scene)).toMatchObject({ ok: false, required: false, failures: [{ key: 'fx-akainu' }] });
  });

  it('loads common plus one mirrored fighter once and never requests an unselected fighter', async () => {
    const current = fixture();
    const result = await loadPresentationAssets(current.scene, undefined, 'fight', ['luffy', 'luffy']);
    expect(result).toMatchObject({
      ok: true,
      requested: ['marineford-backdrop', 'marineford-floor', 'fx-common', 'fx-luffy'],
      loaded: ['marineford-backdrop', 'marineford-floor', 'fx-common', 'fx-luffy'],
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('akainu'), expect.anything());
  });

  it('ignores a broken unselected pack but fails an undeclared selected character explicitly', async () => {
    const current = fixture();
    httpFailures.add('assets/fx/akainu.json');
    expect(await loadPresentationAssets(current.scene, undefined, 'fight', ['luffy'])).toMatchObject({ ok: true, failures: [] });
    const unknown = await loadPresentationAssets(current.scene, undefined, 'fight', ['missing']);
    expect(unknown).toMatchObject({ ok: false, failures: [{ key: 'fx-missing', code: 'invalid', message: expect.stringContaining('未声明') }] });
    expect(fetch).not.toHaveBeenCalledWith('assets/fx/akainu.json', expect.anything());
  });

  it('fails a declared but incomplete selected fighter without borrowing an old fighter pack', async () => {
    const current = fixture();
    httpFailures.add('assets/fx/labubu/atlas.png');
    const result = await loadPresentationAssets(current.scene, undefined, 'fight', ['labubu']);
    expect(result).toMatchObject({ ok: false, failures: [{ key: 'fx-labubu', code: 'unavailable' }] });
    expect(result.requested).toContain('fx-labubu');
    expect(result.requested).not.toContain('fx-luffy');
    expect(result.requested).not.toContain('fx-akainu');
  });

  it('releases unselected decoded FX after a fight while retaining common and current textures', async () => {
    const current = fixture();
    await loadPresentationAssets(current.scene);
    expect(releaseUnusedFightAssets(current.scene, ['luffy'])).toEqual(['fx-akainu']);
    expect(current.textures.has('fx-akainu')).toBe(false);
    expect(current.textures.has('fx-luffy')).toBe(true);
    expect(current.textures.has('fx-common')).toBe(true);
    expect(current.textures.has('marineford-floor')).toBe(true);
  });
});
