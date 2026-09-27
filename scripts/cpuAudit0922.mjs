import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer, transformWithEsbuild } from 'vite';

const root = process.cwd().replaceAll('\\', '/');
const out = path.join(root, '.local-releases/操作演出-0922/acceptance/cpu', new Date().toISOString().replaceAll(':', '-'));
const source = fs.readFileSync(path.join(root, 'src/ai/cpu.ts'), 'utf8');
const needle = '    if (this.hold) {\n';
const insertion = `    // Rejected candidate only: release guard when the observed attack is no longer a melee threat.
    if (this.hold?.block && opp.state === 'attack' && !this.isThreat(sim, opp)
      && this.frame - this.observedAttackAt >= this.params.reaction) this.hold = null;

`;
const normalized = source.replaceAll('\r\n', '\n');
if (!normalized.includes(needle)) throw new Error('Candidate insertion anchor missing');
const candidate = normalized.replace(needle, insertion + needle);
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const dependencyHashes = [];
for (const folder of ['src/ai', 'src/core', 'src/characters']) {
  for (const name of fs.readdirSync(path.join(root, folder), { recursive: true })) {
    const relative = `${folder}/${name}`.replaceAll('\\', '/');
    if (relative.endsWith('.ts')) dependencyHashes.push({ path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))) });
  }
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'source-manifest.json'), JSON.stringify({ source: 'src/ai/cpu.ts', sha256: hash(source), candidateSha256: hash(candidate), candidate: 'release held guard while opponent attack has no melee threat; no fast move preference', dependencyHashes }, null, 2));
fs.writeFileSync(path.join(out, 'before.ts'), source);
fs.writeFileSync(path.join(out, 'candidate.ts'), candidate);
if (hash(fs.readFileSync(path.join(out, 'before.ts'))) !== hash(source)) throw new Error('Snapshot mismatch');
const modules = new Map();
for (const [label, code] of [['before', source], ['candidate', candidate]]) {
  const rewritten = code.replace("from './types'", "from '/src/ai/types.ts'").replace("from './attackRange'", "from '/src/ai/attackRange.ts'");
  modules.set(`virtual:cpu-${label}`, (await transformWithEsbuild(rewritten, `${label}.ts`, { loader: 'ts' })).code);
}
const server = await createServer({ root, configFile: false, plugins: [{ name: 'cpu-audit', resolveId(id) { return modules.has(id) ? '\0' + id : undefined; }, load(id) { return modules.get(id.slice(1)); } }], server: { middlewareMode: true, watch: null }, resolve: { alias: { '@core': `${root}/src/core`, '@characters': `${root}/src/characters`, '@render': `${root}/src/render` } }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { FightSim, Btn, SUBPIXEL } = await server.ssrLoadModule('/src/core/index.ts');
  const { characters, characterAi } = await server.ssrLoadModule('/src/characters/index.ts');
  const classes = {};
  for (const label of ['before', 'candidate']) classes[label] = (await server.ssrLoadModule(`virtual:cpu-${label}`)).Cpu;
  const snap = f => ({ state: f.state, stateFrame: f.stateFrame, move: f.moveId, instance: f.moveInstance, x: f.x / SUBPIXEL, hp: f.hp, hitstop: f.hitstop, stun: f.stun });
  const playerInput = (sim, player, policy, normal) => {
    const w = sim.state, me = w.fighters[player], opp = w.fighters[1 - player];
    if (w.phase !== 'fight') return 0;
    const distance = Math.abs(me.x - opp.x) / SUBPIXEL, forward = me.x < opp.x ? Btn.Right : Btn.Left, back = me.x < opp.x ? Btn.Left : Btn.Right;
    if (policy === 'normal') return normal.input(sim);
    if (policy === 'defend') return w.frame % 180 < 140 ? back | Btn.Down : distance > 90 ? forward : w.frame % 12 === 0 ? Btn.C : 0;
    if (policy === 'jump') return me.airborne ? w.frame % 10 === 0 ? Btn.C : 0 : distance > 180 ? forward : w.frame % 45 === 0 ? forward | Btn.Up : 0;
    return distance > 140 ? forward : w.frame % 10 === 0 ? Btn.C : 0;
  };
  const pairs = [], policies = process.argv.includes('--heavy-only') ? ['heavy'] : ['heavy', 'normal', 'defend', 'jump'];
  const seeds = Number(process.env.CPU_AUDIT_SEEDS ?? 30);
  for (const policy of policies) for (const char of ['luffy', 'akainu']) for (const player of [0, 1]) for (let seed = 1; seed <= seeds; seed++) {
    const cp = 1 - player, enemy = char === 'luffy' ? 'akainu' : 'luffy';
    const row = { policy, char, player, seed, runs: {}, firstDifference: null }, traces = [];
    for (const label of ['before', 'candidate']) {
      const defs = player === 0 ? [characters[char], characters[enemy]] : [characters[enemy], characters[char]];
      const sim = new FightSim({ p1: defs[0], p2: defs[1], seed, roundTime: 99, roundsToWin: 2 });
      const cpu = new classes[label](cp, characterAi[enemy], 'normal', seed), normal = new classes.before(player, characterAi[char], 'normal', seed + 1000);
      const trace = [], counts = { cpuDamage: 0, playerDamage: 0, cpuBlocks: 0, playerBlocks: 0, guardFramesWithoutMeleeThreat: 0 };
      let firstPlayerHit = null;
      while (sim.state.phase !== 'match_end' && sim.state.frame < 36000) {
        const bits = playerInput(sim, player, policy, normal), me = sim.state.fighters[cp], opp = sim.state.fighters[player];
        const oldHold = cpu.hold ? { ...cpu.hold } : null;
        const stale = Boolean(oldHold?.block && opp.state === 'attack' && !cpu.isThreat(sim, opp) && cpu.actionable(me));
        if (stale) counts.guardFramesWithoutMeleeThreat++;
        const myBits = cpu.input(sim);
        const frameTrace = { frame: sim.state.frame, bits, myBits, me: snap(me), opp: snap(opp), hold: oldHold, pending: [...cpu.pending], pendingBlock: cpu.pendingBlock ? { ...cpu.pendingBlock } : null, observedAttackAt: cpu.observedAttackAt, rng: cpu.rng.getState(), stale, hits: [] };
        trace.push(frameTrace);
        sim.step(player === 0 ? { p1: bits, p2: myBits } : { p1: myBits, p2: bits });
        for (const hit of sim.hits) {
          frameTrace.hits.push({ ...hit });
          if (firstPlayerHit === null && hit.attacker === player && hit.damage > 0 && hit.kind !== 'block') firstPlayerHit = frameTrace.frame;
          if (hit.kind === 'block') counts[hit.attacker === cp ? 'playerBlocks' : 'cpuBlocks']++;
          counts[hit.attacker === cp ? 'cpuDamage' : 'playerDamage'] += hit.damage;
        }
      }
      row.runs[label] = { result: sim.state.wins[player] > sim.state.wins[cp] ? 'player' : sim.state.wins[player] < sim.state.wins[cp] ? 'cpu' : 'draw', frames: sim.state.frame, ...counts };
      if (seed === 1 && policy === 'heavy') row.runs[label].firstPlayerHit = { frame: firstPlayerHit, trace: firstPlayerHit === null ? [] : trace.slice(Math.max(0, firstPlayerHit - 20), firstPlayerHit + 21) };
      traces.push(trace);
    }
    const [b, a] = traces, difference = b.findIndex((v, i) => !a[i] || v.myBits !== a[i].myBits);
    if (difference >= 0) row.firstDifference = { frame: difference, before: b.slice(Math.max(0, difference - 4), difference + 45), candidate: a.slice(Math.max(0, difference - 4), difference + 45) };
    pairs.push(row);
  }
  const summary = policies.map(policy => ({ policy, groups: ['luffy', 'akainu'].map(char => ({ char, ...Object.fromEntries(['before', 'candidate'].map(label => { const rows = pairs.filter(p => p.policy === policy && p.char === char).map(p => p.runs[label]); return [label, { matches: rows.length, playerWins: rows.filter(r => r.result === 'player').length, cpuWins: rows.filter(r => r.result === 'cpu').length, cpuDamage: rows.reduce((n, r) => n + r.cpuDamage, 0), playerDamage: rows.reduce((n, r) => n + r.playerDamage, 0), guardFramesWithoutMeleeThreat: rows.reduce((n, r) => n + r.guardFramesWithoutMeleeThreat, 0) }]; })) })) }));
  const prior = JSON.parse(fs.readFileSync(path.join(root, '.local-releases/改造验收-0913/cpu-heavy-timing-before0913.json'), 'utf8')).matches;
  const archiveChecks = pairs.filter(p => p.policy === 'heavy').map(p => { const old = prior.find(r => r.char === p.char && r.player === p.player && r.seed === p.seed); return { char: p.char, player: p.player, seed: p.seed, matchesPrior: Boolean(old && old.frames === p.runs.before.frames && (old.result === 'human' ? 'player' : old.result) === p.runs.before.result) }; });
  fs.writeFileSync(path.join(out, 'paired.json'), JSON.stringify({ settings: { seeds, policies, roundsToWin: 2, roundTime: 99, difficulty: 'normal', maxFrames: 36000 }, archiveChecks, summary, pairs }, null, 2));
  console.log(JSON.stringify({ out, summary }, null, 2));
} finally { await server.close(); }
