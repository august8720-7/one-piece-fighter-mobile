import { sha256 } from '@noble/hashes/sha2.js';

/** Keep the same SHA-256 integrity check on LAN HTTP, where SubtleCrypto is unavailable. */
export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
    : value instanceof Uint8Array ? value : new Uint8Array(value);
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource))
    : sha256(bytes);
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
