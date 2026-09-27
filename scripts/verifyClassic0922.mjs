import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'vite';

const root = process.cwd().replaceAll('\\', '/');
const archived = '/.local-releases/操作演出-0922/baseline/source';
const output = path.join(root, '.local-releases/操作演出-0922/acceptance', `classic-replay-${new Date().toISOString().replaceAll(':', '-')}.json`);
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { '@core': `${root}${archived}/src/core`, '@characters': `${root}${archived}/src/characters`, '@render': `${root}${archived}/src/render` } } });
const snapshot = sim => JSON.stringify({ world: sim.state, hits: sim.hits, projectiles: sim.projectileEnds, rng: sim.rng.getState() }, (key, value) => key === 'def' ? value.id : value);
try {
  const { FightSim: Before } = await server.ssrLoadModule(`${archived}/src/core/FightSim.ts`);
  const { FightSim: After } = await server.ssrLoadModule('/src/core/FightSim.ts');
  const { characters, characterAi } = await server.ssrLoadModule(`${archived}/src/characters/index.ts`);
  const { Cpu } = await server.ssrLoadModule(`${archived}/src/ai/cpu.ts`);
  const results = [];
  for (const ids of [['luffy', 'akainu'], ['akainu', 'luffy']]) for (let seed = 1; seed <= 8; seed++) {
    const options = { p1: characters[ids[0]], p2: characters[ids[1]], seed, roundsToWin: 2, roundTime: 99 };
    const before = new Before(options), after = new After(options);
    const a = new Cpu(0, characterAi[ids[0]], 'normal', seed), b = new Cpu(1, characterAi[ids[1]], 'normal', seed + 101);
    const inputHash = crypto.createHash('sha256'), stateHash = crypto.createHash('sha256');
    while (before.state.phase !== 'match_end' && before.state.frame < 36000) {
      // Inputs are generated ONLY from the frozen baseline, then replayed unchanged.
      const input = { p1: a.input(before), p2: b.input(before) };
      inputHash.update(JSON.stringify(input));
      before.step(input); after.step(input);
      const expected = snapshot(before), actual = snapshot(after);
      if (actual !== expected) throw new Error(`Classic regression at ${ids.join('/')} seed ${seed} frame ${before.state.frame}`);
      stateHash.update(expected);
    }
    results.push({ ids, seed, frames: before.state.frame, completed: before.state.phase === 'match_end', wins: [...before.state.wins], inputSha256: inputHash.digest('hex'), stateSha256: stateHash.digest('hex'), identicalEveryFrame: true });
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ baseline: '7644138f36e4e87452329b565dba676f50d62fb5', mode: 'classic (omitted as for old replays)', results }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, matches: results.length, frames: results.reduce((n, r) => n + r.frames, 0), identicalEveryFrame: true }));
} finally { await server.close(); }
