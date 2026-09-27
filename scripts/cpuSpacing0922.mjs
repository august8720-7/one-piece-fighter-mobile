import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'vite';

const root = process.cwd().replaceAll('\\', '/');
const out = path.join(root, '.local-releases/操作演出-0922/acceptance/cpu', new Date().toISOString().replaceAll(':', '-') + '-spacing');
fs.mkdirSync(out, { recursive: true });
const sourceHashes = [];
for (const folder of ['src/ai', 'src/core', 'src/characters']) for (const name of fs.readdirSync(path.join(root, folder), { recursive: true })) {
  const relative = `${folder}/${name}`.replaceAll('\\', '/');
  if (relative.endsWith('.ts')) sourceHashes.push({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex') });
}
fs.writeFileSync(path.join(out, 'source-manifest.json'), JSON.stringify(sourceHashes, null, 2));
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null }, resolve: { alias: { '@core': `${root}/src/core`, '@characters': `${root}/src/characters`, '@render': `${root}/src/render` } }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { FightSim, Btn, SUBPIXEL, inStartupOrActive } = await server.ssrLoadModule('/src/core/index.ts');
  const { characters, characterAi } = await server.ssrLoadModule('/src/characters/index.ts');
  const { Cpu } = await server.ssrLoadModule('/src/ai/cpu.ts');
  const rows = [];
  for (const char of ['luffy', 'akainu']) for (const player of [0, 1]) for (let seed = 1; seed <= 30; seed++) {
    const enemy = char === 'luffy' ? 'akainu' : 'luffy', cp = 1 - player;
    const defs = player === 0 ? [characters[char], characters[enemy]] : [characters[enemy], characters[char]];
    const sim = new FightSim({ p1: defs[0], p2: defs[1], seed, roundTime: 99, roundsToWin: 2 });
    const cpu = new Cpu(cp, characterAi[enemy], 'normal', seed), decisions = [], dangerWalks = [], recoveries = [], hits = [];
    const decide = cpu.decide.bind(cpu);
    cpu.decide = (s, me, opp) => {
      const action = decide(s, me, opp);
      decisions.push({ frame: s.state.frame, action, distance: Math.abs(me.x - opp.x) / SUBPIXEL, me: me.state, opp: opp.state, oppFrame: opp.stateFrame, oppMove: opp.moveId, observedFrames: s.state.frame - cpu.observedAttackAt, threat: cpu.isThreat(s, opp), recovery: opp.state === 'attack' && !inStartupOrActive(s.move(opp), opp.stateFrame) });
      return action;
    };
    let previous = null;
    while (sim.state.phase !== 'match_end' && sim.state.frame < 36000) {
      const me = sim.state.fighters[cp], opp = sim.state.fighters[player], frame = sim.state.frame;
      const distance = Math.abs(me.x - opp.x) / SUBPIXEL;
      const playerBits = sim.state.phase !== 'fight' ? 0 : distance > 140 ? (opp.x < me.x ? Btn.Right : Btn.Left) : frame % 10 === 0 ? Btn.C : 0;
      const holdBefore = cpu.hold ? { ...cpu.hold } : null;
      const decisionCount = decisions.length;
      const bits = cpu.input(sim);
      if (cpu.actionable(me) && previous && !['idle', 'crouch', 'walk_fwd', 'walk_back', 'dash'].includes(previous) && sim.state.phase === 'fight') {
        recoveries.push({ frame, from: previous, distance, bits, holdBefore, pending: [...cpu.pending], decided: decisions.length > decisionCount, nextDecisionAt: cpu.nextDecisionAt, latestDecision: decisions.at(-1) });
      }
      if (cpu.actionable(me) && bits === (me.x < opp.x ? Btn.Right : Btn.Left) && cpu.isThreat(sim, opp) && frame - cpu.observedAttackAt >= 12) {
        dangerWalks.push({ frame, distance, oppFrame: opp.stateFrame, oppMove: opp.moveId, observedFrames: frame - cpu.observedAttackAt, holdBefore, latestDecision: decisions.at(-1) });
      }
      previous = me.state;
      sim.step(player === 0 ? { p1: playerBits, p2: bits } : { p1: bits, p2: playerBits });
      for (const h of sim.hits) if (h.attacker === player && h.damage > 0 && h.kind !== 'block') hits.push({ frame, damage: h.damage, latestDecision: decisions.at(-1) });
    }
    rows.push({ char, player, seed, dangerWalks, recoveries, hits, decisions });
  }
  const summary = ['luffy', 'akainu'].map(char => {
    const r = rows.filter(x => x.char === char), recoveries = r.flatMap(x => x.recoveries), decisions = r.flatMap(x => x.decisions), walks = r.flatMap(x => x.dangerWalks);
    return { char, matches: r.length, dangerWalkFrames: walks.length, dangerWalkInitiations: walks.filter(w => w.latestDecision?.frame === w.frame).length, recoveryFrames: recoveries.length, immediateDecisions: recoveries.filter(x => x.decided).length, noInputRecovery: recoveries.filter(x => x.bits === 0 && !x.decided).length, delayedNoHoldRecovery: recoveries.filter(x => !x.decided && x.bits === 0 && !x.holdBefore && !x.pending.length).length, decisions: decisions.length, recoveryActions: Object.fromEntries(['normal', 'special', 'walk', 'wait', 'block', 'throw', 'jump', 'run', 'roll', 'backdash'].map(kind => [kind, decisions.filter(x => x.recovery && x.action?.kind === kind).length])) };
  });
  fs.writeFileSync(path.join(out, 'spacing.json'), JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify({ out, summary }, null, 2));
} finally { await server.close(); }
