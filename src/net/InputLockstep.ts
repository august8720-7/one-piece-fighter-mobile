import { Btn, type InputFrame, type PlayerIndex } from '../core';

export const LOCKSTEP_INPUT_DELAY = 4;
export const LOCKSTEP_CHECK_INTERVAL = 60;
export const LOCKSTEP_MAX_FUTURE_FRAMES = 120;
export const LOCKSTEP_MAX_BUFFERED_INPUTS = 128;
export const LOCKSTEP_DEFAULT_TIMEOUT_MS = 10_000;

const MAX_INPUT_BITS = (Btn.Skill9 << 1) - 1;
// Start is a menu/pause command, never a remote combat input.
const VALID_BITS = MAX_INPUT_BITS & ~Btn.Start;
const MAX_FRAME = Number.MAX_SAFE_INTEGER - LOCKSTEP_MAX_FUTURE_FRAMES - LOCKSTEP_INPUT_DELAY;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

export interface InputPacket {
  readonly type: 'input';
  readonly sessionId: string;
  /** World frame receiving these bits; the first four frames are fixed neutral. */
  readonly frame: number;
  /** Equals frame - 4, so reordered packets remain independently verifiable. */
  readonly seq: number;
  readonly bits: number;
}

export interface HashPacket {
  readonly type: 'hash';
  readonly sessionId: string;
  /** Completed world frame: 59, 119, ... */
  readonly frame: number;
  readonly checksum: string;
}

export interface HaltPacket {
  readonly type: 'halt';
  readonly sessionId: string;
  readonly reason: string;
}

export type LockstepPacket = InputPacket | HashPacket | HaltPacket;
export type LockstepStatus = 'ready' | 'waiting' | 'timed_out' | 'halted';
export type LockstepWaitFor = 'input' | 'checksum' | null;

export interface InputLockstepOptions {
  readonly sessionId: string;
  readonly localPlayer: PlayerIndex;
  readonly inputDelay: 4;
  readonly send: (packet: LockstepPacket) => void;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function validSession(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(id);
}

function validFrame(frame: unknown): frame is number {
  return Number.isSafeInteger(frame) && (frame as number) >= 0 && (frame as number) <= MAX_FRAME;
}

function validBits(bits: unknown): bits is number {
  return Number.isSafeInteger(bits) && (bits as number) >= 0 && (bits as number) <= MAX_INPUT_BITS &&
    ((bits as number) & ~VALID_BITS) === 0;
}

/** Strict parser for packets received from the untrusted data channel. */
export function parseLockstepPacket(value: unknown): LockstepPacket | null {
  if (!record(value) || !validSession(value.sessionId)) return null;
  if (value.type === 'input') {
    if (!exactKeys(value, ['type', 'sessionId', 'frame', 'seq', 'bits']) ||
      !validFrame(value.frame) || value.frame < LOCKSTEP_INPUT_DELAY ||
      !Number.isSafeInteger(value.seq) || value.seq !== value.frame - LOCKSTEP_INPUT_DELAY ||
      !validBits(value.bits)) return null;
    return value as unknown as InputPacket;
  }
  if (value.type === 'hash') {
    if (!exactKeys(value, ['type', 'sessionId', 'frame', 'checksum']) ||
      !validFrame(value.frame) || (value.frame + 1) % LOCKSTEP_CHECK_INTERVAL !== 0 ||
      typeof value.checksum !== 'string' || !CHECKSUM_PATTERN.test(value.checksum)) return null;
    return value as unknown as HashPacket;
  }
  if (value.type === 'halt') {
    if (!exactKeys(value, ['type', 'sessionId', 'reason']) ||
      typeof value.reason !== 'string' || value.reason.length === 0 || value.reason.length > 160 ||
      [...value.reason].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
    return value as unknown as HaltPacket;
  }
  return null;
}

/** Pure 60 Hz input synchronizer. The caller owns transport, FightSim and state hashing. */
export class InputLockstep {
  readonly sessionId: string;
  readonly localPlayer: PlayerIndex;
  readonly inputDelay: 4;
  readonly timeoutMs: number;

  /** Next world frame to execute. Initial frames 0..3 are deterministic neutral. */
  frame = 0;
  status: LockstepStatus = 'ready';
  reason: string | null = null;
  waitingFor: LockstepWaitFor = null;

  private waitStarted: number | null = null;
  private readonly local = new Map<number, number>();
  private readonly remote = new Map<number, number>();
  private readonly remoteHistory = new Map<number, number>();
  private readonly localHashes = new Map<number, string>();
  private readonly remoteHashes = new Map<number, string>();

  constructor(private readonly options: InputLockstepOptions) {
    if (!validSession(options.sessionId)) throw new Error('invalid sessionId');
    if (options.localPlayer !== 0 && options.localPlayer !== 1) throw new Error('invalid localPlayer');
    if (options.inputDelay !== LOCKSTEP_INPUT_DELAY) throw new Error('inputDelay must be 4');
    if (typeof options.send !== 'function' || typeof options.now !== 'function') throw new Error('send and now are required');
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)) {
      throw new Error('invalid timeoutMs');
    }
    this.sessionId = options.sessionId;
    this.localPlayer = options.localPlayer;
    this.inputDelay = options.inputDelay;
    this.timeoutMs = options.timeoutMs ?? LOCKSTEP_DEFAULT_TIMEOUT_MS;
  }

  get waitingMs(): number {
    if (this.waitStarted === null) return 0;
    return Math.max(0, this.options.now() - this.waitStarted);
  }

  get bufferedLocal(): number { return this.local.size; }
  get bufferedRemote(): number { return this.remote.size; }
  get bufferedHashes(): number { return this.localHashes.size + this.remoteHashes.size; }

  /** Returns one input pair only when both sides have the same frame. Never predicts. */
  next(readLocal: () => number): InputFrame | null {
    if (this.status === 'halted' || this.status === 'timed_out') return null;
    if (this.frame > MAX_FRAME - this.inputDelay) return this.halt('frame limit reached');

    if (this.frame > 0 && this.frame % LOCKSTEP_CHECK_INTERVAL === 0) {
      const checkpoint = this.frame - 1;
      if (!this.localHashes.has(checkpoint)) return this.wait('checksum');
      if (!this.remoteHashes.has(checkpoint)) return this.wait('checksum');
      if (this.localHashes.get(checkpoint) !== this.remoteHashes.get(checkpoint)) return this.halt('state checksum mismatch');
    }

    if (this.frame >= this.inputDelay && !this.remote.has(this.frame)) return this.wait('input');

    // Only sample once we can execute the current frame. While waiting, keep
    // short touch presses latched in the caller's input source.
    const future = this.frame + this.inputDelay;
    if (!this.local.has(future)) {
      let bits: number;
      try { bits = readLocal(); }
      catch { return this.halt('local input read failed'); }
      if (!validBits(bits)) return this.halt('invalid local input bits');
      this.local.set(future, bits);
      if (!this.send({ type: 'input', sessionId: this.sessionId, frame: future,
        seq: future - this.inputDelay, bits })) return null;
    }

    const localBits = this.frame < this.inputDelay ? 0 : this.local.get(this.frame);
    const remoteBits = this.frame < this.inputDelay ? 0 : this.remote.get(this.frame);
    if (localBits === undefined || remoteBits === undefined) return this.halt('missing queued input');
    const result = this.localPlayer === 0
      ? { p1: localBits, p2: remoteBits } : { p1: remoteBits, p2: localBits };
    this.local.delete(this.frame);
    this.remote.delete(this.frame);
    this.frame++;
    this.status = 'ready';
    this.waitingFor = null;
    this.waitStarted = null;
    this.prune();
    return result;
  }

  receive(raw: unknown): void {
    if (this.status === 'halted' || this.status === 'timed_out') return;
    // Old sessions are harmless, even when their old payload format differs.
    if (record(raw) && validSession(raw.sessionId) && raw.sessionId !== this.sessionId) return;
    const packet = parseLockstepPacket(raw);
    if (!packet) { this.halt('invalid packet'); return; }
    if (packet.type === 'halt') { this.stop('halted', `peer: ${packet.reason}`, false); return; }
    if (packet.type === 'input') {
      if (packet.frame > this.frame + this.inputDelay + LOCKSTEP_MAX_FUTURE_FRAMES) {
        this.halt('input too far ahead'); return;
      }
      if (packet.frame < this.frame - LOCKSTEP_MAX_FUTURE_FRAMES) return;
      const previous = packet.frame < this.frame ? this.remoteHistory.get(packet.frame) : this.remote.get(packet.frame);
      if (previous !== undefined && previous !== packet.bits) { this.halt('conflicting input for frame'); return; }
      if (packet.frame < this.frame) return;
      if (this.remote.size >= LOCKSTEP_MAX_BUFFERED_INPUTS && previous === undefined) {
        this.halt('remote input buffer full'); return;
      }
      this.remote.set(packet.frame, packet.bits);
      this.remoteHistory.set(packet.frame, packet.bits);
      return;
    }
    if (packet.frame > this.frame + LOCKSTEP_MAX_FUTURE_FRAMES) { this.halt('checksum too far ahead'); return; }
    if (packet.frame < this.frame - LOCKSTEP_MAX_FUTURE_FRAMES) return;
    const prior = this.remoteHashes.get(packet.frame);
    if (prior !== undefined && prior !== packet.checksum) { this.halt('conflicting checksum for frame'); return; }
    this.remoteHashes.set(packet.frame, packet.checksum);
    const local = this.localHashes.get(packet.frame);
    if (local !== undefined && local !== packet.checksum) this.halt('state checksum mismatch');
  }

  /** Call just after stepping completed frame 59, 119, ... with a 64-char SHA-256 hex digest. */
  confirm(frame: number, checksum: string): void {
    if (this.status === 'halted' || this.status === 'timed_out') return;
    if (!validFrame(frame) || (frame + 1) % LOCKSTEP_CHECK_INTERVAL !== 0 ||
      frame !== this.frame - 1 || !CHECKSUM_PATTERN.test(checksum)) {
      this.halt('invalid local checksum'); return;
    }
    const prior = this.localHashes.get(frame);
    if (prior !== undefined) {
      if (prior !== checksum) this.halt('conflicting local checksum');
      return;
    }
    this.localHashes.set(frame, checksum);
    if (!this.send({ type: 'hash', sessionId: this.sessionId, frame, checksum })) return;
    const remote = this.remoteHashes.get(frame);
    if (remote !== undefined && remote !== checksum) this.halt('state checksum mismatch');
  }

  close(reason: string): void {
    if (this.status === 'halted' || this.status === 'timed_out') return;
    this.stop('halted', reason, true);
  }

  private wait(forWhat: Exclude<LockstepWaitFor, null>): null {
    if (this.status !== 'waiting' || this.waitingFor !== forWhat) this.waitStarted = this.options.now();
    this.status = 'waiting';
    this.waitingFor = forWhat;
    if (this.waitingMs >= this.timeoutMs) this.stop('timed_out', `${forWhat} timeout`, true);
    return null;
  }

  private halt(reason: string): null {
    this.stop('halted', reason, true);
    return null;
  }

  private stop(status: 'halted' | 'timed_out', reason: string, notify: boolean): void {
    this.status = status;
    this.reason = [...reason].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)
      .join('').trim().slice(0, 160) || 'closed';
    this.waitingFor = null;
    this.local.clear();
    this.remote.clear();
    this.remoteHistory.clear();
    this.localHashes.clear();
    this.remoteHashes.clear();
    if (notify) {
      try { this.options.send({ type: 'halt', sessionId: this.sessionId, reason: this.reason }); }
      catch { /* The local halt remains terminal even when the channel is gone. */ }
    }
  }

  private send(packet: LockstepPacket): boolean {
    try { this.options.send(packet); return true; }
    catch { this.halt('send failed'); return false; }
  }

  private prune(): void {
    const oldest = this.frame - LOCKSTEP_MAX_FUTURE_FRAMES;
    for (const frame of this.remoteHistory.keys()) if (frame < oldest) this.remoteHistory.delete(frame);
    for (const frame of this.localHashes.keys()) if (frame < oldest) this.localHashes.delete(frame);
    for (const frame of this.remoteHashes.keys()) if (frame < oldest) this.remoteHashes.delete(frame);
  }
}
