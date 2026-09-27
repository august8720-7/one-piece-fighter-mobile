import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetDownloads, ASSET_DOWNLOAD_TIMEOUT, warmFightDownloads, type DeliveryRecord } from '../../src/render/assetDownloads';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const delay = <T>(ms: number, value: T): Promise<T> => new Promise(resolve => setTimeout(() => resolve(value), ms));
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
function record(body: string, file: string): DeliveryRecord {
  return { file, bytes: body.length, sha256: hash(body), contentType: 'application/octet-stream', source: file, sourceSha256: hash(`source:${body}`) };
}

describe('public first-load downloads', () => {
  it('aborts active downloads and rejects queued work on permanent game teardown', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise<Response>(() => {});
    }));
    const pool = new AssetDownloads();
    const pending = Promise.allSettled(Array.from({ length: 8 }, (_, i) => pool.read(`${i}.png`, r => r.text())));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    pool.destroy();
    expect((await pending).every(result => result.status === 'rejected')).toBe(true);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    await expect(pool.read('later.png', r => r.text())).rejects.toThrow('游戏已退出');
  });
  it('accepts a body still downloading after eight seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers(), arrayBuffer: () => delay(12_000, new ArrayBuffer(2)) })));
    const loaded = new AssetDownloads().read('atlas.png', response => response.arrayBuffer());
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await loaded).byteLength).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps concurrency at four and gives queued files their full own deadline', async () => {
    vi.useFakeTimers();
    let active = 0; let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await delay(60_000, null); active--;
      return new Response('complete');
    }));
    const progress = vi.fn();
    const pool = new AssetDownloads(progress);
    const pending = Promise.all(Array.from({ length: 8 }, (_, i) => pool.read(`${i}.png`, r => r.text())));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toEqual(Array(8).fill('complete'));
    expect(peak).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(progress).toHaveBeenLastCalledWith({ completed: 8, url: '7.png', retry: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a timeout with a fresh signal and full deadline', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      if (signals.length === 1) return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      return delay(12_000, new Response('recovered'));
    }));
    const pending = new AssetDownloads().read('atlas.png', r => r.text());
    await vi.advanceTimersByTimeAsync(ASSET_DOWNLOAD_TIMEOUT + 12_000);
    expect(await pending).toBe('recovered');
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('stops after two timeouts and reports the exact file', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const result = new AssetDownloads().read('atlas-p1.png', r => r.text()).catch(error => error);
    await vi.advanceTimersByTimeAsync(ASSET_DOWNLOAD_TIMEOUT * 2);
    expect(await result).toMatchObject({ code: 'timeout', url: 'atlas-p1.png', message: expect.stringContaining('已尝试2次') });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([408, 429, 503])('retries temporary HTTP %i once', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(new Response('ok')));
    expect(await new AssetDownloads().read('floor.webp', r => r.text())).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['404', 'html', 'json'])('does not retry an invalid %s response as a network outage', async kind => {
    const response = kind === '404' ? new Response('', { status: 404 }) : kind === 'html' ? new Response('<html>', { headers: { 'content-type': 'text/html' } }) : new Response('{');
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(new AssetDownloads().read('runtime.json', r => r.json())).rejects.toMatchObject({ url: 'runtime.json', code: kind === 'json' ? 'invalid' : 'unavailable' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('warms only common files until selected characters are declared, with mirror and physical-file dedupe', async () => {
    const records = {
      'assets/stages/marineford/backdrop.webp': record('stage', 'assets/delivery/stage-test.webp'),
      'assets/characters/luffy/anime/runtime.json': record('luffy-bank', 'assets/delivery/luffy-test.bin'),
      'assets/characters/luffy/anime/atlas.webp': record('luffy-bank', 'assets/delivery/luffy-test.bin'),
      'assets/characters/akainu/anime/runtime.json': record('akainu', 'assets/delivery/akainu-test.json'),
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = url.includes('stage-test') ? 'stage' : url.includes('luffy-test') ? 'luffy-bank' : 'akainu';
      return new Response(body);
    }));
    const pool = new AssetDownloads(undefined, { records, cache: async () => null });
    await warmFightDownloads(pool);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith('assets/delivery/stage-test.webp', expect.anything());
    await warmFightDownloads(pool, ['luffy', 'luffy']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('assets/delivery/luffy-test.bin', expect.anything());
    expect(fetch).not.toHaveBeenCalledWith('assets/delivery/akainu-test.json', expect.anything());
  });

  it('starts the second locked fighter metadata before queued first-fighter images', async () => {
    const bodies = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`assets/characters/luffy/anime/atlas-p${i}.webp`, `image-${i}`]));
    const runtime = 'assets/characters/akainu/anime/runtime.json';
    bodies[runtime] = '{}';
    const records = Object.fromEntries(Object.entries(bodies).map(([url, body]) => [url, {
      ...record(body, `assets/delivery/${url.split('/').at(-1)}`), contentType: url.endsWith('.json') ? 'application/json' : 'image/webp',
    }]));
    const releases = new Map<string, () => void>();
    const physicalBodies = Object.fromEntries(Object.entries(records).map(([url, value]) => [value.file, bodies[url]]));
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/runtime.json') ? Promise.resolve(new Response('{}'))
      : new Promise<Response>(resolve => releases.set(url, () => resolve(new Response(physicalBodies[url]))))));
    const pool = new AssetDownloads(undefined, { records, cache: async () => null });
    const warmed = warmFightDownloads(pool, ['luffy']);
    await vi.waitFor(() => expect(releases.size).toBe(4));
    const secondFighter = warmFightDownloads(pool, ['akainu']);
    // One slot frees while three images still block. The new fighter's
    // geometry must be ready before the previously queued fifth large image.
    let runtimeReady = false;
    const geometry = pool.read(runtime, response => response.json()).then(() => { runtimeReady = true; });
    releases.get('assets/delivery/atlas-p0.webp')!();
    await vi.waitFor(() => expect(runtimeReady).toBe(true));
    await vi.waitFor(() => expect(releases.size).toBe(5));
    expect(fetch).toHaveBeenNthCalledWith(5, 'assets/delivery/runtime.json', expect.anything());
    for (const release of releases.values()) release();
    await Promise.all([geometry, warmed, secondFighter]);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('promotes a selected download ahead of queued background work while sharing its promise', async () => {
    const bodies = Object.fromEntries(['a', 'b', 'c', 'd', 'selected', 'other'].map(name => [name, name]));
    const records = Object.fromEntries(Object.keys(bodies).map(name => [name, record(name, `assets/delivery/${name}-test.bin`)]));
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const name = /\/([a-z]+)-test\.bin$/.exec(url)?.[1] ?? '';
      started.push(name);
      return new Promise<Response>(resolve => releases.set(name, () => resolve(new Response(bodies[name]))));
    }));
    const pool = new AssetDownloads(undefined, { records, cache: async () => null });
    const active = ['a', 'b', 'c', 'd'].map(name => pool.read(name, response => response.text(), 'background'));
    const selectedBackground = pool.read('selected', response => response.text(), 'background');
    const other = pool.read('other', response => response.text(), 'background');
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c', 'd']));
    const selectedCritical = pool.read('selected', response => response.text(), 'critical');
    releases.get('a')!();
    await vi.waitFor(() => expect(started.at(-1)).toBe('selected'));
    releases.get('b')!(); releases.get('c')!(); releases.get('d')!(); releases.get('selected')!();
    await vi.waitFor(() => expect(started).toContain('other'));
    releases.get('other')!();
    expect(await Promise.all([...active, selectedBackground, selectedCritical, other])).toEqual(['a', 'b', 'c', 'd', 'selected', 'selected', 'other']);
    expect(started).toEqual(['a', 'b', 'c', 'd', 'selected', 'other']);
  });
});
