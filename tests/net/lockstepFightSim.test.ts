import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Btn, FightSim, SKILL_BUTTONS, type FighterDef } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import { InputLockstep, type LockstepPacket } from '../../src/net';

const roster: FighterDef[] = [luffyDef, akainuDef, labubuDef, twinkleDef];

function stateText(sim: FightSim): string {
  return JSON.stringify({ state: sim.state, rng: sim.rng.getState() },
    (key, value) => key === 'def' ? value.id : value);
}

function checksum(sim: FightSim): string {
  return createHash('sha256').update(stateText(sim)).digest('hex');
}

function sample(frame: number, player: 0 | 1): number {
  const phase = (frame + player * 17) % 53;
  if (phase === 0) return SKILL_BUTTONS[(frame / 53 | 0) % 9]!;
  if (phase === 9) return Btn.C | Btn.Right;
  if (phase === 16) return Btn.A;
  if (phase === 24) return Btn.Down | Btn.B;
  if (phase > 27 && phase < 32) return player === 0 ? Btn.Right : Btn.Left;
  return 0;
}

describe('real FightSim on two delayed lockstep peers', () => {
  for (const p1 of roster) for (const p2 of roster) {
    it(`${p1.id} vs ${p2.id}: reordering, latency and replays preserve each 60 Hz state`, () => {
      const target = 180;
      let tick = 0;
      type Pending = { at: number; dest: 0 | 1; packet: LockstepPacket };
      const wire: Pending[] = [];
      const hashes: [string[], string[]] = [[], []];
      const sims = [0, 1].map(() => new FightSim({ p1, p2, seed: 81,
        controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 }));
      const sampleCounts: [number, number] = [0, 0];
      const send = (from: 0 | 1) => (packet: LockstepPacket) => {
        const order = packet.type === 'input' ? packet.frame : packet.type === 'hash' ? packet.frame : 0;
        const delay = packet.type === 'hash' ? 1 + order % 3 : 1 + (order * 7 + from * 3) % 10;
        wire.push({ at: tick + delay, dest: from === 0 ? 1 : 0, packet });
        // Exactly identical network replay must not count as a second input.
        if (packet.type === 'input' && packet.frame % 11 === 0) {
          wire.push({ at: tick + delay + 7, dest: from === 0 ? 1 : 0, packet });
        }
      };
      const peers = [
        new InputLockstep({ sessionId: 'match-81', localPlayer: 0, inputDelay: 4, send: send(0), now: () => tick, timeoutMs: 1000 }),
        new InputLockstep({ sessionId: 'match-81', localPlayer: 1, inputDelay: 4, send: send(1), now: () => tick, timeoutMs: 1000 }),
      ] as const;
      let waited = 0;
      while (tick < 5000 && (peers[0].frame < target || peers[1].frame < target)) {
        const ready = wire.filter(item => item.at <= tick);
        for (let i = wire.length - 1; i >= 0; i--) if (wire[i]!.at <= tick) wire.splice(i, 1);
        ready.sort((a, b) => {
          const af = 'frame' in a.packet ? a.packet.frame : -1;
          const bf = 'frame' in b.packet ? b.packet.frame : -1;
          return bf - af;
        });
        for (const item of ready) peers[item.dest].receive(item.packet);
        for (const player of [0, 1] as const) {
          const peer = peers[player];
          if (peer.frame >= target) continue;
          const completed = peer.frame;
          const inputs = peer.next(() => {
            const future = sampleCounts[player] + 4;
            sampleCounts[player]++;
            return sample(future, player);
          });
          if (!inputs) { waited++; continue; }
          sims[player]!.step(inputs);
          if ((completed + 1) % 60 === 0) {
            const digest = checksum(sims[player]!);
            hashes[player].push(digest);
            peer.confirm(completed, digest);
          }
        }
        tick++;
      }
      expect(tick).toBeLessThan(5000);
      expect(waited).toBeGreaterThan(0);
      expect(peers.map(peer => peer.frame)).toEqual([target, target]);
      expect(peers.map(peer => peer.status)).toEqual(['ready', 'ready']);
      expect(sampleCounts).toEqual([target, target]);
      expect(hashes[0]).toHaveLength(3);
      expect(hashes[0]).toEqual(hashes[1]);
      expect(stateText(sims[0]!)).toBe(stateText(sims[1]!));
    });
  }
});
