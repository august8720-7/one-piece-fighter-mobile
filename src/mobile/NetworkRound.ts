import type { FightSim, InputFrame, PlayerIndex } from '../core';
import { InputLockstep, type LockstepPacket, parseLockstepPacket } from '../net';
import { hasExactKeys, isRecord, isSessionId, parseNetworkSetup, type NetworkResult, type NetworkSetup } from './matchProtocol';
import { sha256Hex } from './sha256';

interface LoadedPacket { readonly type: 'loaded'; readonly sessionId: string }
interface GoPacket { readonly type: 'go'; readonly sessionId: string }
interface PausePacket { readonly type: 'pause'; readonly sessionId: string; readonly seq: number; readonly paused: boolean }
interface ResultPacket extends NetworkResult { readonly type: 'result'; readonly sessionId: string }
type ControlPacket = LoadedPacket | GoPacket | PausePacket | ResultPacket;
export type NetworkRoundPacket = LockstepPacket | ControlPacket;
export type NetworkRoundStatus = 'loading' | 'ready' | 'playing' | 'paused' | 'waiting' | 'finalizing' | 'complete' | 'halted';

export interface NetworkRoundOptions {
  readonly setup: NetworkSetup;
  readonly localPlayer: PlayerIndex;
  readonly send: (packet: NetworkRoundPacket) => void;
  readonly now: () => number;
  readonly onResult: (result: NetworkResult) => void;
}

export interface NetworkRoundDiagnostics {
  readonly frame: number;
  readonly waitingFor: 'input' | 'checksum' | null;
  readonly waitingMs: number;
  readonly bufferedLocal: number;
  readonly bufferedRemote: number;
  readonly bufferedHashes: number;
  readonly localLoaded: boolean;
  readonly remoteLoaded: boolean;
  readonly goReceived: boolean;
  readonly resultSent: boolean;
  readonly resultReceived: boolean;
}

const CHECKSUM = /^[0-9a-f]{64}$/;
const MAX_CONTROL_BYTES = 1024;
const MAX_PAUSE_SEQ = 100_000;
const MAX_RESULT_FRAME = Number.MAX_SAFE_INTEGER - 120;
const GO_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 10_000;

function parseControl(raw: Record<string, unknown>): ControlPacket | null {
  if (!isSessionId(raw.sessionId)) return null;
  if (raw.type === 'loaded' && hasExactKeys(raw, ['type', 'sessionId'])) return raw as unknown as LoadedPacket;
  if (raw.type === 'go' && hasExactKeys(raw, ['type', 'sessionId'])) return raw as unknown as GoPacket;
  if (raw.type === 'pause' && hasExactKeys(raw, ['type', 'sessionId', 'seq', 'paused']) &&
    Number.isSafeInteger(raw.seq) && (raw.seq as number) > 0 && (raw.seq as number) <= MAX_PAUSE_SEQ &&
    typeof raw.paused === 'boolean') return raw as unknown as PausePacket;
  if (raw.type === 'result' && hasExactKeys(raw, ['type', 'sessionId', 'frame', 'winner', 'wins', 'checksum']) &&
    Number.isSafeInteger(raw.frame) && (raw.frame as number) > 0 && (raw.frame as number) <= MAX_RESULT_FRAME &&
    (raw.winner === 0 || raw.winner === 1) && Array.isArray(raw.wins) && raw.wins.length === 2 &&
    raw.wins.every(win => Number.isSafeInteger(win) && win >= 0 && win <= 9) &&
    typeof raw.checksum === 'string' && CHECKSUM.test(raw.checksum)) return raw as unknown as ResultPacket;
  return null;
}

/** Transport-independent browser bridge between a loaded match and pure lockstep. */
export class NetworkRound {
  readonly setup: NetworkSetup;
  readonly localPlayer: PlayerIndex;
  readonly lockstep: InputLockstep;
  localPaused = false;
  remotePaused = false;

  private localLoaded = false;
  private remoteLoaded = false;
  private goReceived = false;
  private resultSent = false;
  private remoteResult: NetworkResult | null = null;
  private localResult: NetworkResult | null = null;
  private finalizingStarted: number | null = null;
  private resultDelivered = false;
  private readySince: number | null = null;
  private stoppedReason: string | null = null;
  private disposed = false;
  private pauseSeq = 0;
  private remotePauseSeq = 0;
  private pauseStarted: number | null = null;
  private pausedElapsed = 0;
  private readonly options: NetworkRoundOptions;

  constructor(options: NetworkRoundOptions) {
    if (!parseNetworkSetup(options.setup)) throw new Error('invalid setup');
    if (options.localPlayer !== 0 && options.localPlayer !== 1) throw new Error('invalid localPlayer');
    if (typeof options.send !== 'function' || typeof options.now !== 'function' || typeof options.onResult !== 'function') {
      throw new Error('send, now and onResult are required');
    }
    this.options = options;
    this.setup = options.setup;
    this.localPlayer = options.localPlayer;
    this.lockstep = new InputLockstep({ sessionId: options.setup.sessionId, localPlayer: options.localPlayer,
      inputDelay: 4, send: packet => options.send(packet), now: () => this.activeNow() });
  }

  get status(): NetworkRoundStatus {
    if (this.disposed || this.stoppedReason !== null || this.lockstep.status === 'halted' || this.lockstep.status === 'timed_out') return 'halted';
    if (this.resultDelivered) return 'complete';
    if (!this.goReceived && this.readySince !== null && this.activeNow() - this.readySince >= GO_TIMEOUT_MS) {
      this.stoppedReason = 'go timeout';
      this.lockstep.close(this.stoppedReason);
      return 'halted';
    }
    if (this.localResult !== null && this.finalizingStarted !== null &&
      this.activeNow() - this.finalizingStarted >= RESULT_TIMEOUT_MS) {
      this.stoppedReason = 'result timeout';
      this.lockstep.close(this.stoppedReason);
      return 'halted';
    }
    if (!this.goReceived) return this.localLoaded && this.remoteLoaded ? 'ready' : 'loading';
    if (this.localPaused || this.remotePaused) return 'paused';
    if (this.localResult !== null) return 'finalizing';
    if (this.lockstep.status === 'waiting') return 'waiting';
    return 'playing';
  }

  get reason(): string | null {
    return this.stoppedReason ?? this.lockstep.reason;
  }

  get diagnostics(): NetworkRoundDiagnostics {
    void this.status;
    return { frame: this.lockstep.frame, waitingFor: this.lockstep.waitingFor,
      waitingMs: this.lockstep.waitingMs, bufferedLocal: this.lockstep.bufferedLocal,
      bufferedRemote: this.lockstep.bufferedRemote, bufferedHashes: this.lockstep.bufferedHashes,
      localLoaded: this.localLoaded, remoteLoaded: this.remoteLoaded, goReceived: this.goReceived,
      resultSent: this.resultSent, resultReceived: this.remoteResult !== null };
  }

  /** Call only after this peer has really loaded and validated its match assets. */
  markLoaded(): void {
    if (this.status === 'halted' || this.status === 'complete' || this.localLoaded) return;
    this.localLoaded = true;
    if (!this.send({ type: 'loaded', sessionId: this.setup.sessionId })) return;
    this.maybeStart();
  }

  receive(raw: unknown): void {
    if (this.status === 'halted' || this.status === 'complete') return;
    if (isRecord(raw) && typeof raw.sessionId === 'string' && raw.sessionId !== this.setup.sessionId) return;
    if (!isRecord(raw)) { this.close('invalid packet'); return; }
    let size: number;
    try { size = new TextEncoder().encode(JSON.stringify(raw)).byteLength; }
    catch { this.close('invalid packet'); return; }
    if (size > MAX_CONTROL_BYTES) { this.close('packet too large'); return; }
    if (raw.type === 'input' || raw.type === 'hash' || raw.type === 'halt') {
      if (!parseLockstepPacket(raw)) { this.close('invalid lockstep packet'); return; }
      this.lockstep.receive(raw);
      return;
    }
    const packet = parseControl(raw);
    if (!packet) { this.close('invalid control packet'); return; }
    switch (packet.type) {
      case 'loaded':
        this.remoteLoaded = true;
        this.maybeStart();
        return;
      case 'go':
        if (this.localPlayer !== 1 || !this.localLoaded || !this.remoteLoaded || this.goReceived) {
          this.close('illegal go'); return;
        }
        this.goReceived = true;
        return;
      case 'pause':
        if (packet.seq < this.remotePauseSeq) return;
        if (packet.seq === this.remotePauseSeq) {
          if (packet.paused !== this.remotePaused) this.close('conflicting pause');
          return;
        }
        this.remotePauseSeq = packet.seq;
        this.setRemotePaused(packet.paused);
        return;
      case 'result':
        if (!this.goReceived || packet.frame > this.lockstep.frame + 120) { this.close('premature result'); return; }
        if (this.remoteResult !== null && !sameResult(this.remoteResult, packet)) {
          this.close('conflicting result'); return;
        }
        this.remoteResult = { frame: packet.frame, winner: packet.winner,
          wins: [packet.wins[0], packet.wins[1]], checksum: packet.checksum };
        this.finishIfMatched();
    }
  }

  next(readLocal: () => number): InputFrame | null {
    if (this.status !== 'playing' && this.status !== 'waiting') return null;
    return this.lockstep.next(readLocal);
  }

  /** Call exactly once just after FightSim.step for the input returned by next. */
  afterStep(sim: FightSim): void {
    if (this.status === 'halted' || this.status === 'complete' || this.localResult !== null) return;
    const world = sim.state;
    if (this.lockstep.frame !== world.frame || this.lockstep.frame < 1) { this.close('simulation frame mismatch'); return; }
    const completed = this.lockstep.frame - 1;
    const isCheckpoint = (completed + 1) % 60 === 0;
    const isFinal = world.phase === 'match_end';
    if (!isCheckpoint && !isFinal) return;
    if (isFinal && (world.winner !== 0 && world.winner !== 1)) { this.close('invalid local winner'); return; }
    // Snapshot synchronously before another call can advance mutable FightSim state.
    let snapshot: string;
    try { snapshot = JSON.stringify({ world, rng: sim.rng.getState() }); }
    catch { this.close('state serialization failed'); return; }
    if (isFinal) {
      this.finalizingStarted = this.activeNow();
      this.localResult = { frame: world.frame, winner: world.winner!,
        wins: [world.wins[0], world.wins[1]], checksum: '' };
    }
    void sha256Hex(snapshot).then(checksum => {
      if (this.status === 'halted' || this.status === 'complete') return;
      if (isCheckpoint) this.lockstep.confirm(completed, checksum);
      if (this.lockstep.status === 'halted' || this.lockstep.status === 'timed_out') return;
      if (isFinal) {
        this.localResult = { frame: world.frame, winner: world.winner!,
          wins: [world.wins[0], world.wins[1]], checksum };
        this.resultSent = this.send({ type: 'result', sessionId: this.setup.sessionId,
          frame: world.frame, winner: world.winner!, wins: [world.wins[0], world.wins[1]], checksum });
        if (this.resultSent) this.finishIfMatched();
      }
    }).catch(() => this.close('checksum failed'));
  }

  setPaused(paused: boolean): void {
    if (this.status === 'halted' || this.status === 'complete' || this.localPaused === paused) return;
    if (this.pauseSeq >= MAX_PAUSE_SEQ) { this.close('pause sequence exhausted'); return; }
    this.localPaused = paused;
    this.updatePauseClock();
    this.pauseSeq++;
    this.send({ type: 'pause', sessionId: this.setup.sessionId, seq: this.pauseSeq, paused });
  }

  close(reason: string): void {
    if (this.status === 'halted' || this.status === 'complete') return;
    this.stoppedReason = reason;
    this.lockstep.close(reason);
  }

  /** UI cleanup after a completed or abandoned match; never sends a late halt. */
  dispose(): void {
    this.disposed = true;
  }

  private activeNow(): number {
    const wallNow = this.options.now();
    return wallNow - this.pausedElapsed - (this.pauseStarted === null ? 0 : Math.max(0, wallNow - this.pauseStarted));
  }

  private updatePauseClock(): void {
    const paused = this.localPaused || this.remotePaused;
    if (paused && this.pauseStarted === null) this.pauseStarted = this.options.now();
    if (!paused && this.pauseStarted !== null) {
      this.pausedElapsed += Math.max(0, this.options.now() - this.pauseStarted);
      this.pauseStarted = null;
    }
  }

  private setRemotePaused(paused: boolean): void {
    this.remotePaused = paused;
    this.updatePauseClock();
  }

  private maybeStart(): void {
    if (!this.localLoaded || !this.remoteLoaded || this.goReceived || this.status === 'halted') return;
    this.readySince ??= this.activeNow();
    if (this.localPlayer !== 0) return;
    if (this.send({ type: 'go', sessionId: this.setup.sessionId })) this.goReceived = true;
  }

  private finishIfMatched(): void {
    if (this.localResult === null || this.remoteResult === null || this.localResult.checksum === '' || this.resultDelivered) return;
    if (!sameResult(this.localResult, this.remoteResult)) { this.close('final result mismatch'); return; }
    this.resultDelivered = true;
    this.options.onResult(this.localResult);
  }

  private send(packet: NetworkRoundPacket): boolean {
    try { this.options.send(packet); return true; }
    catch { this.close('send failed'); return false; }
  }
}

function sameResult(a: NetworkResult, b: NetworkResult): boolean {
  return a.frame === b.frame && a.winner === b.winner && a.wins[0] === b.wins[0] &&
    a.wins[1] === b.wins[1] && a.checksum === b.checksum;
}
