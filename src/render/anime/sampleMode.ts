import {
  Btn, K, P, horizontalRelative, isDoubleTap, toNumpad,
  type FighterDef, type FighterState, type FightSim, type InputFrame, type MotionId, type MoveData, type PlayerIndex, type WorldState,
} from '@core/index';
import { actionCanReach } from '../../ai/attackRange';
import { DEFAULT_ANIMS, heldReactionForMove, heldReactionFrameIssues, validateAnimeRuntimeManifest, type AnimeRuntimeManifest } from '../animations';

export const SAMPLE_DUMMY_MODES = ['stand', 'block', 'counter', 'ability', 'human'] as const;
export type SampleDummyMode = typeof SAMPLE_DUMMY_MODES[number];
export const SAMPLE_DUMMY_LABELS: Record<SampleDummyMode, string> = { stand: '站立', block: '站防', counter: '近身轻拳反击', ability: '代表技能循环', human: '人控' };
export const SAMPLE_INPUT_NOTICE = '内部动作样板：只开放素材及反应链完整的能力；完整比赛仍需全动作验收。';

const BASE_STATES = ['idle', 'walk_fwd', 'walk_back', 'crouch', 'block_stand', 'block_crouch', 'hit_stand', 'hit_crouch'];
const AIR_REACTIONS = ['hit_air', 'knockdown', 'getup'];
const JUMP_STATES = ['prejump', 'jump_neutral', 'jump_fwd', 'jump_back', 'landing'];
export interface SampleCapabilities {
  jump: boolean;
  dash: boolean;
  backdash: boolean;
  rollFwd: boolean;
  rollBack: boolean;
  throwTech: boolean;
}
export const CLOSED_SAMPLE_CAPABILITIES: Readonly<SampleCapabilities> = Object.freeze({ jump: false, dash: false, backdash: false, rollFwd: false, rollBack: false, throwTech: false });
const hasStates = (runtime: AnimeRuntimeManifest | undefined, names: readonly string[]): boolean => names.every(name => !!runtime?.anims[name]);

/** Only validated, complete chains unlock an input. A partial jump sheet cannot permit falling into a missing reaction. */
export function sampleCapabilities(runtime: AnimeRuntimeManifest): SampleCapabilities {
  if (validateAnimeRuntimeManifest(runtime).length || !hasStates(runtime, BASE_STATES)) return { ...CLOSED_SAMPLE_CAPABILITIES };
  return {
    jump: hasStates(runtime, [...JUMP_STATES, ...AIR_REACTIONS]),
    dash: hasStates(runtime, ['dash']), backdash: hasStates(runtime, ['backdash']),
    rollFwd: hasStates(runtime, ['roll_fwd']), rollBack: hasStates(runtime, ['roll_back']),
    throwTech: hasStates(runtime, ['throw_tech']),
  };
}

function launches(move: MoveData): boolean {
  return !!move.throwData || move.knockback.y !== 0 || !!move.knockdown
    || !!move.projectiles?.some(projectile => (projectile.knockback?.y ?? move.knockback.y) !== 0);
}

/** Missing *undeclared* dependencies disable one optional move; declared corrupt resources are rejected by the entry gate. */
export function sampleMoveIssues(move: MoveData, runtime: AnimeRuntimeManifest, opponent?: AnimeRuntimeManifest): string[] {
  const issues: string[] = [];
  if (!runtime.anims[move.id]) return [`缺少出招动作 ${move.id}`];
  const own = (names: readonly string[]) => { const missing = names.filter(name => !runtime.anims[name]); if (missing.length) issues.push(`自身缺少 ${missing.join('/')}`); };
  const target = (names: readonly string[]) => { const missing = names.filter(name => !opponent?.anims[name]); if (missing.length) issues.push(`对手缺少 ${missing.join('/')}`); };
  if (move.input.stance === 'air') own([...JUMP_STATES, ...AIR_REACTIONS]);
  if (launches(move)) target(AIR_REACTIONS);
  if (move.throwData) {
    target(['thrown']);
    if (move.throwData.techWindow > 0) { own(['throw_tech']); target(['throw_tech']); }
  }
  const reaction = heldReactionForMove(runtime.characterId, move);
  if (reaction) {
    if (!opponent) issues.push(`对手缺少条件受投 ${reaction}`);
    else issues.push(...heldReactionFrameIssues(opponent.characterId, opponent.anims, opponent.attachments, reaction).map(issue => `对手 ${issue}`));
  }
  // An authored projectile may be reflected later. Its caster must support the resulting reaction as well.
  if (move.projectiles?.length) own(AIR_REACTIONS);
  return issues;
}

const PRACTICE_NEUTRAL = new Set(['idle', 'walk_fwd', 'walk_back', 'crouch']);
const safeNeutral = (fighter: FighterState): boolean => !fighter.airborne && fighter.hitstop === 0 && PRACTICE_NEUTRAL.has(fighter.state);
const SUPPORTED_MOTIONS = new Set<MotionId>(['236', '214', '623', '22', '236236', '214214']);

interface SampleAbility {
  move: MoveData;
  motion: MotionId;
  button: 'P' | 'K';
  press: number;
}

/** Use only an authored move still present in the restricted sample fighter. */
function sampleAbility(fighter: FighterState): SampleAbility | null {
  for (const moveId of fighter.def.skillSlots ?? []) {
    const move = fighter.def.moves.find(candidate => candidate.id === moveId);
    const motion = move?.input.motion;
    if (!move || move.input.stance !== 'stand' || !motion || !SUPPORTED_MOTIONS.has(motion)) continue;
    if (move.input.button === P) return { move, motion, button: 'P', press: Btn.A };
    if (move.input.button === K) return { move, motion, button: 'K', press: Btn.B };
  }
  return null;
}

function classicMotionInput(motion: MotionId, press: number, facing: 1 | -1): number[] {
  const forward = facing === 1 ? Btn.Right : Btn.Left;
  const back = facing === 1 ? Btn.Left : Btn.Right;
  switch (motion) {
    case '236': return [Btn.Down, Btn.Down | forward, forward | press];
    case '214': return [Btn.Down, Btn.Down | back, back | press];
    case '623': return [forward, 0, Btn.Down, Btn.Down | forward, Btn.Down | forward | press];
    case '22': return [Btn.Down, 0, Btn.Down | press];
    case '236236': return [Btn.Down, Btn.Down | forward, forward, 0, Btn.Down, Btn.Down | forward, forward | press];
    case '214214': return [Btn.Down, Btn.Down | back, back, 0, Btn.Down, Btn.Down | back, back | press];
  }
}

/** Training's infiniteHp only heals after burn ends; it does not make KO unreachable. */
export function sampleResetReason(sim: FightSim): 'neutral' | 'ended' | null {
  const world = sim.state;
  if (world.roundOver || world.fighters.some(fighter => fighter.hp <= 0)) return 'ended';
  if (world.phase !== 'fight' || world.projectiles.length || !world.fighters.every(safeNeutral)) return null;
  return world.fighters.some(fighter => fighter.hp < fighter.def.maxHp || fighter.burnFrames > 0) ? 'neutral' : null;
}

/** Existing round-reset API restores health, burn, velocity and hit history without changing core. */
export function resetSampleRound(sim: FightSim, controller: AnimeSampleController): WorldState {
  // A lethal safety reset must not retain the core's awarded win in the practice HUD.
  if (sim.state.roundOver) sim.resetMatch();
  else sim.resetRound();
  controller.reset();
  const world = sim.state;
  // Core refreshes cameraX on step(). The immediate reset view must use the new roots.
  return { ...world, cameraX: (world.fighters[0].x + world.fighters[1].x) >> 1 };
}

/** Only the candidate's move list changes. Every retained MoveData is the original object. */
export function createSampleFighter(def: FighterDef, runtime: AnimeRuntimeManifest, options: { opponentRuntime?: AnimeRuntimeManifest } = {}): FighterDef {
  if (def.id !== runtime.characterId) throw new Error('Candidate character does not match the fighter');
  return {
    ...def,
    moves: def.moves.filter(move => sampleMoveIssues(move, runtime, options.opponentRuntime).length === 0),
  };
}

export interface SampleCoverage {
  ok: boolean;
  requiredStates: string[];
  missingStates: string[];
  missingMoves: string[];
  errors: string[];
}

/** Full matches can reach every locomotion/reaction state, and every current move. */
export function validateFullCoverage(def: FighterDef, runtime: AnimeRuntimeManifest, opponent?: FighterDef): SampleCoverage {
  const requiredStates = Object.keys(DEFAULT_ANIMS).filter(name => name !== 'portrait');
  for (const move of opponent?.moves ?? []) {
    const reaction = heldReactionForMove(opponent!.id, move);
    if (reaction && !requiredStates.includes(reaction)) requiredStates.push(reaction);
  }
  const missingStates = requiredStates.filter(name => !runtime.anims[name]);
  const missingMoves = def.moves.filter(move => !runtime.anims[move.id]).map(move => move.id);
  const errors = validateAnimeRuntimeManifest(runtime, def.moves);
  if (runtime.characterId !== def.id) errors.push('candidate character mismatch');
  return { ok: !missingStates.length && !missingMoves.length && !errors.length, requiredStates, missingStates, missingMoves, errors };
}

/** Reachability includes being hit; disabling jump inputs does not prevent a launch. */
export function validateSampleCoverage(
  def: FighterDef, runtime: AnimeRuntimeManifest, opponent: FighterDef,
  options: { infiniteHp?: boolean } = {},
): SampleCoverage {
  const required = new Set(BASE_STATES);
  const incoming = opponent.moves;
  for (const move of incoming) {
    const reaction = heldReactionForMove(opponent.id, move);
    if (reaction) required.add(reaction);
  }
  if (incoming.some(launches)) for (const name of AIR_REACTIONS) required.add(name);
  if (incoming.some(move => move.throwData)) required.add('thrown');
  if ([...incoming, ...def.moves].some(move => (move.throwData?.techWindow ?? 0) > 0)) required.add('throw_tech');
  const capabilities = sampleCapabilities(runtime);
  if (capabilities.jump || def.moves.some(move => move.input.stance === 'air')) for (const name of [...JUMP_STATES, ...AIR_REACTIONS]) required.add(name);
  for (const [capability, state] of [['dash', 'dash'], ['backdash', 'backdash'], ['rollFwd', 'roll_fwd'], ['rollBack', 'roll_back']] as const) if (capabilities[capability]) required.add(state);
  if (options.infiniteHp === false) for (const name of ['hit_air', 'ko', 'win']) required.add(name);
  const wantedMoves = def.id === 'luffy' ? ['st_a', 'st_c'] : ['st_a'];
  wantedMoves.push(...def.moves.map(move => move.id));
  const missingMoves = [...new Set(wantedMoves)].filter(name => !def.moves.some(move => move.id === name) || !runtime.anims[name]);
  const missingStates = [...required].filter(name => !runtime.anims[name]);
  const errors = validateAnimeRuntimeManifest(runtime, def.moves);
  if (def.id !== runtime.characterId) errors.push('candidate character mismatch');
  if (!['luffy', 'akainu', 'labubu', 'twinkle'].includes(def.id)) errors.push('unsupported sample character');
  return { ok: errors.length === 0 && missingStates.length === 0 && missingMoves.length === 0, requiredStates: [...required], missingStates, missingMoves, errors };
}

/** Photography is opt-in and can only select an already validated drawing, never invent a capability. */
export function sampleHoldPose(value: string | null, runtime: AnimeRuntimeManifest): { pose: string | null; issue: string | null } {
  if (value === null) return { pose: null, issue: null };
  const match = /^([a-z][a-z0-9_]*)(?:\/(\d+))?$/.exec(value);
  const name = match?.[1] ?? '', index = Number(match?.[2] ?? 0);
  const anim = runtime.anims[name];
  if (!match || !Number.isSafeInteger(index) || !anim || index >= anim.frames || !runtime.attachments[`${runtime.characterId}/${name}/${index}`]) return { pose: null, issue: `静帧检查的动作不存在：${value}` };
  return { pose: `${name}/${index}`, issue: null };
}

class DirectionGate {
  blockedDirection = 0;

  filter(fighter: FighterState, raw: number, capabilities: Readonly<SampleCapabilities>): number {
    let bits = raw & (Btn.Left | Btn.Right | Btn.Down | Btn.Start);
    if (capabilities.jump) bits |= raw & Btn.Up;
    const attackMask = fighter.def.moves.reduce((mask, move) => mask | move.input.button | (move.input.plus ?? 0), 0);
    bits |= raw & attackMask;
    if (capabilities.throwTech && fighter.state === 'thrown') bits |= raw & (Btn.C | Btn.D);
    if ((raw & (Btn.A | Btn.B)) === (Btn.A | Btn.B)) {
      const canRoll = horizontalRelative(bits, fighter.facing) === -1 ? capabilities.rollBack : capabilities.rollFwd;
      if (canRoll) bits |= Btn.A | Btn.B;
      else bits &= ~Btn.B;
    }
    const horizontal = bits & (Btn.Left | Btn.Right);
    const direction = horizontal === Btn.Left ? Btn.Left : horizontal === Btn.Right ? Btn.Right : 0;
    if (direction !== this.blockedDirection) this.blockedDirection = 0;
    if (!direction) bits &= ~(Btn.Left | Btn.Right);
    if (direction && !this.blockedDirection && !(bits & (Btn.Down | Btn.Up))) {
      const relative = horizontalRelative(bits, fighter.facing);
      // Read the same detector as core, but never change its history or movement state.
      const available = relative === 1 ? capabilities.dash : capabilities.backdash;
      if (relative !== 0 && !available && isDoubleTap([...fighter.history, toNumpad(bits, fighter.facing)], relative)) this.blockedDirection = direction;
    }
    if (this.blockedDirection === direction && direction) bits &= ~(Btn.Left | Btn.Right);
    return bits;
  }

  reset(): void { this.blockedDirection = 0; }
}

/** Candidate FightSim must use createSampleFighter(). Call once per actual logical step. */
export class AnimeSampleController {
  mode: SampleDummyMode = 'stand';
  private readonly gates = [new DirectionGate(), new DirectionGate()] as const;
  private counterHeld = false;
  private abilityQueue: number[] = [];
  private abilityWait = 30;

  constructor(readonly dummyPlayer: PlayerIndex = 1, readonly capabilities: readonly [Readonly<SampleCapabilities>, Readonly<SampleCapabilities>] = [CLOSED_SAMPLE_CAPABILITIES, CLOSED_SAMPLE_CAPABILITIES]) {}

  availableModes(sim?: FightSim): readonly SampleDummyMode[] {
    const fighter = sim?.state.fighters[this.dummyPlayer];
    const enabled = fighter ? sampleAbility(fighter) !== null : false;
    return enabled ? SAMPLE_DUMMY_MODES : SAMPLE_DUMMY_MODES.filter(mode => mode !== 'ability');
  }

  next(sim?: FightSim): SampleDummyMode {
    const modes = this.availableModes(sim);
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length]!;
    this.counterHeld = false;
    this.abilityQueue = [];
    this.abilityWait = 30;
    return this.mode;
  }

  reset(): void {
    this.gates.forEach(gate => gate.reset());
    this.counterHeld = false;
    this.abilityQueue = [];
    this.abilityWait = 30;
  }

  get blockedDash(): readonly [boolean, boolean] {
    return [this.gates[0].blockedDirection !== 0, this.gates[1].blockedDirection !== 0];
  }

  input(sim: FightSim, raw: InputFrame): InputFrame {
    const bits = [raw.p1, raw.p2];
    if (this.mode !== 'human') {
      bits[this.dummyPlayer] = (bits[this.dummyPlayer]! & Btn.Start) | this.dummyInput(sim);
    }
    return {
      p1: this.gates[0].filter(sim.state.fighters[0], bits[0]!, this.capabilities[0]),
      p2: this.gates[1].filter(sim.state.fighters[1], bits[1]!, this.capabilities[1]),
    };
  }

  private dummyInput(sim: FightSim): number {
    const me = sim.state.fighters[this.dummyPlayer], opponent = sim.state.fighters[this.dummyPlayer === 0 ? 1 : 0];
    if (this.mode === 'stand') { this.counterHeld = false; return 0; }
    if (this.mode === 'ability') return this.abilityInput(sim, me, opponent);
    if (this.mode === 'block') {
      this.counterHeld = false;
      // Remain still between attacks; the engine performs real standing guard on back input.
      const threat = opponent.state === 'attack' || sim.state.projectiles.some(projectile => projectile.owner !== this.dummyPlayer);
      return threat || me.state === 'block_stand' ? me.facing === 1 ? Btn.Left : Btn.Right : 0;
    }
    const canJab = sim.state.phase === 'fight' && !me.airborne && me.hitstop === 0 &&
      ['idle', 'walk_fwd', 'walk_back', 'crouch'].includes(me.state) &&
      me.def.moves.some(move => move.id === 'st_a') &&
      actionCanReach({ kind: 'normal', stance: 'stand', button: 'A' }, me, opponent);
    const pressed = canJab && !this.counterHeld;
    this.counterHeld = pressed;
    return pressed ? Btn.A : 0;
  }

  private abilityInput(sim: FightSim, me: FighterState, opponent: FighterState): number {
    const ability = sampleAbility(me);
    if (!ability || sim.state.phase !== 'fight' || !safeNeutral(me)) {
      this.abilityQueue = [];
      return 0;
    }
    if (this.abilityQueue.length) {
      const bits = this.abilityQueue.shift()!;
      if (!this.abilityQueue.length) this.abilityWait = 30;
      return bits;
    }
    if (!safeNeutral(opponent)) return 0;
    if (this.abilityWait > 0) { this.abilityWait--; return 0; }
    const forward = me.facing === 1 ? Btn.Right : Btn.Left;
    if (!actionCanReach({ kind: 'special', motion: ability.motion, button: ability.button }, me, opponent)) return forward;
    this.abilityQueue = classicMotionInput(ability.motion, ability.press, me.facing);
    const bits = this.abilityQueue.shift() ?? 0;
    if (!this.abilityQueue.length) {
      this.abilityWait = 30;
    }
    return bits;
  }
}
