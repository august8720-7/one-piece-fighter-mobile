import { describe, expect, it } from 'vitest';
import { FightSim } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import { NetworkRound, type NetworkRoundPacket } from '../../src/mobile/NetworkRound';
import { MOBILE_PROTOCOL, RULESET_ID, type NetworkResult, type NetworkSetup } from '../../src/mobile/matchProtocol';

const setup: NetworkSetup = { type: 'setup', protocol: MOBILE_PROTOCOL, ruleset: RULESET_ID,
  sessionId: 'a'.repeat(32), seed: 48, p1: 'luffy', p2: 'akainu' };

function pair() {
  let clock = 0;
  const wire: { to: 0 | 1; packet: NetworkRoundPacket }[] = [];
  const results: [NetworkResult[], NetworkResult[]] = [[], []];
  const rounds = [
    new NetworkRound({ setup, localPlayer: 0, send: packet => wire.push({ to: 1, packet }),
      now: () => clock, onResult: result => results[0].push(result) }),
    new NetworkRound({ setup, localPlayer: 1, send: packet => wire.push({ to: 0, packet }),
      now: () => clock, onResult: result => results[1].push(result) }),
  ] as const;
  function deliver(filter: (item: { to: 0 | 1; packet: NetworkRoundPacket }) => boolean = () => true) {
    const ready = wire.filter(filter);
    for (const item of ready) wire.splice(wire.indexOf(item), 1);
    for (const item of ready) rounds[item.to].receive(item.packet);
  }
  function loaded() {
    rounds[0].markLoaded();
    rounds[1].markLoaded();
    deliver(); // both loaded; host sends go
    deliver(); // guest accepts go
  }
  return { rounds, wire, results, deliver, loaded, advance: (ms: number) => { clock += ms; } };
}

describe('NetworkRound browser bridge', () => {
  it('opens only after both actual loaded notices and a host go', () => {
    const { rounds, wire, deliver } = pair();
    let reads = 0;
    expect(rounds[0].next(() => { reads++; return 0; })).toBeNull();
    expect(rounds[1].next(() => { reads++; return 0; })).toBeNull();
    rounds[0].markLoaded();
    expect(wire[0]?.packet.type).toBe('loaded');
    expect(rounds[0].status).toBe('loading');
    deliver();
    rounds[1].markLoaded();
    expect(rounds[1].status).toBe('ready');
    deliver();
    expect(rounds[0].status).toBe('playing');
    expect(wire[0]?.packet.type).toBe('go');
    expect(rounds[1].status).toBe('ready');
    deliver();
    expect(rounds[1].status).toBe('playing');
    expect(reads).toBe(0);
    expect(rounds[0].next(() => { reads++; return 0; })).toEqual({ p1: 0, p2: 0 });
    expect(reads).toBe(1);
  });

  it('rejects premature guest go and a forged host-side go', () => {
    const guest = pair();
    guest.rounds[1].receive({ type: 'go', sessionId: setup.sessionId });
    expect(guest.rounds[1].status).toBe('halted');
    expect(guest.rounds[1].reason).toBe('illegal go');
    const host = pair();
    host.loaded();
    host.rounds[0].receive({ type: 'go', sessionId: setup.sessionId });
    expect(host.rounds[0].status).toBe('halted');
  });

  it('times out a guest when both sides loaded but the host go never arrives', () => {
    const { rounds, deliver, advance } = pair();
    rounds[0].markLoaded();
    rounds[1].markLoaded();
    deliver(); // host emits go, intentionally retain it in the wire
    expect(rounds[1].status).toBe('ready');
    advance(10_001);
    expect(rounds[1].status).toBe('halted');
    expect(rounds[1].reason).toBe('go timeout');
  });

  it('freezes both players on either pause and excludes a long pause from input timeout', () => {
    const { rounds, wire, deliver, loaded, advance } = pair();
    loaded();
    for (let f = 0; f < 4; f++) {
      rounds[0].next(() => 0);
      rounds[1].next(() => 0);
    }
    // Retain both frame-4 packets in the wire so each peer starts waiting.
    expect(rounds[0].next(() => 0)).toBeNull();
    expect(rounds[1].next(() => 0)).toBeNull();
    rounds[0].setPaused(true);
    deliver(item => item.packet.type === 'pause');
    expect(rounds.map(round => round.status)).toEqual(['paused', 'paused']);
    const frame = rounds[0].diagnostics.frame;
    advance(15_500);
    expect(rounds[0].next(() => 0)).toBeNull();
    expect(rounds[1].next(() => 0)).toBeNull();
    expect(rounds[0].diagnostics.frame).toBe(frame);
    expect(rounds[0].diagnostics.waitingMs).toBe(0);
    rounds[1].setPaused(true);
    deliver(item => item.packet.type === 'pause');
    rounds[0].setPaused(false);
    deliver(item => item.packet.type === 'pause');
    expect(rounds.map(round => round.status)).toEqual(['paused', 'paused']);
    rounds[1].setPaused(false);
    deliver(item => item.packet.type === 'pause');
    expect(rounds.map(round => round.status)).toEqual(['waiting', 'waiting']);
    expect(wire.some(item => item.packet.type === 'input')).toBe(true);
    deliver();
    expect(rounds[0].next(() => 0)).toEqual({ p1: 0, p2: 0 });
    expect(rounds[1].next(() => 0)).toEqual({ p1: 0, p2: 0 });
    expect(rounds.map(round => round.status)).toEqual(['playing', 'playing']);
  });

  it('rejects malformed controls while ignoring obsolete session traffic', () => {
    const { rounds } = pair();
    rounds[0].receive({ type: 'loaded', sessionId: 'b'.repeat(32), extra: 'old data' });
    expect(rounds[0].status).toBe('loading');
    rounds[0].receive({ type: 'loaded', sessionId: setup.sessionId, extra: true });
    expect(rounds[0].status).toBe('halted');
    expect(rounds[0].reason).toBe('invalid control packet');
    const oversized = pair();
    oversized.rounds[1].receive({ type: 'loaded', sessionId: setup.sessionId, padding: 'x'.repeat(2000) });
    expect(oversized.rounds[1].reason).toBe('packet too large');
  });

  it('halts when a transport send throws', () => {
    const round = new NetworkRound({ setup, localPlayer: 0, now: () => 0,
      send: () => { throw new Error('closed'); }, onResult: () => { throw new Error('unexpected'); } });
    round.markLoaded();
    expect(round.status).toBe('halted');
    expect(round.reason).toBe('send failed');
    expect(round.next(() => 0)).toBeNull();
  });

  it('waits for async SHA-256 and confirms a real FightSim winner before reporting completion', async () => {
    const { rounds, wire, results, deliver, loaded } = pair();
    loaded();
    const sims = [0, 1].map(() => new FightSim({ p1: luffyDef, p2: akainuDef,
      seed: setup.seed, introFrames: 0, roundTime: 1, roundsToWin: 1 }));
    for (const sim of sims) sim.state.fighters[1].hp = 500;
    let checkpointWaits = 0;
    let ticks = 0;
    for (let tick = 0; tick < 1200 && results[0].length === 0; tick++) {
      ticks++;
      deliver();
      for (const player of [0, 1] as const) {
        const inputs = rounds[player].next(() => 0);
        if (!inputs) {
          if (rounds[player].diagnostics.waitingFor === 'checksum') checkpointWaits++;
          continue;
        }
        sims[player]!.step(inputs);
        rounds[player].afterStep(sims[player]!);
        if (rounds[player].diagnostics.frame === 60) {
          // The digest promise has not settled yet; the next frame must wait.
          expect(rounds[player].next(() => 0)).toBeNull();
          if (rounds[player].diagnostics.waitingFor === 'checksum') checkpointWaits++;
        }
      }
      if (rounds.some(round => round.status === 'halted')) break;
      // The browser hash API resolves asynchronously; do not fake a digest.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    deliver();
    expect(ticks).toBeLessThan(500);
    expect(checkpointWaits).toBeGreaterThan(0);
    expect(sims[0]!.state.phase).toBe('match_end');
    expect(sims[1]!.state.phase).toBe('match_end');
    expect(rounds.map(round => round.status)).toEqual(['complete', 'complete']);
    expect(results[0]).toHaveLength(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[0][0]!.winner).toBe(0);
    expect(results[0][0]!.wins).toEqual([1, 0]);
    expect(results[0][0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(rounds[0].next(() => 0)).toBeNull();
    rounds[0].receive({ type: 'result', sessionId: setup.sessionId, ...results[0][0]! });
    expect(results[0]).toHaveLength(1);
    const packetCount = wire.length;
    rounds[0].dispose();
    rounds[1].dispose();
    expect(wire).toHaveLength(packetCount);
  });

  it('keeps playing after an early claimed result, then rejects its forged winner', async () => {
    const { rounds, results, deliver, loaded } = pair();
    loaded();
    rounds[0].receive({ type: 'result', sessionId: setup.sessionId,
      frame: 1, winner: 1, wins: [0, 1], checksum: 'a'.repeat(64) });
    // The remote claim cannot freeze our local simulation or determine the winner.
    expect(rounds[0].status).toBe('playing');
    const sims = [0, 1].map(() => new FightSim({ p1: labubuDef, p2: twinkleDef,
      seed: setup.seed, introFrames: 0, roundTime: 1, roundsToWin: 1 }));
    for (const sim of sims) sim.state.fighters[1].hp = 500;
    for (let tick = 0; tick < 1200 && rounds[0].status !== 'halted'; tick++) {
      deliver();
      for (const player of [0, 1] as const) {
        const inputs = rounds[player].next(() => 0);
        if (!inputs) continue;
        sims[player]!.step(inputs);
        rounds[player].afterStep(sims[player]!);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(sims[0]!.state.phase).toBe('match_end');
    expect(rounds[0].status).toBe('halted');
    expect(rounds[0].reason).toBe('final result mismatch');
    expect(results[0]).toHaveLength(0);
  });

  it('stops a finished match if the peer never confirms the final result', async () => {
    const { rounds, results, wire, deliver, loaded, advance } = pair();
    loaded();
    const sims = [0, 1].map(() => new FightSim({ p1: luffyDef, p2: akainuDef,
      seed: setup.seed, introFrames: 0, roundTime: 1, roundsToWin: 1 }));
    for (const sim of sims) sim.state.fighters[1].hp = 500;
    for (let tick = 0; tick < 1200 && !rounds[0].diagnostics.resultSent; tick++) {
      deliver(item => item.packet.type !== 'result');
      for (const player of [0, 1] as const) {
        const inputs = rounds[player].next(() => 0);
        if (!inputs) continue;
        sims[player]!.step(inputs);
        rounds[player].afterStep(sims[player]!);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(rounds[0].diagnostics.resultSent).toBe(true);
    expect(wire.some(item => item.packet.type === 'result')).toBe(true);
    expect(rounds[0].status).toBe('finalizing');
    advance(10_001);
    expect(rounds[0].status).toBe('halted');
    expect(rounds[0].reason).toBe('result timeout');
    expect(results[0]).toHaveLength(0);
  });

  it('lets a lagging peer pause across the other peer finalizing, then finishes without a false timeout', async () => {
    const { rounds, results, deliver, loaded, advance } = pair();
    loaded();
    const sims = [0, 1].map(() => new FightSim({ p1: luffyDef, p2: akainuDef,
      seed: setup.seed, introFrames: 0, roundTime: 1, roundsToWin: 1 }));
    for (const sim of sims) sim.state.fighters[1].hp = 500;
    for (let tick = 0; tick < 1200 && rounds.some(round => round.diagnostics.frame < 206); tick++) {
      deliver();
      for (const player of [0, 1] as const) {
        if (rounds[player].diagnostics.frame >= 206) continue;
        const inputs = rounds[player].next(() => 0);
        if (!inputs) continue;
        sims[player]!.step(inputs);
        rounds[player].afterStep(sims[player]!);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(rounds.map(round => round.diagnostics.frame)).toEqual([206, 206]);
    for (let tick = 0; tick < 6 && rounds[0].status !== 'finalizing'; tick++) {
      deliver();
      const input = rounds[0].next(() => 0);
      if (!input) continue;
      sims[0]!.step(input);
      rounds[0].afterStep(sims[0]!);
    }
    expect(sims[0]!.state.phase).toBe('match_end');
    expect(rounds[0].status).toBe('finalizing');
    expect(rounds[1].diagnostics.frame).toBe(206);

    rounds[1].setPaused(true);
    deliver(item => item.packet.type === 'pause');
    expect(rounds.map(round => round.status)).toEqual(['paused', 'paused']);
    // A local pause added during finalizing must remain clearable later.
    rounds[0].setPaused(true);
    deliver(item => item.packet.type === 'pause');
    await new Promise(resolve => setTimeout(resolve, 0));
    deliver(); // host final result may arrive before guest has finished its last frame
    advance(15_500);
    expect(rounds[0].status).toBe('paused');
    expect(rounds[0].reason).toBeNull();
    expect(rounds[1].next(() => 0)).toBeNull();
    rounds[1].setPaused(false);
    deliver(item => item.packet.type === 'pause');
    expect(rounds.map(round => round.status)).toEqual(['paused', 'paused']);
    rounds[0].setPaused(false);
    deliver(item => item.packet.type === 'pause');
    expect(rounds[0].status).toBe('finalizing');
    expect(rounds[1].status).toBe('playing');
    deliver();
    for (let tick = 0; tick < 6 && sims[1]!.state.phase !== 'match_end'; tick++) {
      deliver();
      const input = rounds[1].next(() => 0);
      if (!input) continue;
      sims[1]!.step(input);
      rounds[1].afterStep(sims[1]!);
    }
    expect(sims[1]!.state.phase).toBe('match_end');
    for (let tick = 0; tick < 30 && results[0].length === 0; tick++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      deliver();
    }
    expect(rounds.map(round => round.status)).toEqual(['complete', 'complete']);
    expect(results[0]).toHaveLength(1);
    expect(results[1]).toEqual(results[0]);
  });
});
