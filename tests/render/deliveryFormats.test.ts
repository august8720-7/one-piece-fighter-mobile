import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryFormatSelection, resolveDeliveryRecords, type DeliveryDefinition } from '../../src/render/deliveryFormats';
import { probeAvifAlpha } from '../../src/render/avifProbe';

const logical = 'assets/characters/luffy/anime/atlas.webp';
const base: DeliveryDefinition = { file: 'assets/delivery/body.webp', sha256: 'a'.repeat(64), bytes: 100,
  contentType: 'image/webp', source: 'assets/characters/luffy/anime/atlas.png', sourceSha256: 'b'.repeat(64) };
const variant = { ...base, file: 'assets/delivery/body.avif', sha256: 'c'.repeat(64), bytes: 70, contentType: 'image/avif' };
const catalog = () => ({ [logical]: { ...base, avif: variant }, 'assets/ui/plain.webp': base });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('one page delivery format choice', () => {
  it('selects one physical variant per logical page and leaves ordinary records alone', async () => {
    const choice = new DeliveryFormatSelection(catalog());
    expect(await choice.prepare(async () => true)).toBe('avif');
    expect(choice.records()[logical]).toEqual(variant);
    expect(choice.records()['assets/ui/plain.webp']).toEqual(base);
    expect(Object.keys(choice.records())).toHaveLength(2);
    expect(choice.records()[logical]).not.toHaveProperty('avif');
  });

  it.each(['failed', 'rejected'] as const)('keeps WebP when the probe %s', async kind => {
    const choice = new DeliveryFormatSelection(catalog());
    expect(await choice.prepare(async () => { if (kind === 'rejected') throw new Error('decoder unavailable'); return false; })).toBe('webp');
    expect(choice.records()[logical]).toEqual(base);
  });

  it('times out and ignores a late positive result for all later consumers', async () => {
    vi.useFakeTimers();
    const choice = new DeliveryFormatSelection(catalog());
    let finish!: (ok: boolean) => void;
    const pending = choice.prepare(() => new Promise(resolve => { finish = resolve; }), 300);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBe('webp');
    finish(true); await Promise.resolve(); await Promise.resolve();
    expect(choice.records()[logical]).toEqual(base);
    expect(await choice.prepare(async () => true)).toBe('webp');
  });

  it('locks a safe fallback if a synchronous reader arrives before probing finishes', async () => {
    const choice = new DeliveryFormatSelection(catalog());
    const pending = choice.prepare(async () => true);
    const firstPoolRecords = choice.records();
    expect(await pending).toBe('webp');
    expect(choice.records()).toBe(firstPoolRecords);
    expect(firstPoolRecords[logical]).toEqual(base);
  });

  it('does not probe for a single-format build or an explicit compatibility opt-out', async () => {
    const probe = vi.fn(async () => true);
    expect(await new DeliveryFormatSelection({ [logical]: base }).prepare(probe)).toBe('webp');
    expect(await new DeliveryFormatSelection(catalog()).prepare(probe, 300, true)).toBe('webp');
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects an alternative for menu art or an unrelated original source', () => {
    expect(() => resolveDeliveryRecords({ 'assets/ui/menu.webp': { ...base, avif: variant } }, 'avif')).toThrow('Invalid alternate atlas');
    expect(() => resolveDeliveryRecords({ [logical]: { ...base, avif: { ...variant, sourceSha256: 'd'.repeat(64) } } }, 'avif')).toThrow('Invalid alternate atlas');
    expect(() => resolveDeliveryRecords({ [logical]: { ...base, preserveRgba: true, avif: variant } }, 'avif')).toThrow('Invalid alternate atlas');
  });
});

describe('native AVIF alpha probe', () => {
  it.each([true, false])('checks every alpha value after actual image callbacks (correct=%s)', async correct => {
    const bytes = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < 256; i++) bytes[i * 4 + 3] = i;
    if (!correct) bytes[131 * 4 + 3] = 130;
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: bytes }) }) }) });
    vi.stubGlobal('Image', class {
      naturalWidth = 16; naturalHeight = 16; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { expect(value).toMatch(/^data:image\/avif;base64,/); queueMicrotask(() => this.onload?.()); }
    });
    expect(await probeAvifAlpha(new AbortController().signal)).toBe(correct);
  });

  it('aborts an unresolved decode without accepting its late event', async () => {
    const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null }> = [];
    vi.stubGlobal('document', {});
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor() { images.push(this); }
      set src(_value: string) { /* Simulate a decoder that never settles. */ }
    });
    const controller = new AbortController(), pending = probeAvifAlpha(controller.signal);
    controller.abort(); expect(await pending).toBe(false);
    expect(images).toHaveLength(1);
    const pendingImage = images[0];
    if (!pendingImage) throw new Error('Expected the native decode to have started');
    expect(pendingImage.onload).toBeNull(); expect(pendingImage.onerror).toBeNull();
  });
});
