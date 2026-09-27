import { PeerRoom } from './PeerRoom';
import { InputLockstep, LOCKSTEP_CHECK_INTERVAL } from '../net';
import { Btn, FightSim, SKILL_BUTTONS, SUBPIXEL } from '../core';
import { labubuDef, twinkleDef } from '../characters';
import { FixedStep } from '../render/FixedStep';
import { sha256Hex } from './sha256';

const node = (id: string) => document.getElementById(id)!;
const room = new PeerRoom();
let lock: InputLockstep | null = null;
let sim: FightSim | null = null;
let running = false, frame = 0, last = performance.now(), step = new FixedStep();
let localHash = '', remoteHash = '', started = 0, checkpoints = 0;
const pings = new Map<string, number>();
const result: Record<string, unknown> = { environment: 'same-computer browser contexts', realPhones: false };
const show = () => { node('result').textContent = JSON.stringify(result, null, 2); };
room.onState(state => {
  node('status').textContent = `${state.status} · ${state.message}`; node('code').textContent = state.code || '尚无房间';
  if (state.status === 'failed' && running) {
    lock?.close('data channel disconnected'); running = false;
    Object.assign(result, { status: 'halted', completed: false, reason: state.message, frame }); show();
  }
});

function begin(sessionId: string): void {
  const localPlayer = room.state.role === 'host' ? 0 : 1;
  sim = new FightSim({ p1: labubuDef, p2: twinkleDef, seed: 92817, controlModes: ['simple', 'simple'] });
  lock = new InputLockstep({ sessionId, localPlayer, inputDelay: 4, send: packet => room.send(packet), now: () => performance.now() });
  running = true; frame = 0; localHash = ''; remoteHash = ''; checkpoints = 0; started = last = performance.now(); step = new FixedStep();
  Object.assign(result, { sessionId, role: room.state.role, status: 'running', frame: 0, completed: false,
    elapsedMs: 0, localHash: '', remoteHash: '', wins: null, reason: null, error: null }); show();
}
function done(): void {
  if (localHash && remoteHash) {
    running = false;
    const verified = localHash === remoteHash && lock?.status !== 'halted' && lock?.status !== 'timed_out';
    Object.assign(result, { completed: verified, status: verified ? 'verified' : 'mismatch',
      frame, checkpoints, elapsedMs: performance.now() - started, localHash, remoteHash,
      characters: sim?.state.fighters.map(f => f.def.id), wins: sim?.state.wins }); show();
  }
}
room.onPacket(packet => {
  if (!packet || typeof packet !== 'object') return;
  const p = packet as Record<string, unknown>;
  if (p.type === 'probe-ping' && typeof p.id === 'string' && p.id.length < 50) room.send({ type: 'probe-ack', id: p.id });
  else if (p.type === 'probe-ack' && typeof p.id === 'string' && pings.has(p.id)) {
    result.roundTripMs = performance.now() - pings.get(p.id)!; pings.delete(p.id);
    void room.stats().then(stats => { result.transport = stats; show(); });
  } else if (p.type === 'probe-start' && room.state.role === 'guest' && typeof p.sessionId === 'string' && /^[a-z0-9-]{1,64}$/.test(p.sessionId)) begin(p.sessionId);
  else if (lock && p.sessionId === lock.sessionId) {
    lock.receive(packet);
    if (p.type === 'hash' && p.frame === 1199 && typeof p.checksum === 'string') { remoteHash = p.checksum; done(); }
  }
});
node('create').onclick = () => room.host();
node('join').onclick = () => { try { room.join((node('join-code') as HTMLInputElement).value); } catch (e) { node('status').textContent = String(e); } };
node('close').onclick = () => {
  if (running) { Object.assign(result, { status: 'aborted', completed: false, frame }); show(); }
  running = false; lock?.close('probe closed'); room.close();
};
window.addEventListener('pagehide', () => { running = false; room.close(); });
node('ping').onclick = () => {
  try { const id = String(performance.now()); pings.set(id, performance.now()); room.send({ type: 'probe-ping', id }); }
  catch (e) { node('status').textContent = String(e); }
};
node('run').onclick = () => {
  if (room.state.status !== 'connected' || room.state.role !== 'host') { node('status').textContent = '由已连接的主机开始回放'; return; }
  const id = `probe-${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')}`;
  room.send({ type: 'probe-start', sessionId: id }); begin(id);
};
function loop(time: number): void {
  const ticks = step.advance(time - last); last = time;
  if (running && lock && sim) {
    for (let tick = 0; tick < ticks && frame < 1200; tick++) {
      const currentLock = lock, currentSim = sim;
      const input = currentLock.next(() => {
        const me = currentSim.state.fighters[currentLock.localPlayer], other = currentSim.state.fighters[currentLock.localPlayer === 0 ? 1 : 0];
        if (currentLock.frame % 75 === 0) return SKILL_BUTTONS[Math.floor(currentLock.frame / 75) % 9]!;
        if (Math.abs(me.x - other.x) > 42 * SUBPIXEL) return me.facing === 1 ? Btn.Right : Btn.Left;
        return currentLock.frame % 12 === 0 ? Btn.A : 0;
      });
      if (!input) break;
      currentSim.step(input); frame = currentLock.frame;
      if (frame % LOCKSTEP_CHECK_INTERVAL === 0) {
        const completedFrame = frame - 1;
        const serialized = JSON.stringify({ world: currentSim.state, rng: currentSim.rng.getState() });
        void sha256Hex(serialized).then(hash => {
          if (lock !== currentLock) return;
          currentLock.confirm(completedFrame, hash); checkpoints++;
          if (completedFrame === 1199) { localHash = hash; done(); }
        }).catch(error => { currentLock.close('hash failure'); result.error = String(error); show(); });
      }
    }
    if (lock.status === 'halted' || lock.status === 'timed_out') { running = false; Object.assign(result, { status: lock.status, reason: lock.reason, frame }); show(); }
    else if (frame % 30 === 0 && frame < 1200) { Object.assign(result, { frame, status: lock.status, checkpoints }); show(); }
    if (performance.now() - started > 45000 && !result.completed) { running = false; Object.assign(result, { status: 'probe-timeout', frame }); show(); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
