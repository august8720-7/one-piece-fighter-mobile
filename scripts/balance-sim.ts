/**
 * 平衡自动对局：AI vs AI 跑 N 场，统计胜率、回合时长、伤害来源。
 * 运行：npx vite-node scripts/balance-sim.ts [matches=40] [difficulty=normal]
 * 判断标准：完成比赛的胜率超出 35%～65% 视为自动对局报警（不是真人平衡合格证）。
 */
import { FightSim, LOGIC_FPS } from '@core/index';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { characterAi, characters } from '@characters/index';
import { BALANCE_PARAM_VERSION, balanceOptions, classifyMatch, RoundClock } from '../src/ai/balanceStats';
import { Cpu } from '../src/ai/cpu';
const { matches, difficulty } = balanceOptions(process.argv[2], process.argv[3]);
const ids = Object.keys(characters);
const sourceHash = createHash('sha256');
for (const dir of ['src/core', 'src/ai', 'src/characters']) {
  for (const file of readdirSync(dir, { recursive: true }).map(String).filter((file) => file.endsWith('.ts')).sort()) {
    sourceHash.update(file).update(readFileSync(join(dir, file)));
  }
}
const fingerprint = sourceHash.digest('hex');
const runs: { pair: number; p1: string; p2: string; seed: number; cpuSeeds: [number, number]; outcome: string; roundFrames: number[] }[] = [];

interface Stat {
  wins: number;
  rounds: number;
  hpLeftSum: number;
  roundFrames: number;
}

const stats: Record<string, Stat> = {};
for (const id of ids) stats[id] = { wins: 0, rounds: 0, hpLeftSum: 0, roundFrames: 0 };
let drawRounds = 0;
let drawMatches = 0;
let timeouts = 0;
const sides = { p1First: 0, p2First: 0 };
const damageBy: Record<string, Record<string, number>> = {};
const kinds: Record<string, Record<string, number>> = {};
const WATCH = new Set(['sp_daifunka', 'sp_inugami', 'st_c']);
const hitStates: Record<string, Record<string, number>> = {};
const seeds: number[] = [];

for (let m = 0; m < matches; m++) {
  const swapped = m % 2 === 1;
  const [a, b] = swapped ? [ids[1]!, ids[0]!] : [ids[0]!, ids[1]!];
  if (swapped) sides.p2First++;
  else sides.p1First++;
  const pair = Math.floor(m / 2);
  const seed = 100 + pair;
  seeds.push(seed);
  const sim = new FightSim({ p1: characters[a]!, p2: characters[b]!, seed, introFrames: 0, roundTime: 99 });
  const cpuSeeds: [number, number] = swapped ? [2000 + pair, 1000 + pair] : [1000 + pair, 2000 + pair];
  const cpuA = new Cpu(0, characterAi[a]!, difficulty, cpuSeeds[0]);
  const cpuB = new Cpu(1, characterAi[b]!, difficulty, cpuSeeds[1]);
  let frames = 0;
  const clock = new RoundClock();
  clock.observe(sim.state.phase, sim.state.frame);
  const roundFrames: number[] = [];
  let prevStates: [string, string] = ['idle', 'idle'];
  const limit = 5 * 99 * LOGIC_FPS;
  while (sim.state.phase !== 'match_end' && frames < limit) {
    prevStates = [sim.state.fighters[0].state, sim.state.fighters[1].state];
    sim.step({ p1: cpuA.input(sim), p2: cpuB.input(sim) });
    frames++;
    const w = sim.state;
    for (const e of sim.hits) {
      const who = e.attacker === 0 ? a : b;
      const dmg = (damageBy[who] ??= {});
      dmg[e.moveId] = (dmg[e.moveId] ?? 0) + e.damage;
      const k = (kinds[who] ??= {});
      k[e.kind] = (k[e.kind] ?? 0) + 1;
      if (e.kind === 'hit' && WATCH.has(e.moveId)) {
        const st = (hitStates[e.moveId] ??= {});
        const s = prevStates[e.defender]!;
        st[s] = (st[s] ?? 0) + 1;
      }
    }
    const lasted = clock.observe(w.phase, w.frame);
    if (lasted !== null) {
      roundFrames.push(lasted);
      if (w.roundWinner === null) drawRounds++;
      else {
        const winnerId = w.roundWinner === 0 ? a : b;
        const st = stats[winnerId]!;
        st.rounds++;
        st.hpLeftSum += w.fighters[w.roundWinner]!.hp / w.fighters[w.roundWinner]!.def.maxHp;
        st.roundFrames += lasted;
      }
    }
  }

  const outcome = classifyMatch(sim.state.phase, sim.state.wins);
  runs.push({ pair, p1: a, p2: b, seed, cpuSeeds, outcome, roundFrames });
  if (outcome === 'timeout') timeouts++;
  else if (outcome === 'draw') drawMatches++;
  else {
    const winnerId = outcome === 'p1' ? a : b;
    stats[winnerId]!.wins++;
  }
}

const finished = matches - timeouts;
console.log(`matches=${matches} finished=${finished} timeouts=${timeouts} drawMatches=${drawMatches} difficulty=${difficulty} paramVersion=${BALANCE_PARAM_VERSION}`);
console.log(`sides p1First=${sides.p1First} p2First=${sides.p2First} seeds=${seeds[0]}..${seeds[seeds.length - 1]}`);
console.log(`sourceSha256=${fingerprint}`);
for (const id of ids) {
  const s = stats[id]!;
  const winRate = finished ? ((100 * s.wins) / finished).toFixed(0) : '-';
  const hpLeft = s.rounds ? ((100 * s.hpLeftSum) / s.rounds).toFixed(0) : '-';
  const avgRound = s.rounds ? (s.roundFrames / s.rounds / LOGIC_FPS).toFixed(1) : '-';
  console.log(
    `${id.padEnd(8)} match wins ${String(s.wins).padStart(3)} (${winRate}% of finished)  rounds won ${String(s.rounds).padStart(3)}  avg hp left ${hpLeft}%  avg winning round ${avgRound}s`,
  );
}
console.log(`draw rounds ${drawRounds}`);
for (const id of ids) {
  const top = Object.entries(damageBy[id] ?? {})
    .sort((x, y) => y[1] - x[1])
    .slice(0, 6)
    .map(([mv, d]) => `${mv}:${d}`)
    .join('  ');
  const k = Object.entries(kinds[id] ?? {})
    .map(([kk, n]) => `${kk}=${n}`)
    .join(' ');
  console.log(`  ${id} damage by move: ${top}`);
  console.log(`  ${id} events: ${k}`);
}
for (const [mv, st] of Object.entries(hitStates)) {
  const line = Object.entries(st)
    .sort((x, y) => y[1] - x[1])
    .map(([s, n]) => `${s}=${n}`)
    .join(' ');
  console.log(`  ${mv} hit while defender was: ${line}`);
}
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify({ matches, finished, timeouts, drawMatches, drawRounds, difficulty, paramVersion: BALANCE_PARAM_VERSION, sourceSha256: fingerprint, stats, runs, damageBy, kinds }, null, 2) + '\n');
if (finished > 0) {
  const rate0 = stats[ids[0]!]!.wins / finished;
  if (rate0 < 0.35 || rate0 > 0.65) {
    console.log(`WARNING: ${ids[0]} finished-match win rate ${(rate0 * 100).toFixed(0)}% is outside 35-65% (alarm only)`);
    process.exitCode = 2;
  }
}
