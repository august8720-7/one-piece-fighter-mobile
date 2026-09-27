import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetDownloads, type DeliveryRecord } from '../../src/render/assetDownloads';
import { DeliveryFormatSelection } from '../../src/render/deliveryFormats';

afterEach(() => { vi.unstubAllGlobals(); });

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function record(text = 'firstSECOND', file = 'assets/delivery/sounds-test.bin'): DeliveryRecord {
  return { file, bytes: Buffer.byteLength(text), sha256: hash(text), contentType: 'audio/ogg', source: 'original.wav', sourceSha256: hash('source') };
}
function cacheFixture() {
  const stored = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: RequestInfo | URL) => stored.get(String(key))?.clone()),
    put: vi.fn(async (key: RequestInfo | URL, value: Response) => { stored.set(String(key), value.clone()); }),
    delete: vi.fn(async (key: RequestInfo | URL) => stored.delete(String(key))),
  };
  return { stored, cache, factory: async () => cache as Pick<Cache, 'match' | 'put' | 'delete'> };
}

describe('verified content delivery', () => {
  it('downloads only the resolved AVIF and never silently falls back after an integrity failure', async () => {
    const logical = 'assets/characters/luffy/anime/atlas.webp';
    const webp = { ...record('webp', 'assets/delivery/body.webp'), contentType: 'image/webp' };
    const avif = { ...record('avif', 'assets/delivery/body.avif'), contentType: 'image/avif', source: webp.source, sourceSha256: webp.sourceSha256 };
    const choice = new DeliveryFormatSelection({ [logical]: { ...webp, avif } });
    await choice.prepare(async () => true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('bad!')).mockResolvedValueOnce(new Response('avif')));
    const pool = new AssetDownloads(undefined, { records: choice.records(), cache: async () => null });
    await expect(pool.read(logical, response => response.text())).rejects.toMatchObject({ code: 'integrity' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await pool.read(logical, async response => ({ type: response.headers.get('content-type'), body: await response.text() })))
      .toEqual({ type: 'image/avif', body: 'avif' });
    expect(fetch).toHaveBeenNthCalledWith(2, avif.file, expect.objectContaining({ cache: 'reload' }));
    expect(fetch).not.toHaveBeenCalledWith(webp.file, expect.anything());
  });

  it('downloads one bank for concurrent independent clips and preserves their exact boundaries', async () => {
    const source = record();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('firstSECOND')));
    const pool = new AssetDownloads(undefined, { cache: async () => null, records: {
      a: { ...source, slice: { offset: 0, length: 5 } }, b: { ...source, slice: { offset: 5, length: 6 } },
    } });
    expect(await Promise.all([pool.read('a', r => r.text()), pool.read('b', r => r.text())])).toEqual(['first', 'SECOND']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenLastCalledWith(source.file, expect.objectContaining({ cache: 'default' }));
    expect(await pool.read('a', r => r.text())).toBe('first');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pool.diagnostics.memoryHits).toBe(1);
  });

  it('validates a persisted file before using it in a new page session', async () => {
    const saved = cacheFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('firstSECOND')));
    const options = { cache: saved.factory, records: { a: record() } };
    await new AssetDownloads(undefined, options).read('a', r => r.text());
    const second = new AssetDownloads(undefined, options);
    expect(await second.read('a', r => r.text())).toBe('firstSECOND');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.diagnostics.persistentHits).toBe(1);
  });

  it('evicts only a corrupt cached file and retrieves verified bytes', async () => {
    const saved = cacheFixture();
    saved.stored.set('http://localhost/assets/delivery/sounds-test.bin', new Response('xxxxxSECOND'));
    saved.stored.set('http://localhost/unrelated', new Response('keep'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('firstSECOND')));
    const pool = new AssetDownloads(undefined, { cache: saved.factory, records: { a: record() } });
    expect(await pool.read('a', r => r.text())).toBe('firstSECOND');
    expect(pool.diagnostics.corruptCache).toBe(1);
    expect(saved.cache.delete).toHaveBeenCalledTimes(1);
    expect(await saved.stored.get('http://localhost/unrelated')!.text()).toBe('keep');
  });

  it('does not persist invalid network bytes and permits a later retry', async () => {
    const saved = cacheFixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('xxxxxSECOND')).mockResolvedValueOnce(new Response('firstSECOND')));
    const pool = new AssetDownloads(undefined, { cache: saved.factory, records: { a: record() } });
    await expect(pool.read('a', r => r.text())).rejects.toMatchObject({ code: 'integrity' });
    expect(saved.cache.put).not.toHaveBeenCalled();
    expect(await pool.read('a', r => r.text())).toBe('firstSECOND');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(record().file, expect.objectContaining({ cache: 'reload' }));
  });

  it('bypasses HTTP reuse after explicit invalidation without weakening hash checks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('firstSECOND')));
    const pool = new AssetDownloads(undefined, { cache: async () => null, records: { a: record() } });
    await pool.read('a', r => r.text());
    await pool.invalidate('a');
    expect(await pool.read('a', r => r.text())).toBe('firstSECOND');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(record().file, expect.objectContaining({ cache: 'reload' }));
  });

  it('keeps a playable network result when cache quota is exhausted', async () => {
    const saved = cacheFixture();
    saved.cache.put.mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('firstSECOND')));
    const pool = new AssetDownloads(undefined, { cache: saved.factory, records: { a: record() } });
    expect(await pool.read('a', r => r.text())).toBe('firstSECOND');
    expect(pool.diagnostics.cacheErrors).toBe(1);
  });

  it('a new content identity cannot reuse the previous release under the same logical name', async () => {
    const saved = cacheFixture();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('firstSECOND')).mockResolvedValueOnce(new Response('changed')));
    await new AssetDownloads(undefined, { cache: saved.factory, records: { a: record() } }).read('a', r => r.text());
    const next = new AssetDownloads(undefined, { cache: saved.factory, records: { a: record('changed', 'assets/delivery/sounds-next.bin') } });
    expect(await next.read('a', r => r.text())).toBe('changed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { file: 'assets/delivery/../../secret.bin' }, { slice: { offset: 3, length: 100 } }, { bytes: -1 }, { sha256: 'bad' },
  ])('rejects malformed release metadata before any request: %j', invalid => {
    vi.stubGlobal('fetch', vi.fn());
    const pool = new AssetDownloads(undefined, { records: { a: { ...record(), ...invalid } } });
    return expect(pool.read('a', r => r.text())).rejects.toMatchObject({ code: 'invalid' });
  });
});
