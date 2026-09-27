export const MOBILE_PROTOCOL = 1 as const;
export const RULESET_ID = 'opf-mobile-1:b8ad53f:735e854d';
export const MOBILE_CHARACTERS = ['luffy', 'akainu', 'labubu', 'twinkle'] as const;
export type MobileCharacterId = typeof MOBILE_CHARACTERS[number];

export interface NetworkSetup {
  type: 'setup';
  protocol: typeof MOBILE_PROTOCOL;
  ruleset: typeof RULESET_ID;
  sessionId: string;
  seed: number;
  p1: MobileCharacterId;
  p2: MobileCharacterId;
}
export interface NetworkResult {
  winner: 0 | 1;
  wins: readonly [number, number];
  frame: number;
  checksum: string;
}

export function isMobileCharacter(value: unknown): value is MobileCharacterId {
  return typeof value === 'string' && (MOBILE_CHARACTERS as readonly string[]).includes(value);
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
export function isSessionId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value); }
export function parseNetworkSetup(value: unknown): NetworkSetup | null {
  if (!isRecord(value) || !hasExactKeys(value, ['type', 'protocol', 'ruleset', 'sessionId', 'seed', 'p1', 'p2'])
    || value.type !== 'setup' || value.protocol !== MOBILE_PROTOCOL || value.ruleset !== RULESET_ID
    || !isSessionId(value.sessionId) || !Number.isInteger(value.seed) || (value.seed as number) < 0 || (value.seed as number) > 0xffffffff
    || !isMobileCharacter(value.p1) || !isMobileCharacter(value.p2)) return null;
  return value as unknown as NetworkSetup;
}
export function createNetworkSetup(p1: MobileCharacterId, p2: MobileCharacterId): NetworkSetup {
  const random = crypto.getRandomValues(new Uint8Array(16));
  return { type: 'setup', protocol: MOBILE_PROTOCOL, ruleset: RULESET_ID,
    sessionId: Array.from(random, byte => byte.toString(16).padStart(2, '0')).join(''),
    seed: crypto.getRandomValues(new Uint32Array(1))[0]!, p1, p2 };
}

export interface HelloPacket { type: 'hello'; protocol: typeof MOBILE_PROTOCOL; ruleset: typeof RULESET_ID; role: 'host' | 'guest'; character: MobileCharacterId }
export interface ChoicePacket { type: 'choice'; seq: number; character: MobileCharacterId; ready: boolean }
export interface LobbyPacket { type: 'lobby'; sessionId: string }
export function parseHello(value: unknown): HelloPacket | null {
  if (!isRecord(value) || !hasExactKeys(value, ['type', 'protocol', 'ruleset', 'role', 'character'])
    || value.type !== 'hello' || value.protocol !== MOBILE_PROTOCOL || value.ruleset !== RULESET_ID
    || (value.role !== 'host' && value.role !== 'guest') || !isMobileCharacter(value.character)) return null;
  return value as unknown as HelloPacket;
}
export function parseChoice(value: unknown): ChoicePacket | null {
  if (!isRecord(value) || !hasExactKeys(value, ['type', 'seq', 'character', 'ready']) || value.type !== 'choice'
    || !Number.isSafeInteger(value.seq) || (value.seq as number) < 1 || (value.seq as number) > 1_000_000
    || !isMobileCharacter(value.character) || typeof value.ready !== 'boolean') return null;
  return value as unknown as ChoicePacket;
}
export function parseLobby(value: unknown): LobbyPacket | null {
  return isRecord(value) && hasExactKeys(value, ['type', 'sessionId']) && value.type === 'lobby' && isSessionId(value.sessionId)
    ? value as unknown as LobbyPacket : null;
}
