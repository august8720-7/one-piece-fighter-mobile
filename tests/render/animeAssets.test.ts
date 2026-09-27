import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimeRuntimeManifest } from '../../src/render/animations';

// These intentionally synthetic PNG/runtime bytes have their own content checks;
// they must not be resolved through the unrelated generated production manifest.
const delivery = vi.hoisted(() => ({ version: 'fixtures', records: {} as Record<string, unknown> }));
vi.mock('../../src/render/deliveryManifest.json', () => ({ default: delivery }));

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } } } }));
vi.mock('../../src/render/anime/uiArtManifest.json', () => ({ default: { schemaVersion: 1, characters: Object.fromEntries(['luffy', 'akainu'].map(id => [id, {
  image: `assets/characters/${id}/anime/ui-0913.png`, sha256: '91086ccb573b998c1b20821323e09709e71cfd78b5166b33453be5ffb73e678e', width: 512, height: 512,
  frames: { body: { x: 0, y: 0, w: 512, h: 512 }, portrait: { x: 100, y: 0, w: 120, h: 120 } },
}])) } }));
import { ANIME_CHARACTERS, ANIME_ERRORS, ANIME_INTERFACES, areAnimeInterfacesReady, interfaceFrame, loadAnimeCharacters, loadAnimeInterfaces, type AnimeCharacterAssets } from '../../src/render/assets';
import { ASSET_DOWNLOAD_TIMEOUT, ASSET_DOWNLOAD_ATTEMPTS } from '../../src/render/assetDownloads';
import { adoptPresentation } from '../../src/render/presentation';

function candidate() {
  const runtime: AnimeRuntimeManifest = {
    schemaVersion: 1, characterId: 'luffy', style: 'anime', continuous: true,
    atlas: { image: 'atlas.png', data: 'atlas.json' },
    anims: { idle: { frames: 1, fps: 60, pixelArt: false, loop: true, exposures: [{ frame: 0, ticks: 8 }] } },
    attachments: { 'luffy/idle/0': { size: { width: 40, height: 80 }, root: { x: 20, y: 80 }, sockets: {} } },
  };
  return {
    runtime,
    atlas: { frames: { 'luffy/idle/0': { frame: { x: 0, y: 0, w: 40, h: 80 }, pivot: { x: 0.5, y: 1 } } } },
    imageBytes: 'candidate PNG bytes A',
    failDecode: false,
  };
}

type Texture = { image: HTMLImageElement; data: unknown; setFilter: ReturnType<typeof vi.fn> };
function fakeScene() {
  const values = new Map<string, unknown>();
  const textures = new Map<string, Texture>();
  const addAtlas = vi.fn((key: string, image: HTMLImageElement, data: unknown) => {
    const texture = { image, data, setFilter: vi.fn(), has: (frame: string) => !!(data as { frames: Record<string, unknown> }).frames[frame] };
    textures.set(key, texture);
    return texture;
  });
  const remove = vi.fn();
  const scene = {
    registry: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) },
    textures: { exists: (key: string) => textures.has(key), get: (key: string) => textures.get(key), addAtlas, remove },
  } as unknown as Phaser.Scene;
  const assets = () => values.get(ANIME_CHARACTERS) as AnimeCharacterAssets;
  return { scene, textures, addAtlas, remove, assets, values };
}

let bundle: ReturnType<typeof candidate>;
let requestedImages: string[];
beforeEach(() => {
  for (const key of Object.keys(delivery.records)) delete delivery.records[key];
  bundle = candidate();
  requestedImages = [];
  let objectId = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:candidate-${++objectId}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('Image', class {
    naturalWidth = 512;
    naturalHeight = 512;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      if (!url) return;
      requestedImages.push(url);
      queueMicrotask(() => bundle.failDecode ? this.onerror?.() : this.onload?.());
    }
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const characterJson = (value: unknown) => JSON.stringify(value).replaceAll('luffy', url.includes('/akainu/') ? 'akainu' : 'luffy');
    if (url.endsWith('runtime.json')) return new Response(characterJson(bundle.runtime));
    if (url.endsWith('atlas.json')) return new Response(characterJson(bundle.atlas));
    if (url.endsWith('atlas.png')) return new Response(bundle.imageBytes, { headers: { 'Content-Type': 'image/png' } });
    if (url.endsWith('ui-0913.png')) return new Response('UI PNG bytes', { headers: { 'Content-Type': 'image/png' } });
    throw new Error(`Unexpected URL: ${url}`);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('candidate asset reloads', () => {
  it('only declares a menu ready for its validated source version and both UI frames', async () => {
    const state = fakeScene();
    expect(areAnimeInterfacesReady(state.scene, ['luffy'])).toBe(false);
    expect((await loadAnimeInterfaces(state.scene, ['luffy'])).ok).toBe(true);
    expect(areAnimeInterfacesReady(state.scene, ['luffy'])).toBe(true);
    expect(areAnimeInterfacesReady(state.scene, ['luffy', 'akainu'])).toBe(false);
    const loaded = state.values.get(ANIME_INTERFACES) as Record<string, { key: string; version: string; sourceIdentity: string }>;
    loaded.luffy!.sourceIdentity = 'different-source';
    expect(areAnimeInterfacesReady(state.scene, ['luffy'])).toBe(false);
  });

  it('fails a newly installed UI missing a required frame instead of entering a scene loop', async () => {
    const state = fakeScene(), install = state.addAtlas.getMockImplementation()!;
    state.addAtlas.mockImplementationOnce((key, image, data) => {
      const frames = { ...(data as { frames: Record<string, unknown> }).frames };
      delete frames['luffy/ui/portrait'];
      return install(key, image, { frames });
    });
    expect(await loadAnimeInterfaces(state.scene, ['luffy'])).toMatchObject({ ok: false, failures: [{ code: 'invalid' }] });
    expect(areAnimeInterfacesReady(state.scene, ['luffy'])).toBe(false);
  });

  it('reuses a fully registered delivery version without fetching or decoding it again', async () => {
    const state = fakeScene();
    const first = await loadAnimeCharacters(state.scene, ['luffy']);
    // These markers exercise the version fast path; no network record is read.
    delivery.records['assets/characters/luffy/anime/runtime.json'] = {};
    delivery.records['assets/characters/luffy/anime/ui-0913.png'] = {};
    expect(state.values.get(ANIME_INTERFACES)).toBeTruthy();
    vi.mocked(fetch).mockClear(); state.addAtlas.mockClear(); requestedImages.length = 0;
    const second = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(second.ok).toBe(true);
    expect(second.assets.luffy).toBe(first.assets.luffy);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.addAtlas).not.toHaveBeenCalled();
    expect(requestedImages).toHaveLength(0);
  });

  it('joins background preparation during character selection without losing the other fighter', async () => {
    const state = fakeScene();
    const [background, selection] = await Promise.all([
      loadAnimeCharacters(state.scene, ['luffy', 'akainu']), loadAnimeCharacters(state.scene, ['luffy']),
    ]);
    expect(background.ok && selection.ok).toBe(true);
    expect(Object.keys(state.assets()).sort()).toEqual(['akainu', 'luffy']);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(state.addAtlas).toHaveBeenCalledTimes(4);
    expect(requestedImages).toHaveLength(4);
  });
  it('loads identical PNG bytes when the host cannot stream a response into Blob storage', async () => {
    const baseline = fakeScene();
    await loadAnimeCharacters(baseline.scene, ['luffy']);
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      const response = await base(...args);
      if (String(args[0]).endsWith('.png')) vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('Failed to fetch'));
      return response;
    });
    const state = fakeScene();
    expect((await loadAnimeCharacters(state.scene, ['luffy'])).ok).toBe(true);
    expect(state.assets().luffy!.key).toBe(baseline.assets().luffy!.key);
    expect(state.assets().luffy!.uiKey).toBe(baseline.assets().luffy!.uiKey);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });
  it.each(['request', 'body'] as const)('retries one transient PNG %s failure and still validates the full bundle', async failure => {
    const base = vi.mocked(fetch).getMockImplementation()!;
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/atlas.png') && ++attempts === 1) {
        if (failure === 'request') throw new TypeError('Failed to fetch');
        const response = new Response('interrupted');
        vi.spyOn(response, 'arrayBuffer').mockRejectedValue(new TypeError('Failed to fetch'));
        return response;
      }
      return base(...args);
    });
    const state = fakeScene();
    expect((await loadAnimeCharacters(state.scene, ['luffy'])).ok).toBe(true);
    expect(attempts).toBe(2);
    expect(state.assets().luffy!.key).toMatch(/^luffy-anime-[a-f0-9]{64}$/);
  });

  it.each(['network', '404'] as const)('persistent %s failure remains an explicit failure with no old-bundle reuse', async failure => {
    const state = fakeScene();
    await loadAnimeCharacters(state.scene, ['luffy']);
    const base = vi.mocked(fetch).getMockImplementation()!;
    let attempts = 0;
    vi.mocked(fetch).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/atlas.png')) {
        attempts++;
        if (failure === 'network') throw new TypeError('Failed to fetch');
        return new Response('', { status: 404 });
      }
      return base(...args);
    });
    const result = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(result.ok).toBe(false);
    expect(result.assets.luffy).toBeUndefined();
    expect(attempts).toBe(failure === 'network' ? 2 : 1);
  });
  it.each(['valid', 'missing', 'wrong-size'] as const)('foreground %s remains part of the strict resource gate', async condition => {
    const frame = 'luffy/idle/0/foreground';
    bundle.runtime.foregroundFrames = { 'luffy/idle/0': frame };
    bundle.runtime.attachments[frame] = structuredClone(bundle.runtime.attachments['luffy/idle/0']!);
    const frames = bundle.atlas.frames as Record<string, typeof bundle.atlas.frames['luffy/idle/0']>;
    if (condition !== 'missing') frames[frame] = { frame: { x: 40, y: 0, w: condition === 'wrong-size' ? 39 : 40, h: 80 }, pivot: { x: 0.5, y: 1 } };
    const state = fakeScene();
    const result = await loadAnimeCharacters(state.scene, ['luffy']);
    if (condition === 'valid') {
      expect(result.ok).toBe(true);
      expect(result.assets.luffy!.frameTextures![frame]).toBe(result.assets.luffy!.key);
    } else {
      expect(result.ok).toBe(false);
      expect(result.errors.luffy).toContain(frame);
      expect(state.addAtlas.mock.calls.every(([key]) => key.includes('-anime-ui-'))).toBe(true);
    }
  });

  it('shows a readable missing-art reason for development-server HTML fallback', async () => {
    const state = fakeScene();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } })));
    await loadAnimeCharacters(state.scene, ['luffy']);
    expect(state.assets()).toEqual({});
    expect(state.values.get(ANIME_ERRORS)).toEqual({ luffy: 'assets/characters/luffy/anime/runtime.json：资源未找到，服务器返回了网页' });
  });

  it.each(['runtime', 'atlas', 'image'] as const)('changing %s creates a new immutable texture without destroying a live reference', async part => {
    const state = fakeScene();
    await loadAnimeCharacters(state.scene, ['luffy']);
    const previous = state.assets().luffy!;
    const activeFightTexture = state.textures.get(previous.key);
    expect(previous.key).toMatch(/^luffy-anime-[a-f0-9]{64}$/);
    if (part === 'runtime') bundle.runtime.attachments['luffy/idle/0']!.root.x = 19;
    if (part === 'atlas') bundle.atlas.frames['luffy/idle/0'].pivot.x = 0.4;
    if (part === 'image') bundle.imageBytes = 'candidate PNG bytes B';
    await loadAnimeCharacters(state.scene, ['luffy']);
    const current = state.assets().luffy!;
    expect(current.key).not.toBe(previous.key);
    expect(state.textures.get(previous.key)).toBe(activeFightTexture);
    expect(state.textures.get(current.key)).not.toBe(activeFightTexture);
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.addAtlas).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(8);
    expect(current.uiKey).toBe(previous.uiKey);
    for (const [, options] of vi.mocked(fetch).mock.calls) expect(options?.cache).toBe('no-cache');
    expect(requestedImages).toHaveLength(4);
    for (const url of requestedImages) expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('reuses only an identical complete bundle and loads duplicate character IDs once', async () => {
    const state = fakeScene();
    await loadAnimeCharacters(state.scene, ['luffy', 'luffy']);
    const previous = state.assets().luffy!;
    await loadAnimeCharacters(state.scene, ['luffy']);
    expect(state.assets().luffy!.key).toBe(previous.key);
    expect(state.addAtlas).toHaveBeenCalledTimes(2);
    expect(state.assets().luffy!.uiKey).toBe(previous.uiKey);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(8);
  });

  it.each(['luffy', 'akainu'] as const)('a %s mirror match retains both title and selection portraits without reloading the other fighter', async selected => {
    const state = fakeScene();
    adoptPresentation(state.scene.registry, { art: 'anime', scope: 'full', quality: 'high' });
    const initial = await loadAnimeCharacters(state.scene, ['luffy', 'akainu']);
    expect(initial.ok).toBe(true);
    const other = selected === 'luffy' ? 'akainu' : 'luffy';
    const previous = initial.assets[other]!;
    const textureCount = state.textures.size;
    vi.mocked(fetch).mockClear();
    const mirror = await loadAnimeCharacters(state.scene, [selected, selected]);
    expect(mirror.ok).toBe(true);
    expect(mirror.requested).toEqual([selected]);
    expect(mirror.assets[other]).toBe(previous);
    expect(state.assets()[other]).toBe(previous);
    for (const id of ['luffy', 'akainu']) for (const kind of ['body', 'portrait'] as const) {
      expect(interfaceFrame(state.scene, id, kind)).toEqual({ key: mirror.assets[id]!.uiKey, frame: `${id}/ui/${kind}` });
    }
    expect(state.textures.size).toBe(textureCount);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(4);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes(`/${selected}/`))).toBe(true);
  });

  it.each(['download', 'decode', 'geometry'] as const)('a selected fighter %s failure stays visible while the unrequested fighter and retry remain usable', async failure => {
    const state = fakeScene();
    adoptPresentation(state.scene.registry, { art: 'anime', scope: 'full', quality: 'high' });
    const initial = await loadAnimeCharacters(state.scene, ['luffy', 'akainu']);
    expect(initial.ok).toBe(true);
    const previous = initial.assets.luffy!;
    const other = initial.assets.akainu!;
    const normalFetch = fetch;
    if (failure === 'download') vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    if (failure === 'decode') bundle.failDecode = true;
    if (failure === 'geometry') bundle.atlas.frames['luffy/idle/0'].frame.w = 41;
    const failed = await loadAnimeCharacters(state.scene, ['luffy', 'luffy']);
    expect(failed.ok).toBe(false);
    expect(failed.failures[0]?.characterId).toBe('luffy');
    expect(failed.assets.luffy).toBeUndefined();
    expect(state.assets().luffy).toBeUndefined();
    // Combat remains blocked, while independently verified menu art stays usable.
    if (failure === 'decode') expect(interfaceFrame(state.scene, 'luffy', 'body')).toBeNull();
    else expect(interfaceFrame(state.scene, 'luffy', 'body')).toEqual({ key: previous.uiKey, frame: 'luffy/ui/body' });
    expect(failed.errors.luffy).toBeTruthy();
    expect(failed.assets.akainu).toBe(other);
    expect(interfaceFrame(state.scene, 'akainu', 'body')).toEqual({ key: other.uiKey, frame: 'akainu/ui/body' });
    expect(state.textures.has(previous.key)).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', normalFetch);
    bundle = candidate();
    const unrequestedRetry = await loadAnimeCharacters(state.scene, ['akainu']);
    expect(unrequestedRetry.ok).toBe(true);
    expect(unrequestedRetry.errors.luffy).toBe(failed.errors.luffy);
    expect(unrequestedRetry.assets.luffy).toBeUndefined();
    const retried = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(retried.ok).toBe(true);
    expect(retried.errors).toEqual({});
    expect(retried.assets.akainu).toBe(unrequestedRetry.assets.akainu);
    expect(interfaceFrame(state.scene, 'luffy', 'body')).toEqual({ key: previous.uiKey, frame: 'luffy/ui/body' });
  });

  it.each(['decode', 'geometry'] as const)('a failed %s leaves old live textures intact but does not label them as the new candidate', async failure => {
    const state = fakeScene();
    await loadAnimeCharacters(state.scene, ['luffy']);
    const previous = state.assets().luffy!;
    const activeFightTexture = state.textures.get(previous.key);
    if (failure === 'decode') bundle.failDecode = true;
    if (failure === 'geometry') bundle.atlas.frames['luffy/idle/0'].frame.w = 41;
    await loadAnimeCharacters(state.scene, ['luffy']);
    expect(state.assets()).toEqual({});
    expect(state.values.get(ANIME_ERRORS)).toEqual({ luffy: failure === 'decode' ? 'Image decode failed' : '动作帧不完整：luffy/idle/0' });
    expect(state.textures.get(previous.key)).toBe(activeFightTexture);
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.addAtlas).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it('returns a structured download failure and retries the actual resource successfully', async () => {
    const state = fakeScene();
    const normalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const failed = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(failed).toMatchObject({ ok: false, requested: ['luffy'], assets: {}, failures: [{ characterId: 'luffy', code: 'unavailable' }] });
    vi.stubGlobal('fetch', normalFetch);
    const retried = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(retried.ok).toBe(true);
    expect(retried.failures).toEqual([]);
    expect(retried.errors).toEqual({});
    expect(retried.assets.luffy!.frameTextures!['luffy/idle/0']).toBe(retried.assets.luffy!.key);
  });

  it('blocks textures if SHA-256 calculation fails rather than dropping integrity checks', async () => {
    const state = fakeScene();
    vi.stubGlobal('crypto', { subtle: { digest: () => Promise.reject(new Error('hash unavailable')) } });
    const result = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({ code: 'integrity' });
    expect(result.failures[0]?.message).toContain('SHA-256');
    expect(state.addAtlas).not.toHaveBeenCalled();
  });

  it('checks the same SHA-256 without SubtleCrypto and rejects same-length corrupted UI bytes', async () => {
    vi.stubGlobal('crypto', {});
    const valid = fakeScene();
    expect((await loadAnimeCharacters(valid.scene, ['luffy'])).ok).toBe(true);
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => url.endsWith('ui-0913.png')
      ? new Response('UI PNG bytex', { headers: { 'Content-Type': 'image/png' } }) : originalFetch(url, options)));
    const corrupted = fakeScene();
    const result = await loadAnimeCharacters(corrupted.scene, ['luffy']);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({ code: 'integrity' });
    expect(corrupted.addAtlas).not.toHaveBeenCalled();
  });

  it('classifies a timed-out request and allows the same character to retry', async () => {
    const state = fakeScene();
    const normalFetch = fetch;
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    try {
      const pending = loadAnimeCharacters(state.scene, ['luffy']);
      await vi.advanceTimersByTimeAsync(ASSET_DOWNLOAD_TIMEOUT * ASSET_DOWNLOAD_ATTEMPTS);
      const failed = await pending;
      expect(failed.failures[0]).toMatchObject({ code: 'timeout' });
      expect(state.addAtlas).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
    vi.stubGlobal('fetch', normalFetch);
    expect((await loadAnimeCharacters(state.scene, ['luffy'])).ok).toBe(true);
  });

  it('rejects an invalid declared animation even when a basic idle image could render', async () => {
    const state = fakeScene();
    bundle.runtime.anims.crouch = { frames: 2, fps: 60, pixelArt: false, loop: false, exposures: [{ frame: 0, ticks: 2 }, { frame: 1, ticks: 2 }] };
    const result = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(result.failures[0]).toMatchObject({ code: 'invalid' });
    expect(result.failures[0]?.message).toContain('crouch');
    expect(state.addAtlas).not.toHaveBeenCalled();
  });

  it('registers every validated page with immutable keys, without requiring idle on page two', async () => {
    const state = fakeScene();
    bundle.runtime.schemaVersion = 2;
    bundle.runtime.textureDensity = 2;
    bundle.runtime.pages = [{ id: 'p0', image: 'atlas.png', data: 'atlas.json', width: 512, height: 512 }, { id: 'p1', image: 'atlas-p1.png', data: 'atlas-p1.json', width: 512, height: 512 }];
    bundle.runtime.framePages = { 'luffy/idle/0': 'p0', 'luffy/crouch/0': 'p1' };
    bundle.runtime.anims.crouch = { ...bundle.runtime.anims.idle!, loop: false };
    bundle.runtime.attachments['luffy/crouch/0'] = { ...bundle.runtime.attachments['luffy/idle/0']! };
    const normalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('atlas-p1.json')) return new Response(JSON.stringify({ frames: { 'luffy/crouch/0': { frame: { x: 0, y: 0, w: 40, h: 80 } } } }));
      if (url.endsWith('atlas-p1.png')) return new Response('second page PNG');
      return normalFetch(url, options);
    }));
    const loaded = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(loaded.failures).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(state.addAtlas).toHaveBeenCalledTimes(3);
    const asset = loaded.assets.luffy!;
    expect(asset.frameTextures!['luffy/crouch/0']).toBe(`${asset.key}-p1`);
    expect(asset.frameTextures!['luffy/idle/0']).toBe(asset.key);
  });

  it.each(['shadow', 'undeclared'] as const)('rejects a %s frame on page two before installing any combat texture', async issue => {
    const state = fakeScene();
    bundle.runtime.schemaVersion = 2;
    bundle.runtime.textureDensity = 2;
    bundle.runtime.pages = [{ id: 'p0', image: 'atlas.png', data: 'atlas.json', width: 512, height: 512 }, { id: 'p1', image: 'atlas-p1.png', data: 'atlas-p1.json', width: 512, height: 512 }];
    bundle.runtime.framePages = { 'luffy/idle/0': 'p0', 'luffy/crouch/0': 'p1' };
    bundle.runtime.anims.crouch = { ...bundle.runtime.anims.idle!, loop: false };
    bundle.runtime.attachments['luffy/crouch/0'] = { ...bundle.runtime.attachments['luffy/idle/0']! };
    const injected = issue === 'shadow' ? 'luffy/idle/0' : 'luffy/undeclared/0';
    const pageFrames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {
      'luffy/crouch/0': { frame: { x: 0, y: 0, w: 40, h: 80 } },
      [injected]: { frame: { x: 50, y: 0, w: 40, h: 80 } },
    };
    const normalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('atlas-p1.json')) return new Response(JSON.stringify({ frames: pageFrames }));
      if (url.endsWith('atlas-p1.png')) return new Response('second page PNG');
      return normalFetch(url, options);
    }));
    const failed = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(failed.failures[0]).toMatchObject({ code: 'invalid' });
    expect(failed.failures[0]?.message).toContain(`p1/${injected}`);
    expect(state.assets()).toEqual({});
    expect(state.addAtlas.mock.calls.every(([key]) => key.includes('-anime-ui-'))).toBe(true);
    delete pageFrames[injected];
    const repaired = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(repaired.ok).toBe(true);
    expect(repaired.assets.luffy?.frameTextures?.['luffy/idle/0']).toBe(repaired.assets.luffy?.key);
    expect(repaired.assets.luffy?.frameTextures?.['luffy/crouch/0']).toBe(`${repaired.assets.luffy?.key}-p1`);
  });

  it.each(['missing', 'content'] as const)('a %s UI original rejects a complete combat bundle, preserves the old texture and recovers on retry', async issue => {
    const state = fakeScene();
    adoptPresentation(state.scene.registry, { art: 'anime', scope: 'full', quality: 'high' });
    const first = await loadAnimeCharacters(state.scene, ['luffy']);
    const previous = first.assets.luffy!;
    expect(interfaceFrame(state.scene, 'luffy', 'body')).toEqual({ key: previous.uiKey, frame: 'luffy/ui/body' });
    expect(interfaceFrame(state.scene, 'luffy', 'portrait')).toEqual({ key: previous.uiKey, frame: 'luffy/ui/portrait' });
    const originalFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => url.endsWith('ui-0913.png')
      ? issue === 'missing' ? new Response('', { status: 404 }) : new Response('wrong UI bytes') : originalFetch(url, options)));
    const failed = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(failed.failures[0]?.code).toBe(issue === 'missing' ? 'unavailable' : 'integrity');
    expect(failed.assets).toEqual({});
    expect(interfaceFrame(state.scene, 'luffy', 'portrait')).toBeNull();
    expect(state.textures.has(previous.uiKey!)).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', originalFetch);
    const retried = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(retried.ok).toBe(true);
    expect(retried.assets.luffy!.uiKey).toBe(previous.uiKey);
    expect(state.addAtlas).toHaveBeenCalledTimes(2);
    adoptPresentation(state.scene.registry, { art: 'legacy', scope: 'full', quality: 'high' });
    expect(interfaceFrame(state.scene, 'luffy', 'portrait')).toBeNull();
  });

  it('rejects an incorrectly decoded UI size even when combat geometry fits', async () => {
    vi.stubGlobal('Image', class {
      naturalWidth = 511; naturalHeight = 512;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(url: string) { if (url) queueMicrotask(() => this.onload?.()); }
    });
    const state = fakeScene();
    const failed = await loadAnimeCharacters(state.scene, ['luffy']);
    expect(failed.failures[0]).toMatchObject({ code: 'invalid', message: '人物界面图片尺寸不匹配' });
    expect(state.addAtlas).not.toHaveBeenCalled();
  });
});
