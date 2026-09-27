import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/mobile/sha256';

afterEach(() => vi.unstubAllGlobals());

describe('same asset integrity on HTTPS and LAN HTTP', () => {
  it.each([true, false])('matches standard SHA-256 vectors with SubtleCrypto=%s', async native => {
    vi.stubGlobal('crypto', native ? webcrypto : undefined);
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const data = Uint8Array.from({ length: 131_079 }, (_, i) => (i * 73 + 19) & 255).subarray(7);
    expect(await sha256Hex(data)).toBe(createHash('sha256').update(data).digest('hex'));
  });

  it('does not hide unexpected native cryptography failures', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: () => Promise.reject(new Error('native failure')) } });
    await expect(sha256Hex('abc')).rejects.toThrow('native failure');
  });
});
