import {
  GRAVITY,
  GROUND_Y,
  LOGIC_FPS,
  MAX_FALL_SPEED,
  MAX_SEPARATION,
  STAGE_LEFT,
  STAGE_RIGHT,
  SUBPIXEL,
  px,
} from './constants';
import { overlapX, overlaps, toWorldBox } from './collision';
import { isDoubleTap, matchMotion, MOTION_PRIORITY } from './commands';
import { has, horizontalRelative, pressedTogether, toNumpad } from './input';
import { firstActiveFrame, frameAt, inStartupOrActive } from './moveBuilder';
import { Rng } from './Rng';
import {
  ANY_ATTACK,
  ANY_SKILL,
  ATTACK_BUTTONS,
  SKILL_BUTTONS,
  Btn,
  INPUT_HISTORY,
  MAX_JUGGLE,
  MAX_METER,
  MOVE_RANK,
  type AttackIntent,
  type AttackButton,
  type Box,
  type BoxPx,
  type BurnDef,
  type ControlModes,
  type FighterDef,
  type FighterState,
  type FrameData,
  type GuardType,
  type HitEvent,
  type HitKind,
  type InputFrame,
  type InstallDef,
  type Knockback,
  type MoveData,
  type Phase,
  type PlayerIndex,
  type ProjectileEndEvent,
  type ProjectileEndReason,
  type ProjectileState,
  type SkillAvailability,
  type SkillFeedback,
  type SkillReason,
  type Stance,
  type StateId,
  type WorldState,
} from './types';

export interface TrainingOptions {
  /** 双方都回到中立且无连段时回满血 */
  infiniteHp: boolean;
  /** 气槽始终满 */
  infiniteMeter: boolean;
}

export interface FightSimOptions {
  p1: FighterDef;
  p2: FighterDef;
  seed?: number;
  /** 回合开始前的冻结帧数（READY），默认 INTRO_FRAMES；测试可设 0 */
  introFrames?: number;
  /** 回合时间（秒），-1 无限 */
  roundTime?: number;
  /** 先胜几局赢下比赛 */
  roundsToWin?: number;
  /** 旧输入与旧回放省略时仍按经典指令解释。 */
  controlModes?: ControlModes;
}

export const PREJUMP_FRAMES = 3;
export const LANDING_FRAMES = 3;
export const KNOCKDOWN_FRAMES = 36;
export const GETUP_FRAMES = 14;
export const THROW_TECH_FRAMES = 20;
export const INTRO_FRAMES = 60;
export const ROUND_END_FRAMES = 150;
export const ROUNDS_TO_WIN = 2;
const DEFAULT_ROUND_TIME = 99;
/** 按键缓冲帧数 */
const BUTTON_BUFFER = 4;
/** 默认取消窗口（自命中起） */
const DEFAULT_CANCEL_WINDOW = 12;
/** 反击追加硬直 */
const COUNTER_BONUS_STUN = 4;
/** 地面受击 / 防御时的击退摩擦（子像素 / 帧²） */
const GROUND_FRICTION = px(0.35);
/** 防御击退相对命中击退的比例（/8） */
const BLOCK_PUSHBACK_NUM = 5;
/** 撞墙反弹水平速度保留比例（/8） */
const WALL_BOUNCE_NUM = 5;
/** 灼烧不会把血量打到 0 以下的下限 */
const BURN_HP_FLOOR = 1;

const OPERABLE: ReadonlySet<StateId> = new Set(['idle', 'walk_fwd', 'walk_back', 'crouch', 'dash']);
const GUARD_CAPABLE: ReadonlySet<StateId> = new Set([
  'idle', 'walk_back', 'crouch', 'landing', 'block_stand', 'block_crouch',
]);
const THROWABLE: ReadonlySet<StateId> = new Set([
  'idle', 'walk_fwd', 'walk_back', 'crouch', 'landing', 'dash', 'attack', 'roll_fwd', 'roll_back', 'backdash',
]);
const IN_COMBO: ReadonlySet<StateId> = new Set(['hit_stand', 'hit_crouch', 'hit_air', 'thrown']);
const NEUTRAL: ReadonlySet<StateId> = new Set([
  'idle', 'walk_fwd', 'walk_back', 'crouch', 'prejump', 'jump_neutral', 'jump_fwd', 'jump_back', 'landing', 'dash', 'backdash', 'roll_fwd', 'roll_back',
]);

/** 连段伤害衰减：第 n 段 = 伤害 × max(3, 11 − n) / 10 */
export function scaledDamage(damage: number, comboHits: number): number {
  const num = Math.max(3, 11 - comboHits);
  return Math.floor((damage * num) / 10);
}

/** 打击参数（招式或飞行道具共用） */
interface HitSpec {
  moveId: string;
  moveInstance: number;
  type: MoveData['type'];
  damage: number;
  guard: GuardType;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockback: Knockback;
  knockdown: boolean;
  wallBounce: boolean;
  burn: BurnDef | null;
  armorBreak: boolean;
  projectile: ProjectileState | null;
}

/** 本次确实相交的打击框/受击框中心；在任一方受击变换姿态之前保存。 */
interface StrikeContact {
  move: MoveData;
  x: number;
  y: number;
}

/**
 * 格斗世界模拟器。固定步长、确定性、无渲染依赖。
 * 每次 step(input) 推进一帧。
 */
export class FightSim {
  readonly rng: Rng;
  readonly controlModes: ControlModes;
  readonly skillFeedback: [SkillFeedback | null, SkillFeedback | null] = [null, null];
  private frame = 0;
  private readonly fighters: [FighterState, FighterState];
  private projectiles: ProjectileState[] = [];
  private nextProjectileId = 1;
  private cameraX = 0;
  private phase: Phase = 'intro';
  private phaseFrame = 0;
  private round = 1;
  private wins: [number, number] = [0, 0];
  private timer: number;
  private roundWinner: PlayerIndex | null = null;
  private readonly introFrames: number;
  private readonly roundTimeFrames: number;
  private readonly roundsToWin: number;
  /** 本帧产生的事件（每帧清空） */
  readonly hits: HitEvent[] = [];
  private readonly projectileEndEvents: ProjectileEndEvent[] = [];
  /** 训练模式开关：每帧结束时生效 */
  training: TrainingOptions = { infiniteHp: false, infiniteMeter: false };

  constructor(private readonly opts: FightSimOptions) {
    this.controlModes = [opts.controlModes?.[0] ?? 'classic', opts.controlModes?.[1] ?? 'classic'];
    this.rng = new Rng(opts.seed ?? 1);
    this.introFrames = opts.introFrames ?? INTRO_FRAMES;
    const rt = opts.roundTime ?? DEFAULT_ROUND_TIME;
    this.roundTimeFrames = rt < 0 ? -1 : rt * LOGIC_FPS;
    this.roundsToWin = opts.roundsToWin ?? ROUNDS_TO_WIN;
    this.timer = this.roundTimeFrames;
    this.fighters = [createFighter(opts.p1, 0, px(-90), 1), createFighter(opts.p2, 1, px(90), -1)];
    if (this.introFrames === 0) this.phase = 'fight';
  }

  get state(): WorldState {
    const over = this.phase === 'round_end' || this.phase === 'match_end';
    return {
      frame: this.frame,
      fighters: this.fighters,
      projectiles: this.projectiles,
      cameraX: this.cameraX,
      phase: this.phase,
      phaseFrame: this.phaseFrame,
      round: this.round,
      wins: this.wins,
      timer: this.timer,
      roundWinner: this.roundWinner,
      roundOver: over,
      winner: over ? this.roundWinner : null,
    };
  }

  /**
   * 最近一次 step / 直接 reset 产生的道具结束事件；下一次操作开始时清空。
   * 渲染层应在每次操作后立即消费；跨帧保存时复制数组，事件本身是独立值快照。
   */
  get projectileEnds(): readonly ProjectileEndEvent[] {
    return this.projectileEndEvents;
  }

  /** Scene pause/focus loss discards pending input, without advancing or cancelling an action. */
  clearInputs(): void {
    for (const f of this.fighters) {
      f.bits = 0;
      f.prevBits = 0;
      f.history = [];
      f.buffered = null;
      f.bufferTtl = 0;
    }
    this.skillFeedback[0] = this.skillFeedback[1] = null;
  }

  /** 重开一局：位置与血量复位，气槽保留（KOF 口径）。 */
  resetRound(): void {
    this.skillFeedback[0] = this.skillFeedback[1] = null;
    this.clearStepEvents();
    this.clearProjectiles('round_reset');
    const meters = [this.fighters[0].meter, this.fighters[1].meter];
    this.fighters[0] = createFighter(this.opts.p1, 0, px(-90), 1);
    this.fighters[1] = createFighter(this.opts.p2, 1, px(90), -1);
    this.fighters[0].meter = meters[0]!;
    this.fighters[1].meter = meters[1]!;
    this.timer = this.roundTimeFrames;
    this.roundWinner = null;
    this.setPhase(this.introFrames === 0 ? 'fight' : 'intro');
  }

  /** 重开整场比赛。 */
  resetMatch(): void {
    this.round = 1;
    this.wins = [0, 0];
    this.resetRound();
    this.fighters[0].meter = 0;
    this.fighters[1].meter = 0;
  }

  /** 训练模式：把双方拉回初始位置与中立状态，保留血量与气。 */
  resetPositions(): void {
    this.skillFeedback[0] = this.skillFeedback[1] = null;
    this.clearStepEvents();
    this.clearProjectiles('position_reset');
    for (const f of this.fighters) {
      const fresh = createFighter(f.def, f.player, f.player === 0 ? px(-90) : px(90), f.player === 0 ? 1 : -1);
      fresh.hp = f.hp;
      fresh.meter = f.meter;
      this.fighters[f.player] = fresh;
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseFrame = 0;
    if (p === 'round_end' || p === 'match_end') this.clearProjectiles('round_end');
  }

  private applyTraining(): void {
    const t = this.training;
    if (!t.infiniteHp && !t.infiniteMeter) return;
    for (const f of this.fighters) {
      if (t.infiniteMeter) f.meter = MAX_METER;
    }
    if (t.infiniteHp) {
      const [a, b] = this.fighters;
      const calm = (f: FighterState) => NEUTRAL.has(f.state) && f.comboHits === 0 && f.burnFrames === 0;
      if (calm(a) && calm(b) && this.projectiles.length === 0) {
        a.hp = a.def.maxHp;
        b.hp = b.def.maxHp;
      }
    }
  }

  step(input: InputFrame): void {
    this.clearStepEvents();
    const [f1, f2] = this.fighters;
    for (const f of this.fighters) {
      f.justHit = false;
      f.justBlocked = false;
    }

    switch (this.phase) {
      case 'intro':
        this.readInputOnly(f1, input.p1);
        this.readInputOnly(f2, input.p2);
        this.phaseFrame++;
        if (this.phaseFrame >= this.introFrames) this.setPhase('fight');
        break;
      case 'fight':
        this.stepFight(f1, f2, input);
        break;
      case 'round_end':
        for (const f of this.fighters) if (f.state !== 'ko') this.advanceAfterRound(f);
        this.physics(f1);
        this.physics(f2);
        this.phaseFrame++;
        if (this.phaseFrame >= ROUND_END_FRAMES) this.finishRound();
        break;
      case 'match_end':
        this.readInputOnly(f1, input.p1);
        this.readInputOnly(f2, input.p2);
        this.phaseFrame++;
        if (has(input.p1, Btn.Start) || has(input.p2, Btn.Start)) this.resetMatch();
        break;
    }

    if (this.phase === 'fight') this.applyTraining();
    this.cameraX = (f1.x + f2.x) >> 1;
    this.frame++;
  }

  private stepFight(f1: FighterState, f2: FighterState, input: InputFrame): void {
    // 1. 输入 → 状态（hitstop 中冻结）；持续效果计时
    this.updateFighter(f1, f2, input.p1);
    this.updateFighter(f2, f1, input.p2);
    this.tickStatus(f1);
    this.tickStatus(f2);

    // 2. 拆投（双方都已读入本帧输入后判定，保证 P1/P2 对称）与投技锁定位置
    this.checkThrowTech(f1, f2);
    this.checkThrowTech(f2, f1);
    this.holdThrown(f1, f2);
    this.holdThrown(f2, f1);

    // 3. 指令投抓取 → 打击判定（同帧双向，支持相杀）→ 飞行道具
    this.detectGrab(f1, f2);
    this.detectGrab(f2, f1);
    const hit1 = this.detectStrike(f1, f2);
    const hit2 = this.detectStrike(f2, f1);
    if (hit1) this.applyHit(f1, f2, this.specFromMove(f1, hit1.move), hit1);
    if (hit2) this.applyHit(f2, f1, this.specFromMove(f2, hit2.move), hit2);
    this.updateProjectiles();

    // 4. 物理与约束
    if (f1.hitstop === 0) this.physics(f1);
    if (f2.hitstop === 0) this.physics(f2);
    this.separatePushboxes(f1, f2);
    this.clampToStage(f1, f2);
    updateFacing(f1, f2);

    // 5. KO：一击必定击飞，落地后进入 ko
    let koed = false;
    for (const f of this.fighters) {
      if (f.hp <= 0 && f.state !== 'ko') {
        f.hp = 0;
        koed = true;
        if (!f.airborne) {
          const other = this.fighters[f.player === 0 ? 1 : 0];
          f.airborne = true;
          f.vx = px(5) * other.facing;
          f.vy = px(-6);
          setState(f, 'hit_air');
        }
        f.hardKnockdown = true;
        f.stun = 1 << 30;
      }
    }
    if (koed) {
      const a = this.fighters[0].hp;
      const b = this.fighters[1].hp;
      this.roundWinner = a <= 0 && b <= 0 ? null : a <= 0 ? 1 : 0;
      this.setPhase('round_end');
      return;
    }

    // 6. 计时
    if (this.timer > 0) {
      this.timer--;
      if (this.timer === 0) {
        const a = this.fighters[0].hp;
        const b = this.fighters[1].hp;
        this.roundWinner = a === b ? null : a > b ? 0 : 1;
        this.setPhase('round_end');
      }
    }
    this.phaseFrame++;
  }

  private finishRound(): void {
    if (this.roundWinner !== null) this.wins[this.roundWinner]++;
    if (this.wins[0] >= this.roundsToWin || this.wins[1] >= this.roundsToWin) {
      this.setPhase('match_end');
      return;
    }
    this.round++;
    this.resetRound();
  }

  /** 冻结阶段：只记录输入（保持边沿检测连续），不推进状态。 */
  private readInputOnly(f: FighterState, bits: number): void {
    if (this.controlModes[f.player] === 'simple') {
      const slot = SKILL_BUTTONS.findIndex(bit => (bits & ~f.bits & bit) !== 0);
      if (slot >= 0) this.skillFeedback[f.player] = { slot, frame: this.frame, reason: 'phase' };
    }
    f.prevBits = f.bits;
    f.bits = bits;
    this.pushHistory(f, bits);
  }

  // ---------- 判定框查询（渲染 / 调试 / 碰撞共用） ----------

  stance(f: FighterState): Stance {
    if (f.airborne) return 'air';
    switch (f.state) {
      case 'crouch':
      case 'hit_crouch':
      case 'block_crouch':
        return 'crouch';
      case 'attack': {
        const m = this.move(f);
        return m?.input.stance === 'crouch' ? 'crouch' : 'stand';
      }
      case 'roll_fwd':
      case 'roll_back':
      case 'knockdown':
        return 'crouch';
      default:
        return 'stand';
    }
  }

  pushbox(f: FighterState): Box {
    const s = this.stance(f);
    const def = s === 'air' ? f.def.pushboxAir : s === 'crouch' ? f.def.pushboxCrouch : f.def.pushboxStand;
    return toWorldBox(def, f.x, f.y, f.facing);
  }

  /** 打击无敌：翻滚前段、后撤步前段、倒地、起身、投技抓取中、超必杀启动 / 闪避、浮空段数用尽、KO */
  isStrikeInvulnerable(f: FighterState): boolean {
    switch (f.state) {
      case 'roll_fwd':
      case 'roll_back':
        return f.stateFrame < f.def.movement.rollInvuln;
      case 'backdash':
        return f.stateFrame < f.def.movement.backdashInvuln;
      case 'attack': {
        const m = this.move(f);
        return !!m?.invuln && f.stateFrame < m.invuln;
      }
      case 'hit_air':
        return f.juggle >= MAX_JUGGLE;
      case 'knockdown':
      case 'getup':
      case 'thrown':
      case 'throw_tech':
      case 'ko':
        return true;
      case 'throw':
        return !f.hasHit; // 放人后的收招可以被反击。
      default:
        return false;
    }
  }

  isThrowable(f: FighterState): boolean {
    if (f.state === 'throw') return !f.airborne && f.hasHit;
    if (f.airborne || !THROWABLE.has(f.state)) return false;
    if (f.state === 'attack') {
      const m = this.move(f);
      if (m?.dodge && m.invuln && f.stateFrame < m.invuln) return false;
    }
    return true;
  }

  /** 当前帧是否带霸体且尚未被消耗 */
  hasArmor(f: FighterState): boolean {
    if (f.state !== 'attack' || f.armorBroken) return false;
    return !!this.currentFrame(f)?.armor;
  }

  hurtboxes(f: FighterState, ignoreJuggleCap = false): Box[] {
    const juggleCapped = f.state === 'hit_air' && f.juggle >= MAX_JUGGLE;
    if (juggleCapped ? !ignoreJuggleCap : this.isStrikeInvulnerable(f)) return [];
    const fd = this.currentFrame(f);
    let boxes: readonly BoxPx[];
    if (fd?.hurtboxes) boxes = fd.hurtboxes;
    else {
      const s = this.stance(f);
      boxes = s === 'air' ? f.def.hurtboxAir : s === 'crouch' ? f.def.hurtboxCrouch : f.def.hurtboxStand;
    }
    return boxes.map((b) => toWorldBox(b, f.x, f.y, f.facing));
  }

  /** 当前帧攻击框（世界坐标），已排除本招已命中的段。弹反框与抓取框也由此返回，由调用方区分。 */
  hitboxes(f: FighterState): Box[] {
    if (f.state !== 'attack') return [];
    const fd = this.currentFrame(f);
    if (!fd?.hitboxes) return [];
    const id = fd.hitId ?? 1;
    if (f.hitMask & (1 << id)) return [];
    return fd.hitboxes.map((b) => toWorldBox(b, f.x, f.y, f.facing));
  }

  move(f: FighterState): MoveData | null {
    if (!f.moveId) return null;
    return f.def.moves.find((m) => m.id === f.moveId) ?? null;
  }

  currentFrame(f: FighterState): FrameData | null {
    const m = this.move(f);
    return m && f.state === 'attack' ? frameAt(m, f.stateFrame) : null;
  }

  /** 是否正在防御（含防御硬直中） */
  isGuarding(f: FighterState): boolean {
    if (f.airborne || !GUARD_CAPABLE.has(f.state)) return false;
    return horizontalRelative(f.bits, f.facing) === -1;
  }

  installDef(f: FighterState): InstallDef | null {
    if (!f.install) return null;
    return f.def.moves.find((m) => m.install?.id === f.install)?.install ?? null;
  }

  /** UI 查询与实际快捷出招共用资格检查；不会写战斗状态。 */
  skillAvailability(player: PlayerIndex, slot: number): SkillAvailability {
    const f = this.fighters[player];
    const m = this.skillMove(f, slot);
    let reason: SkillReason;
    if (!m) reason = 'missing';
    else if (this.phase !== 'fight') reason = 'phase';
    else if (f.state === 'attack') {
      const from = this.move(f);
      reason = from && f.hasHit && f.stateFrame + 1 <= f.cancelUntil
        ? this.skillMoveReason(f, m, from) : 'cancel';
    } else if (!OPERABLE.has(f.state) && !f.state.startsWith('jump_')) reason = 'recovery';
    else reason = this.skillMoveReason(f, m, null);
    return { moveId: m?.id ?? '', available: reason === 'ready', reason };
  }

  private skillMove(f: FighterState, slot: number): MoveData | null {
    const id = Number.isInteger(slot) && slot >= 0 && slot < SKILL_BUTTONS.length ? f.def.skillSlots?.[slot] : undefined;
    return f.def.moves.find(m => m.id === id && !!m.input.motion) ?? null;
  }

  private skillMoveReason(f: FighterState, m: MoveData, from: MoveData | null): SkillReason {
    if ((m.input.stance === 'air') !== f.airborne) return 'air';
    if (from && MOVE_RANK[m.type] <= MOVE_RANK[from.type] && !from.chain?.includes(m.id)) return 'cancel';
    if ((m.meterCost ?? 0) > f.meter) return 'meter';
    return 'ready';
  }

  /** 应用强化 / 疲劳的移速倍率 */
  private speed(f: FighterState, v: number): number {
    const inst = this.installDef(f);
    if (inst) return Math.floor((v * inst.speedNum) / inst.speedDen);
    if (f.fatigueFrames > 0) {
      const d = f.def.moves.find((m) => m.install)?.install;
      if (d) return Math.floor((v * d.fatigueSpeedNum) / d.fatigueSpeedDen);
    }
    return v;
  }

  // ---------- 每帧状态推进 ----------

  private pushHistory(f: FighterState, bits: number): void {
    f.history.push(toNumpad(bits, f.facing));
    if (f.history.length > INPUT_HISTORY) f.history.shift();
  }

  /** 强化 / 疲劳 / 灼烧计时（不受打击定格影响） */
  private tickStatus(f: FighterState): void {
    if (f.install && --f.installFrames <= 0) {
      const d = this.installDef(f);
      f.install = null;
      f.installFrames = 0;
      f.fatigueFrames = d?.fatigueFrames ?? 0;
    } else if (f.fatigueFrames > 0) {
      f.fatigueFrames--;
    }
    if (f.burnFrames > 0 && f.state !== 'ko') {
      f.burnFrames--;
      f.burnTick += f.burnDps;
      while (f.burnTick >= LOGIC_FPS) {
        f.burnTick -= LOGIC_FPS;
        if (f.hp > BURN_HP_FLOOR) f.hp--;
      }
      if (f.burnFrames === 0) f.burnTick = 0;
    }
  }

  private updateFighter(f: FighterState, opp: FighterState, bits: number): void {
    const pressed = bits & ~f.bits;
    f.prevBits = f.bits;
    f.bits = bits;
    this.pushHistory(f, bits);

    const simple = this.controlModes[f.player] === 'simple';
    const newAttack = pressed & (ANY_ATTACK | (simple ? ANY_SKILL : 0));
    const slot = simple ? SKILL_BUTTONS.findIndex(bit => (pressed & bit) !== 0) : -1;
    if (newAttack) {
      f.buffered = {
        bits,
        pressed: slot >= 0 ? SKILL_BUTTONS[slot]! : pressed & ANY_ATTACK,
        facing: f.facing,
        motions: simple ? [] : MOTION_PRIORITY.filter((motion) => matchMotion(f.history, motion)),
        ...(slot >= 0 ? { skillSlot: slot } : {}),
      };
      f.bufferTtl = BUTTON_BUFFER;
      if (slot >= 0) this.skillFeedback[f.player] = { slot, frame: this.frame, reason: this.skillAvailability(f.player, slot).reason };
    }

    if (NEUTRAL.has(f.state) && f.comboHits > 0) {
      f.comboHits = 0;
      f.comboDamage = 0;
    }

    // 打击定格：世界冻结，缓冲也冻结
    if (f.hitstop > 0) {
      f.hitstop--;
      return;
    }
    if (!newAttack && f.bufferTtl > 0 && --f.bufferTtl === 0) f.buffered = null;

    const mv = f.def.movement;

    switch (f.state) {
      case 'hit_stand':
      case 'hit_crouch':
        f.stun--;
        if (f.stun <= 0) setState(f, f.state === 'hit_crouch' ? 'crouch' : 'idle');
        else f.stateFrame++;
        return;
      case 'block_stand':
      case 'block_crouch': {
        f.stun--;
        const crouch = has(bits, Btn.Down);
        if (f.stun <= 0) setState(f, crouch ? 'crouch' : 'idle');
        else {
          const want: StateId = crouch ? 'block_crouch' : 'block_stand';
          if (f.state !== want) f.state = want;
          f.stateFrame++;
        }
        return;
      }
      case 'hit_air':
        f.stateFrame++;
        return;
      case 'knockdown':
        f.stateFrame++;
        if (f.stateFrame >= KNOCKDOWN_FRAMES) setState(f, 'getup');
        return;
      case 'getup':
        f.stateFrame++;
        if (f.stateFrame >= GETUP_FRAMES) setState(f, 'idle');
        return;
      case 'ko':
      case 'thrown':
        return;
      case 'throw_tech':
        f.stateFrame++;
        if (f.stateFrame >= THROW_TECH_FRAMES) setState(f, 'idle');
        return;
      case 'throw':
        this.tickThrow(f, opp);
        return;
      case 'prejump': {
        f.stateFrame++;
        if (!has(bits, Btn.Up)) f.hopPending = true;
        if (f.stateFrame >= PREJUMP_FRAMES) {
          const h = f.jumpDirection * f.facing;
          f.airborne = true;
          f.vy = f.hopPending ? mv.hopVelocityY : mv.jumpVelocityY;
          f.vx = f.jumpDirection * this.speed(f, mv.jumpVelocityX);
          setState(f, h === 1 ? 'jump_fwd' : h === -1 ? 'jump_back' : 'jump_neutral');
        }
        return;
      }
      case 'landing':
        f.stateFrame++;
        if (f.stateFrame >= LANDING_FRAMES) setState(f, 'idle');
        return;
      case 'backdash': {
        f.stateFrame++;
        const remain = mv.backdashFrames - f.stateFrame;
        f.vx = -f.facing * Math.floor((this.speed(f, mv.backdashSpeed) * Math.max(remain, 0)) / mv.backdashFrames);
        if (f.stateFrame >= mv.backdashFrames) {
          f.vx = 0;
          setState(f, 'idle');
        }
        return;
      }
      case 'roll_fwd':
      case 'roll_back': {
        f.stateFrame++;
        const dir = f.state === 'roll_fwd' ? 1 : -1;
        f.vx = f.stateFrame < (mv.rollFrames * 3) >> 2 ? dir * f.facing * this.speed(f, mv.rollSpeed) : 0;
        if (f.stateFrame >= mv.rollFrames) {
          f.vx = 0;
          setState(f, 'idle');
        }
        return;
      }
      case 'attack': {
        const m = this.move(f);
        f.stateFrame++;
        if (m && f.hasHit && f.stateFrame <= f.cancelUntil && this.tryAttack(f, opp, f.buffered, m)) return;
        const fd = m ? frameAt(m, f.stateFrame) : null;
        if (m) this.spawnProjectiles(f, m);
        if (fd?.velocity?.x) f.vx = px(fd.velocity.x) * f.facing;
        else if (!f.airborne) f.vx = 0;
        if (!fd) {
          f.moveId = null;
          if (f.airborne) setState(f, 'jump_neutral');
          else setState(f, has(bits, Btn.Down) ? 'crouch' : 'idle');
        }
        return;
      }
      default:
        break;
    }

    // ---- 可操作状态（idle / walk / crouch / dash / 空中）----

    if (!f.airborne && f.buffered && pressedTogether(f.buffered.bits, f.buffered.pressed, Btn.A, Btn.B)) {
      const h = horizontalRelative(f.buffered.bits, f.buffered.facing);
      f.buffered = null;
      f.bufferTtl = 0;
      setState(f, h === -1 ? 'roll_back' : 'roll_fwd');
      return;
    }

    if (this.tryAttack(f, opp, f.buffered, null)) return;

    if (f.airborne) {
      f.stateFrame++;
      return;
    }

    const h = horizontalRelative(bits, f.facing);
    const up = has(bits, Btn.Up);
    const down = has(bits, Btn.Down);

    if (f.state === 'dash') {
      if (h === 1 && !up && !down) {
        f.vx = f.facing * this.speed(f, mv.runSpeed);
        f.stateFrame++;
        return;
      }
    } else if (h === 1 && !up && !down && isDoubleTap(f.history, 1)) {
      f.vx = f.facing * this.speed(f, mv.runSpeed);
      setState(f, 'dash');
      return;
    }
    if (h === -1 && !up && !down && isDoubleTap(f.history, -1)) {
      setState(f, 'backdash');
      f.vx = -f.facing * this.speed(f, mv.backdashSpeed);
      return;
    }

    if (up && !down) {
      f.vx = 0;
      f.hopPending = false;
      f.jumpDirection = (h * f.facing) as -1 | 0 | 1;
      setState(f, 'prejump');
      return;
    }
    if (down) {
      f.vx = 0;
      setState(f, 'crouch');
      return;
    }
    if (h === 1) {
      f.vx = this.speed(f, mv.walkFwdSpeed) * f.facing;
      setState(f, 'walk_fwd');
    } else if (h === -1) {
      f.vx = -this.speed(f, mv.walkBackSpeed) * f.facing;
      setState(f, 'walk_back');
    } else {
      f.vx = 0;
      setState(f, 'idle');
    }
  }

  /**
   * 按键 → 选招。优先级：搓招（终极 > 超 > 特殊）> 普通投 > 双键 > 单键普通技（方向派生优先）。
   * 搓招优先于投技：贴身 236+C 必须出特殊技而不是投（KOF 口径）。
   * from 非空表示取消：只允许更高等级或 chain 列表内的目标，且不允许普通投。
   */
  private tryAttack(f: FighterState, opp: FighterState, intent: AttackIntent | null, from: MoveData | null): boolean {
    if (!intent) return false;
    if (intent.skillSlot !== undefined) {
      if (this.controlModes[f.player] !== 'simple') return false;
      const m = this.skillMove(f, intent.skillSlot);
      const reason = m ? this.skillMoveReason(f, m, from) : 'missing';
      if (m && reason === 'ready') {
        this.skillFeedback[f.player] = { slot: intent.skillSlot, frame: this.frame, reason: 'ready' };
        this.startMove(f, m);
        return true;
      }
      // Preserve only the ordinary four-frame buffer; never downgrade to another move.
      return false;
    }
    const { bits, pressed } = intent;
    const stance: Stance = f.airborne ? 'air' : has(bits, Btn.Down) ? 'crouch' : 'stand';
    const h = horizontalRelative(bits, intent.facing);
    const dist = Math.abs(f.x - opp.x);
    const allowed = (m: MoveData) =>
      !from || MOVE_RANK[m.type] > MOVE_RANK[from.type] || (from.chain?.includes(m.id) ?? false);

    const motionStanceOk = (m: MoveData) =>
      m.input.stance === stance || (m.input.stance === 'stand' && stance === 'crouch');
    for (const motion of MOTION_PRIORITY) {
      if (!intent.motions.includes(motion)) continue;
      // 同一指令下终极 > 超 > 特殊
      const cands = f.def.moves
        .filter((m) => m.input.motion === motion && motionStanceOk(m) && (pressed & m.input.button) !== 0)
        .sort((a, b) => MOVE_RANK[b.type] - MOVE_RANK[a.type]);
      for (const m of cands) {
        if (!allowed(m)) continue;
        if ((m.meterCost ?? 0) > f.meter) continue;
        this.startMove(f, m);
        return true;
      }
    }

    if (!from && stance === 'stand' && h !== 0) {
      for (const m of f.def.moves) {
        if (m.type !== 'throw' || !m.throwData) continue;
        const wantDir = h === 1 ? 6 : 4;
        if (m.input.direction !== wantDir || !(pressed & m.input.button)) continue;
        if (dist <= px(m.throwData.range) && this.isThrowable(opp)) {
          this.startThrow(f, opp, m);
          return true;
        }
      }
    }

    for (const m of f.def.moves) {
      if (!m.input.plus || m.input.motion || m.input.stance !== stance || !allowed(m)) continue;
      if (pressedTogether(bits, pressed, m.input.button as AttackButton, m.input.plus)) {
        this.startMove(f, m);
        return true;
      }
    }

    for (const b of ATTACK_BUTTONS) {
      if (!(pressed & b)) continue;
      const m = this.findNormal(f, stance, b, h, has(bits, Btn.Down));
      if (m && allowed(m)) {
        this.startMove(f, m);
        return true;
      }
    }
    return false;
  }

  /** 普通技选择：方向派生（6C）与按下派生（j.2D）优先于素技。 */
  private findNormal(f: FighterState, stance: Stance, b: AttackButton, h: -1 | 0 | 1, down: boolean): MoveData | null {
    let best: MoveData | null = null;
    let bestScore = -1;
    for (const m of f.def.moves) {
      if (m.type !== 'normal' && m.type !== 'command_normal') continue;
      if (m.input.stance !== stance || m.input.button !== b || m.input.plus || m.input.motion) continue;
      if (m.input.direction && m.input.direction !== (h === 1 ? 6 : h === -1 ? 4 : 0)) continue;
      if (m.input.down && !down) continue;
      const score = (m.input.direction ? 2 : 0) + (m.input.down ? 1 : 0);
      if (score > bestScore) {
        best = m;
        bestScore = score;
      }
    }
    return best;
  }

  private startMove(f: FighterState, m: MoveData): void {
    f.moveId = m.id;
    f.moveInstance++;
    f.hitMask = 0;
    f.hasHit = false;
    f.armorBroken = false;
    f.cancelUntil = 0;
    f.buffered = null;
    f.bufferTtl = 0;
    if (m.meterCost) f.meter -= m.meterCost;
    if (!f.airborne) f.vx = 0;
    f.state = 'attack';
    f.stateFrame = 0;
    if (m.install) {
      f.install = m.install.id;
      f.installFrames = m.install.duration;
      f.fatigueFrames = 0;
    }
    // 强化状态：特殊技启动加速（跳过前几帧，但不跳过 active）
    const inst = this.installDef(f);
    if (inst && m.type === 'special' && !m.install) {
      const fa = firstActiveFrame(m);
      if (fa > 1) f.stateFrame = Math.min(inst.specialStartupSkip, fa - 1);
    }
    const fd = frameAt(m, f.stateFrame);
    if (fd?.velocity?.x) f.vx = px(fd.velocity.x) * f.facing;
    this.spawnProjectiles(f, m);
  }

  // ---------- 投技 ----------

  private startThrow(att: FighterState, def: FighterState, m: MoveData): void {
    att.moveId = m.id;
    att.moveInstance++;
    att.hitMask = 0;
    att.hasHit = false;
    att.buffered = null;
    att.bufferTtl = 0;
    att.vx = 0;
    att.state = 'throw';
    att.stateFrame = 0;
    def.moveId = null;
    def.vx = 0;
    def.vy = 0;
    def.airborne = false;
    setState(def, 'thrown');
    this.holdThrown(att, def);
    this.pushEvent('throw', att, def, m.id, 0, false, false, def.x, def.y - px(60));
  }

  private holdThrown(att: FighterState, def: FighterState): void {
    if (att.state !== 'throw' || def.state !== 'thrown') return;
    const m = this.move(att);
    if (!m?.throwData) return;
    const offset = att.facing * px(m.throwData.holdOffset);
    if (m.throwData.keepHoldOffsetAtWall) {
      // Intersect both legal root intervals before the ordinary per-fighter clamp.
      // All existing throws remain on the original path unless their data opts in.
      const attackerHalf = (att.def.pushboxStand[2] * SUBPIXEL) >> 1;
      const defenderHalf = (def.def.pushboxStand[2] * SUBPIXEL) >> 1;
      const minX = Math.max(STAGE_LEFT + attackerHalf, STAGE_LEFT + defenderHalf - offset);
      const maxX = Math.min(STAGE_RIGHT - attackerHalf, STAGE_RIGHT - defenderHalf - offset);
      att.x = Math.max(minX, Math.min(maxX, att.x));
    }
    def.x = att.x + offset;
    def.y = GROUND_Y;
    def.facing = att.facing === 1 ? -1 : 1;
  }

  /** 拆投窗口内对手按下 C 或 D → 双方弹开，无伤害。 */
  private checkThrowTech(att: FighterState, def: FighterState): void {
    if (att.state !== 'throw' || def.state !== 'thrown') return;
    const m = this.move(att);
    if (!m?.throwData || m.throwData.techWindow === 0 || att.stateFrame > m.throwData.techWindow) return;
    const defPressed = def.bits & ~def.prevBits;
    if (!(defPressed & (Btn.C | Btn.D))) return;
    att.moveId = null;
    setState(att, 'throw_tech');
    setState(def, 'throw_tech');
    att.vx = -att.facing * px(3);
    def.vx = att.facing * px(3);
    this.pushEvent('tech', att, def, m.id, 0, false, false, def.x, def.y - px(70));
  }

  private tickThrow(att: FighterState, def: FighterState): void {
    const m = this.move(att);
    // 未放人时失去抓取对象属于中断；已结算伤害后则继续走完声明的收招。
    if (!m?.throwData || (!att.hasHit && def.state !== 'thrown')) {
      att.moveId = null;
      setState(att, 'idle');
      return;
    }
    const td = m.throwData;
    att.stateFrame++;

    if (att.stateFrame === td.releaseFrame) {
      if (td.switchSides) {
        def.x = att.x - att.facing * px(td.holdOffset);
        att.facing = att.facing === 1 ? -1 : 1;
      }
      const dir = att.facing;
      const damage = this.attackDamage(att, m.damage);
      def.comboHits = 1;
      def.comboDamage = damage;
      def.hp -= damage;
      def.justHit = true;
      def.airborne = true;
      def.vx = px(m.knockback.x) * dir;
      def.vy = px(m.knockback.y);
      def.stun = 1;
      def.wallBounce = false;
      def.hardKnockdown = true;
      def.juggle = 0;
      setState(def, 'hit_air');
      if (m.burn) this.applyBurn(def, m.burn);
      att.hasHit = true;
      this.gainMeter(att, (damage * 3) >> 3);
      this.gainMeter(def, damage >> 3);
      this.pushEvent('hit', att, def, m.id, damage, false, false, def.x, def.y - px(60));
    }

    if (att.stateFrame >= td.duration) {
      att.moveId = null;
      setState(att, 'idle');
    }
  }

  /** 指令投：attack 状态中带 throwData 的招式，抓取框碰到可抓对手的 pushbox 即抓住。 */
  private detectGrab(att: FighterState, def: FighterState): void {
    if (att.state !== 'attack' || att.hitstop > 0) return;
    const m = this.move(att);
    if (!m?.throwData || m.reflect) return;
    const boxes = this.hitboxes(att);
    if (boxes.length === 0 || !this.isThrowable(def)) return;
    const pb = this.pushbox(def);
    if (boxes.some((b) => overlaps(b, pb))) this.startThrow(att, def, m);
  }

  // ---------- 打击 ----------

  private detectStrike(att: FighterState, def: FighterState): StrikeContact | null {
    if (att.state !== 'attack' || att.hitstop > 0) return null;
    const m = this.move(att);
    if (!m || m.reflect || m.throwData) return null;
    const hbs = this.hitboxes(att);
    if (hbs.length === 0) return null;
    const hurts = this.hurtboxes(def, m.type === 'super' || m.type === 'ultimate');
    for (const hb of hbs) for (const hu of hurts) if (overlaps(hb, hu)) {
      const left = Math.max(hb.x, hu.x);
      const top = Math.max(hb.y, hu.y);
      const right = Math.min(hb.x + hb.w, hu.x + hu.w);
      const bottom = Math.min(hb.y + hb.h, hu.y + hu.h);
      return { move: m, x: left + ((right - left) >> 1), y: top + ((bottom - top) >> 1) };
    }
    return null;
  }

  private specFromMove(att: FighterState, m: MoveData): HitSpec {
    return {
      moveId: m.id,
      moveInstance: att.moveInstance,
      type: m.type,
      damage: m.damage,
      guard: m.guard,
      hitstun: m.hitstun,
      blockstun: m.blockstun,
      hitstop: m.hitstop,
      knockback: m.knockback,
      knockdown: !!m.knockdown,
      wallBounce: !!m.wallBounce,
      burn: m.burn ?? null,
      armorBreak: !!m.armorBreak,
      projectile: null,
    };
  }

  private canBlock(def: FighterState, guard: GuardType): boolean {
    if (guard === 'unblockable' || !this.isGuarding(def)) return false;
    const crouching = has(def.bits, Btn.Down);
    switch (guard) {
      case 'mid':
        return true;
      case 'high':
        return !crouching;
      case 'low':
        return crouching;
    }
  }

  /** 强化状态伤害倍率 */
  private attackDamage(att: FighterState, base: number): number {
    const inst = this.installDef(att);
    return inst ? Math.floor((base * inst.damageNum) / inst.damageDen) : base;
  }

  private applyBurn(def: FighterState, burn: BurnDef): void {
    def.burnFrames = burn.frames;
    def.burnDps = burn.dps;
  }

  /** 统一命中结算：招式或飞行道具 → 防御 / 霸体 / 命中。 */
  private applyHit(att: FighterState, def: FighterState, spec: HitSpec, contact?: StrikeContact): void {
    const proj = spec.projectile;
    let ex: number;
    let ey: number;
    if (proj) {
      const b = toWorldBox(proj.box, proj.x, proj.y, proj.facing);
      ex = b.x + (b.w >> 1);
      ey = b.y + (b.h >> 1);
    } else {
      const fd = this.currentFrame(att);
      att.hitMask |= 1 << (fd?.hitId ?? 1);
      ex = contact?.x ?? def.x;
      ey = contact?.y ?? def.y - px(60);
      // 命中或被防御后都开取消窗口
      att.hasHit = true;
      const m = this.move(att);
      att.cancelUntil = att.stateFrame + (m?.cancelWindow ?? DEFAULT_CANCEL_WINDOW);
    }
    const dir: 1 | -1 = proj ? (proj.vx >= 0 ? 1 : -1) : att.facing;

    if (this.canBlock(def, spec.guard)) {
      if (!proj) att.hitstop = spec.hitstop;
      def.hitstop = spec.hitstop;
      def.justBlocked = true;
      def.stun = spec.blockstun;
      def.vx = ((px(spec.knockback.x) * BLOCK_PUSHBACK_NUM) >> 3) * dir;
      def.groundPushbackFrom = proj ? null : att.player;
      setState(def, has(def.bits, Btn.Down) ? 'block_crouch' : 'block_stand');
      this.gainMeter(att, spec.damage >> 4);
      this.gainMeter(def, 4);
      this.pushEvent('block', att, def, spec.moveId, 0, false, !!proj, ex, ey);
      return;
    }

    // 霸体：扣血但不中断，每招一次
    if (!spec.armorBreak && this.hasArmor(def)) {
      const damage = this.attackDamage(att, spec.damage);
      def.armorBroken = true;
      def.hp -= damage;
      def.justHit = true;
      if (!proj) att.hitstop = spec.hitstop;
      def.hitstop = spec.hitstop >> 1;
      if (spec.burn) this.applyBurn(def, spec.burn);
      this.gainMeter(att, (damage * 3) >> 3);
      this.gainMeter(def, damage >> 3);
      this.pushEvent('armor', att, def, spec.moveId, damage, false, !!proj, ex, ey);
      return;
    }

    const defMove = this.move(def);
    const counter = def.state === 'attack' && !!defMove && inStartupOrActive(defMove, def.stateFrame);

    def.comboHits = IN_COMBO.has(def.state) ? def.comboHits + 1 : 1;
    let damage = scaledDamage(this.attackDamage(att, spec.damage), def.comboHits);
    if (counter) damage = (damage * 5) >> 2;
    def.comboDamage += damage;

    if (!proj) att.hitstop = spec.hitstop;
    def.hitstop = spec.hitstop;
    def.hp -= damage;
    def.justHit = true;
    def.moveId = null;
    this.gainMeter(att, (damage * 3) >> 3);
    this.gainMeter(def, damage >> 3);
    if (spec.burn) this.applyBurn(def, spec.burn);

    const hitstun = spec.hitstun + (counter ? COUNTER_BONUS_STUN : 0);
    const launch = spec.knockback.y !== 0 || def.airborne || spec.knockdown;
    if (launch) {
      if (!def.airborne) def.juggle = 1;
      else if (def.juggleInstance !== spec.moveInstance) def.juggle++;
      def.juggleInstance = spec.moveInstance;
      def.airborne = true;
      def.vx = px(spec.knockback.x) * dir;
      def.vy = spec.knockback.y !== 0 ? px(spec.knockback.y) : spec.knockdown ? px(-4) : px(-3);
      def.stun = hitstun;
      def.wallBounce = spec.wallBounce;
      def.hardKnockdown = spec.knockdown;
      setState(def, 'hit_air');
    } else {
      def.vx = px(spec.knockback.x) * dir;
      def.groundPushbackFrom = proj ? null : att.player;
      def.stun = hitstun;
      setState(def, this.stance(def) === 'crouch' ? 'hit_crouch' : 'hit_stand');
    }
    this.pushEvent('hit', att, def, spec.moveId, damage, counter, !!proj, ex, ey);
  }

  // ---------- 飞行道具 ----------

  private clearStepEvents(): void {
    this.hits.length = 0;
    this.projectileEndEvents.length = 0;
  }

  private endProjectile(p: ProjectileState, reason: ProjectileEndReason): void {
    this.projectileEndEvents.push({ id: p.id, kind: p.kind, owner: p.owner, moveId: p.moveId, x: p.x, y: p.y, frame: this.frame, reason });
  }

  private clearProjectiles(reason: 'round_end' | 'round_reset' | 'position_reset'): void {
    for (const p of this.projectiles) this.endProjectile(p, reason);
    this.projectiles = [];
  }

  private spawnProjectiles(f: FighterState, m: MoveData): void {
    if (!m.projectiles) return;
    for (const s of m.projectiles) {
      if (s.frame !== f.stateFrame) continue;
      this.projectiles.push({
        id: this.nextProjectileId++,
        owner: f.player,
        kind: s.kind,
        moveId: m.id,
        moveInstance: f.moveInstance,
        x: f.x + f.facing * px(s.x),
        y: f.y + px(s.y),
        vx: f.facing * px(s.vx),
        vy: px(s.vy),
        gravity: px(s.gravity ?? 0),
        facing: f.facing,
        ttl: s.ttl,
        box: s.box,
        durability: s.durability ?? 1,
        damage: s.damage ?? m.damage,
        guard: s.guard ?? m.guard,
        hitstun: s.hitstun ?? m.hitstun,
        blockstun: s.blockstun ?? m.blockstun,
        hitstop: m.hitstop,
        knockback: s.knockback ?? m.knockback,
        burn: m.burn ?? null,
        dieOnGround: !!s.dieOnGround,
        reflected: false,
      });
    }
  }

  projectileBox(p: ProjectileState): Box {
    return toWorldBox(p.box, p.x, p.y, p.facing);
  }

  private updateProjectiles(): void {
    if (this.projectiles.length === 0) return;
    const alive: ProjectileState[] = [];

    // 1. 移动
    for (const p of this.projectiles) {
      p.x += p.vx;
      p.vy += p.gravity;
      p.y += p.vy;
      p.ttl--;
      if (p.ttl <= 0) {
        this.endProjectile(p, 'timeout');
        continue;
      }
      if (p.dieOnGround && p.y >= GROUND_Y) {
        this.endProjectile(p, 'ground');
        continue;
      }
      if (p.x < STAGE_LEFT - px(80) || p.x > STAGE_RIGHT + px(80)) {
        this.endProjectile(p, 'out_of_bounds');
        continue;
      }
      alive.push(p);
    }

    // 2. 对消：不同持有者的道具相碰，各扣一点耐久
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]!;
        const b = alive[j]!;
        if (a.owner === b.owner || a.durability <= 0 || b.durability <= 0) continue;
        if (!overlaps(this.projectileBox(a), this.projectileBox(b))) continue;
        a.durability--;
        b.durability--;
        const att = this.fighters[a.owner];
        const def = this.fighters[b.owner];
        this.pushEvent('clash', att, def, a.moveId, 0, false, true, a.x, a.y);
      }
    }

    // 3. 弹反 → 命中
    const survivors: ProjectileState[] = [];
    for (const p of alive) {
      if (p.durability <= 0) {
        this.endProjectile(p, 'clash');
        continue;
      }
      const def = this.fighters[p.owner === 0 ? 1 : 0];
      const att = this.fighters[p.owner];
      const box = this.projectileBox(p);

      // 弹反：对手正处于弹反招式的 active 帧
      const defMove = this.move(def);
      if (def.state === 'attack' && defMove?.reflect && def.hitstop === 0) {
        const rb = (this.currentFrame(def)?.hitboxes ?? []).map((b) => toWorldBox(b, def.x, def.y, def.facing));
        if (rb.some((b) => overlaps(b, box))) {
          p.owner = def.player;
          p.vx = -p.vx;
          p.facing = p.facing === 1 ? -1 : 1;
          p.reflected = true;
          p.durability = Math.max(p.durability, 1);
          p.moveInstance = def.moveInstance;
          def.hasHit = true;
          def.cancelUntil = def.stateFrame + (defMove.cancelWindow ?? DEFAULT_CANCEL_WINDOW);
          this.gainMeter(def, 10);
          this.pushEvent('reflect', def, att, p.moveId, 0, false, true, p.x, p.y);
          survivors.push(p);
          continue;
        }
      }

      // 命中（打击定格中的对手也会被道具命中，与角色打击一致）
      const hurts = this.hurtboxes(def, false);
      if (hurts.some((h) => overlaps(h, box))) {
        const blocked = this.canBlock(def, p.guard);
        this.applyHit(att, def, {
          moveId: p.moveId,
          moveInstance: p.moveInstance,
          type: 'special',
          damage: p.damage,
          guard: p.guard,
          hitstun: p.hitstun,
          blockstun: p.blockstun,
          hitstop: p.hitstop,
          knockback: p.knockback,
          knockdown: false,
          wallBounce: false,
          burn: p.burn,
          armorBreak: false,
          projectile: p,
        });
        p.durability--;
        if (p.durability <= 0) {
          this.endProjectile(p, blocked ? 'block' : 'hit');
          continue;
        }
      }
      survivors.push(p);
    }
    this.projectiles = survivors;
  }

  private gainMeter(f: FighterState, amount: number): void {
    f.meter = Math.min(MAX_METER, f.meter + amount);
  }

  private pushEvent(
    kind: HitKind,
    att: FighterState,
    def: FighterState,
    moveId: string,
    damage: number,
    counter: boolean,
    projectile: boolean,
    x: number,
    y: number,
  ): void {
    this.hits.push({
      frame: this.frame,
      kind,
      attacker: att.player,
      defender: def.player,
      moveId,
      damage,
      counter,
      comboHits: def.comboHits,
      comboDamage: def.comboDamage,
      projectile,
      x,
      y,
    });
  }

  /** 回合结束后继续推进非 ko 状态（只处理计时，不接受输入）。 */
  private advanceAfterRound(f: FighterState): void {
    if (f.hitstop > 0) {
      f.hitstop--;
      return;
    }
    switch (f.state) {
      case 'attack':
      case 'throw': {
        const m = this.move(f);
        f.stateFrame++;
        const ended = f.state === 'throw' ? !m?.throwData || f.stateFrame >= m.throwData.duration : !m || !frameAt(m, f.stateFrame);
        if (ended) {
          f.moveId = null;
          setState(f, f.airborne ? 'jump_neutral' : 'idle');
        }
        break;
      }
      case 'knockdown':
        f.stateFrame++;
        if (f.stateFrame >= KNOCKDOWN_FRAMES) setState(f, 'getup');
        break;
      case 'getup':
        f.stateFrame++;
        if (f.stateFrame >= GETUP_FRAMES) setState(f, 'idle');
        break;
      case 'idle':
        break;
      default:
        f.stateFrame++;
        if (f.stun > 0 && --f.stun === 0 && !f.airborne && f.state !== 'thrown') setState(f, 'idle');
    }
  }

  // ---------- 物理 ----------

  private physics(f: FighterState): void {
    if (f.state === 'thrown') return;
    f.x += f.vx;

    // 地面击退碰到墙后，未能移动的部分反推打击者。不能仅钳制受击者坐标，
    // 否则同一距离的轻拳可以在墙角无限取消；空中撞墙和远程道具维持各自规则。
    if (!f.airborne && f.groundPushbackFrom !== null &&
        (f.state === 'hit_stand' || f.state === 'hit_crouch' || f.state === 'block_stand' || f.state === 'block_crouch')) {
      const halfW = (f.def.pushboxStand[2] * SUBPIXEL) >> 1;
      const overflow = f.vx > 0
        ? Math.max(0, f.x - (STAGE_RIGHT - halfW))
        : Math.min(0, f.x - (STAGE_LEFT + halfW));
      const blocked = Math.sign(overflow) * Math.min(Math.abs(overflow), Math.abs(f.vx));
      f.x -= blocked;
      this.fighters[f.groundPushbackFrom].x -= blocked;
    }

    if (f.airborne) {
      f.vy = Math.min(f.vy + GRAVITY, MAX_FALL_SPEED);
      f.y += f.vy;
      if (f.y >= GROUND_Y) {
        f.y = GROUND_Y;
        f.vy = 0;
        f.vx = 0;
        f.airborne = false;
        f.wallBounce = false;
        f.juggle = 0;
        if (f.hp <= 0) setState(f, 'ko');
        else if (f.state === 'hit_air') {
          if (!f.hardKnockdown && (f.bits & ANY_ATTACK)) setState(f, 'getup');
          else setState(f, 'knockdown');
        } else {
          f.moveId = null;
          setState(f, 'landing');
        }
      }
      return;
    }

    switch (f.state) {
      case 'hit_stand':
      case 'hit_crouch':
      case 'block_stand':
      case 'block_crouch':
      case 'throw_tech':
      case 'ko':
        if (f.vx > 0) f.vx = Math.max(0, f.vx - GROUND_FRICTION);
        else if (f.vx < 0) f.vx = Math.min(0, f.vx + GROUND_FRICTION);
        break;
      default:
        break;
    }
  }

  private separatePushboxes(a: FighterState, b: FighterState): void {
    if (a.state === 'thrown' || b.state === 'thrown') return;
    const boxA = this.pushbox(a);
    const boxB = this.pushbox(b);
    if (!overlaps(boxA, boxB)) return;
    const ox = overlapX(boxA, boxB);
    if (isRolling(a) !== isRolling(b)) return;
    if (a.airborne !== b.airborne) {
      const air = a.airborne ? a : b;
      const ground = a.airborne ? b : a;
      air.x += air.x <= ground.x ? -ox : ox;
      return;
    }
    const half = ox >> 1;
    if (a.x <= b.x) {
      a.x -= half;
      b.x += ox - half;
    } else {
      a.x += half;
      b.x -= ox - half;
    }
  }

  private clampToStage(a: FighterState, b: FighterState): void {
    for (const f of [a, b]) {
      const halfW = (f.def.pushboxStand[2] * SUBPIXEL) >> 1;
      let wall = 0;
      if (f.x - halfW < STAGE_LEFT) {
        f.x = STAGE_LEFT + halfW;
        wall = -1;
      } else if (f.x + halfW > STAGE_RIGHT) {
        f.x = STAGE_RIGHT - halfW;
        wall = 1;
      }
      if (wall !== 0 && f.state === 'hit_air' && f.wallBounce && Math.sign(f.vx) === wall) {
        f.wallBounce = false;
        f.vx = -((f.vx * WALL_BOUNCE_NUM) >> 3);
        f.vy = Math.min(f.vy, px(-5));
      } else if (wall !== 0 && f.airborne && Math.sign(f.vx) === wall) {
        f.vx = 0;
      }
    }
    const dist = Math.abs(a.x - b.x);
    if (dist > MAX_SEPARATION) {
      const over = dist - MAX_SEPARATION;
      if (a.x < b.x) {
        a.x += over >> 1;
        b.x -= over - (over >> 1);
      } else {
        a.x -= over >> 1;
        b.x += over - (over >> 1);
      }
    }
  }
}

// ---------- 纯函数 ----------

function createFighter(def: FighterDef, player: PlayerIndex, x: number, facing: 1 | -1): FighterState {
  return {
    def,
    player,
    x,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    facing,
    state: 'idle',
    stateFrame: 0,
    hp: def.maxHp,
    meter: 0,
    airborne: false,
    moveId: null,
    hitMask: 0,
    hasHit: false,
    cancelUntil: 0,
    hitstop: 0,
    stun: 0,
    bits: 0,
    prevBits: 0,
    history: [],
    buffered: null,
    bufferTtl: 0,
    groundPushbackFrom: null,
    comboHits: 0,
    comboDamage: 0,
    juggle: 0,
    juggleInstance: -1,
    moveInstance: 0,
    hardKnockdown: false,
    justHit: false,
    justBlocked: false,
    wallBounce: false,
    hopPending: false,
    jumpDirection: 0,
    armorBroken: false,
    install: null,
    installFrames: 0,
    fatigueFrames: 0,
    burnFrames: 0,
    burnDps: 0,
    burnTick: 0,
  };
}

function setState(f: FighterState, s: StateId): void {
  if (f.state !== s) {
    f.state = s;
    f.stateFrame = 0;
  } else {
    f.stateFrame++;
  }
}

function isRolling(f: FighterState): boolean {
  return f.state === 'roll_fwd' || f.state === 'roll_back';
}

/** 地面可操作 / 落地状态自动面向对手；空中、出招中、受击中、翻滚中保持面向。 */
function updateFacing(a: FighterState, b: FighterState): void {
  const canTurn = (f: FighterState) => !f.airborne && (OPERABLE.has(f.state) || f.state === 'landing');
  if (canTurn(a)) a.facing = a.x <= b.x ? 1 : -1;
  if (canTurn(b)) b.facing = b.x <= a.x ? 1 : -1;
}
