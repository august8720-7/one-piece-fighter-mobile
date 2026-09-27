import { describe, expect, it } from 'vitest';
import { Btn } from '../../src/core';
import { InputLockstep, parseLockstepPacket, type LockstepPacket } from '../../src/net';

function make(localPlayer: 0 | 1 = 0, timeoutMs = 100) {
  const sent: LockstepPacket[] = [];
  let clock = 0;
  const lock = new InputLockstep({ sessionId: 'session-1', localPlayer, inputDelay: 4,
    send: packet => sent.push(packet), now: () => clock, timeoutMs });
  return { lock, sent, tick: (ms: number) => { clock += ms; } };
}

function input(frame: number, bits = 0, sessionId = 'session-1'): LockstepPacket {
  return { type: 'input', sessionId, frame, seq: frame - 4, bits };
}

describe('InputLockstep protocol', () => {
  it('starts with four neutral frames and samples each future frame only once after prerequisites arrive', () => {
    const { lock, sent, tick } = make(1);
    let reads = 0;
    for (let f = 0; f < 4; f++) {
      expect(lock.next(() => { reads++; return Btn.A; })).toEqual({ p1: 0, p2: 0 });
      expect(sent[f]).toEqual(input(f + 4, Btn.A));
    }
    expect(lock.frame).toBe(4);
    expect(lock.next(() => { reads++; return Btn.B; })).toBeNull();
    tick(30);
    expect(lock.next(() => { reads++; return Btn.B; })).toBeNull();
    expect(lock.status).toBe('waiting');
    expect(lock.waitingFor).toBe('input');
    expect(lock.waitingMs).toBe(30);
    expect(reads).toBe(4);
    expect(lock.bufferedLocal).toBe(4);
    lock.receive(input(4, Btn.C));
    expect(lock.next(() => { reads++; return Btn.B; })).toEqual({ p1: Btn.C, p2: Btn.A });
    expect(reads).toBe(5);
    expect(sent[4]).toEqual(input(8, Btn.B));
    expect(lock.frame).toBe(5);
    expect(lock.waitingMs).toBe(0);
    expect(lock.bufferedLocal).toBe(4);
  });

  it('accepts reordered and identical replayed inputs, but halts on a conflict', () => {
    const { lock } = make();
    lock.receive(input(6, Btn.B));
    lock.receive(input(4, Btn.A));
    lock.receive(input(6, Btn.B));
    expect(lock.bufferedRemote).toBe(2);
    for (let i = 0; i < 4; i++) lock.next(() => 0);
    expect(lock.next(() => 0)).toEqual({ p1: 0, p2: Btn.A });
    lock.receive(input(4, Btn.A));
    expect(lock.status).toBe('ready');
    lock.receive(input(4, Btn.C));
    expect(lock.status).toBe('halted');
    expect(lock.reason).toContain('conflicting input');
  });

  it('ignores obsolete sessions and rejects malformed or unbounded current-session packets', () => {
    const old = make();
    old.lock.receive({ type: 'input', sessionId: 'previous-game', frame: 4, seq: -1, bits: -1 });
    expect(old.lock.status).toBe('ready');
    expect(old.lock.bufferedRemote).toBe(0);
    old.lock.receive(input(4, Btn.A));
    expect(old.lock.bufferedRemote).toBe(1);

    const invalid = [
      { ...input(4), seq: 9 },
      { ...input(4), bits: 1 << 18 },
      { ...input(4), bits: -1 },
      { ...input(4), bits: Btn.Start },
      { ...input(4), bits: Btn.A | Btn.Start },
      { ...input(4), bits: 2 ** 32 },
      { ...input(4), bits: 2 ** 32 + Btn.A },
      { ...input(4), bits: Number.MAX_SAFE_INTEGER },
      { ...input(4), extra: 'payload' },
      { ...input(4), frame: 4.5 },
      { type: 'unexpected', sessionId: 'session-1' },
    ];
    for (const packet of invalid) {
      expect(parseLockstepPacket(packet)).toBeNull();
      const { lock } = make();
      lock.receive(packet);
      expect(lock.status).toBe('halted');
      expect(lock.reason).toBe('invalid packet');
    }
    const future = make();
    future.lock.receive(input(125));
    expect(future.lock.status).toBe('halted');
    expect(future.lock.reason).toBe('input too far ahead');
  });

  it('times out while waiting, then cannot resume a stale match', () => {
    const { lock, sent, tick } = make();
    for (let i = 0; i < 4; i++) lock.next(() => 0);
    expect(lock.next(() => 0)).toBeNull();
    tick(101);
    expect(lock.next(() => 0)).toBeNull();
    expect(lock.status).toBe('timed_out');
    expect(lock.reason).toBe('input timeout');
    expect(sent.at(-1)).toEqual({ type: 'halt', sessionId: 'session-1', reason: 'input timeout' });
    lock.receive(input(4));
    expect(lock.next(() => 0)).toBeNull();
    expect(lock.frame).toBe(4);
  });

  it('requires both checksums at the 60-frame boundary and stops on mismatch', () => {
    const { lock, sent } = make();
    for (let frame = 0; frame < 60; frame++) {
      if (frame >= 4) lock.receive(input(frame));
      expect(lock.next(() => 0)).toEqual({ p1: 0, p2: 0 });
    }
    expect(lock.frame).toBe(60);
    const digest = 'a'.repeat(64);
    lock.confirm(59, digest);
    expect(sent.at(-1)).toEqual({ type: 'hash', sessionId: 'session-1', frame: 59, checksum: digest });
    expect(lock.next(() => Btn.A)).toBeNull();
    expect(lock.waitingFor).toBe('checksum');
    lock.receive({ type: 'hash', sessionId: 'session-1', frame: 59, checksum: 'b'.repeat(64) });
    expect(lock.status).toBe('halted');
    expect(lock.reason).toBe('state checksum mismatch');
  });

  it('waits for an asynchronous local checksum and rejects conflicting same-frame hashes', () => {
    const missing = make();
    for (let frame = 0; frame < 60; frame++) {
      if (frame >= 4) missing.lock.receive(input(frame));
      missing.lock.next(() => 0);
    }
    expect(missing.lock.next(() => 0)).toBeNull();
    expect(missing.lock.status).toBe('waiting');
    expect(missing.lock.waitingFor).toBe('checksum');
    missing.lock.receive({ type: 'hash', sessionId: 'session-1', frame: 59, checksum: 'a'.repeat(64) });
    missing.lock.confirm(59, 'a'.repeat(64));
    missing.lock.receive(input(60));
    expect(missing.lock.next(() => 0)).toEqual({ p1: 0, p2: 0 });

    const conflict = make();
    const hash = { type: 'hash', sessionId: 'session-1', frame: 59, checksum: 'a'.repeat(64) };
    conflict.lock.receive(hash);
    conflict.lock.receive({ ...hash, checksum: 'b'.repeat(64) });
    expect(conflict.lock.status).toBe('halted');
    expect(conflict.lock.reason).toBe('conflicting checksum for frame');
  });

  it('halts on invalid local bits or send failure without advancing', () => {
    for (const bits of [1 << 18, Btn.Start, Btn.A | Btn.Start, 2 ** 32, 2 ** 32 + Btn.A]) {
      const invalid = make();
      expect(invalid.lock.next(() => bits)).toBeNull();
      expect(invalid.lock.status).toBe('halted');
      expect(invalid.lock.frame).toBe(0);
    }
    const failed = new InputLockstep({ sessionId: 'fail', localPlayer: 0, inputDelay: 4,
      send: () => { throw new Error('channel closed'); }, now: () => 0 });
    expect(failed.next(() => Btn.A)).toBeNull();
    expect(failed.status).toBe('halted');
    expect(failed.reason).toBe('send failed');
  });
});
