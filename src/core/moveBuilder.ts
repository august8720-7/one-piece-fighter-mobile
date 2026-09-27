import {
  Btn,
  type AttackButton,
  type BoxPx,
  type BurnDef,
  type FrameData,
  type GuardType,
  type InstallDef,
  type Knockback,
  type MotionId,
  type MoveData,
  type MoveType,
  type ProjectileSpawn,
  type Stance,
  type ThrowData,
} from './types';

/** 一段攻击：启动若干帧后进入 active 帧 */
export interface Segment {
  startup: number;
  active: number;
  hitbox: BoxPx;
}

export interface AttackSpec {
  id: string;
  name: string;
  type?: MoveType;
  stance: Stance;
  /** 单键或 P / K 掩码 */
  button: number;
  plus?: AttackButton;
  motion?: MotionId;
  /** 特殊普通技的方向要求（6C 等） */
  direction?: 4 | 6;
  /** 需要按住下（j.2D） */
  down?: boolean;
  meterCost?: number;
  invuln?: number;
  /** 多段：依次 startup → active；最后跟 recovery */
  segments: readonly Segment[];
  recovery: number;
  /** 每段伤害 */
  damage: number;
  guard?: GuardType;
  hitstun?: number;
  blockstun?: number;
  hitstop?: number;
  knockback?: Partial<Knockback>;
  knockdown?: boolean;
  wallBounce?: boolean;
  cancelWindow?: number;
  chain?: readonly string[];
  /** 出招期间受击框（可选，默认姿态框） */
  hurtboxes?: readonly BoxPx[];
  /** 启动期水平位移（像素 / 帧） */
  stepX?: number;
  /** 各段 active 期间的水平位移（像素 / 帧），用于突进技 */
  activeStepX?: number;
  /** 启动与 active 帧带霸体 */
  armor?: boolean;
  /** 只有前 N 帧启动带霸体（之后可被打断，给对手反应窗口）。省略 = 整个启动 + active */
  armorFrames?: number;
  armorBreak?: boolean;
  burn?: BurnDef;
  projectiles?: readonly ProjectileSpawn[];
  reflect?: boolean;
  /** 指令投：hitbox 为抓取框 */
  throwData?: Omit<ThrowData, 'switchSides' | 'range'>;
}

/** 通用攻击构造：按段生成 startup / active 帧，最后追加 recovery。 */
export function attack(s: AttackSpec): MoveData {
  const base: Pick<FrameData, 'hurtboxes'> = s.hurtboxes ? { hurtboxes: s.hurtboxes } : {};
  const armor = s.armor ? { armor: true } : {};
  const frames: FrameData[] = [];
  s.segments.forEach((seg, i) => {
    const limited = i === 0 && s.armor && s.armorFrames !== undefined && s.armorFrames < seg.startup;
    if (limited) {
      // 霸体只覆盖启动前段：拆成两帧，后段无霸体
      frames.push({ sprite: i * 2, duration: s.armorFrames!, ...base, armor: true, ...(s.stepX ? { velocity: { x: s.stepX } } : {}) });
      frames.push({ sprite: i * 2, duration: seg.startup - s.armorFrames!, ...base, ...(s.stepX ? { velocity: { x: s.stepX } } : {}) });
    } else {
      frames.push({
        sprite: i * 2,
        duration: seg.startup,
        ...base,
        ...armor,
        ...(i === 0 && s.stepX ? { velocity: { x: s.stepX } } : {}),
      });
    }
    frames.push({
      sprite: i * 2 + 1,
      duration: seg.active,
      ...base,
      ...(limited ? {} : armor),
      hitboxes: [seg.hitbox],
      hitId: i + 1,
      ...(s.activeStepX ? { velocity: { x: s.activeStepX } } : {}),
    });
  });
  frames.push({ sprite: s.segments.length * 2, duration: s.recovery, ...base });

  const type: MoveType = s.type ?? (s.plus ? 'blowback' : s.motion ? 'special' : s.direction || s.down ? 'command_normal' : 'normal');
  const light = s.button === Btn.A || s.button === Btn.B;
  return {
    id: s.id,
    name: s.name,
    type,
    input: {
      stance: s.stance,
      button: s.button,
      ...(s.plus ? { plus: s.plus } : {}),
      ...(s.motion ? { motion: s.motion } : {}),
      ...(s.direction ? { direction: s.direction } : {}),
      ...(s.down ? { down: true } : {}),
    },
    damage: s.damage,
    guard: s.guard ?? (s.stance === 'air' ? 'high' : 'mid'),
    hitstun: s.hitstun ?? (light ? 14 : 20),
    blockstun: s.blockstun ?? (light ? 10 : 15),
    hitstop: s.hitstop ?? (light ? 7 : 11),
    knockback: { x: s.knockback?.x ?? (light ? 3 : 5), y: s.knockback?.y ?? 0 },
    ...(s.knockdown ? { knockdown: true } : {}),
    ...(s.wallBounce ? { wallBounce: true } : {}),
    ...(s.meterCost !== undefined ? { meterCost: s.meterCost } : {}),
    ...(s.invuln !== undefined ? { invuln: s.invuln } : {}),
    ...(s.cancelWindow !== undefined ? { cancelWindow: s.cancelWindow } : {}),
    ...(s.chain ? { chain: s.chain } : {}),
    ...(s.armorBreak ? { armorBreak: true } : {}),
    ...(s.burn ? { burn: s.burn } : {}),
    ...(s.projectiles ? { projectiles: s.projectiles } : {}),
    ...(s.reflect ? { reflect: true } : {}),
    ...(s.throwData ? { throwData: { ...s.throwData, range: 0, switchSides: false } } : {}),
    frames,
  };
}

export interface NormalSpec extends Omit<AttackSpec, 'segments' | 'button' | 'type' | 'motion' | 'meterCost' | 'invuln'> {
  button: AttackButton;
  startup: number;
  active: number;
  hitbox: BoxPx;
}

/** 单段普通技 / 特殊普通技 / 吹飞的简写。 */
export function normal(s: NormalSpec): MoveData {
  const { startup, active, hitbox, ...rest } = s;
  return attack({ ...rest, segments: [{ startup, active, hitbox }] });
}

export interface UtilitySpec {
  id: string;
  name: string;
  type?: MoveType;
  stance?: Stance;
  button: number;
  motion: MotionId;
  meterCost?: number;
  /** 启动帧（含无敌 / 演出）+ 收招帧 */
  startup: number;
  recovery: number;
  /** 启动前段用 sprite 0，余下启动用 sprite 1，收招用 sprite 2。不设则只有 0/1 两帧。 */
  cast?: number;
  invuln?: number;
  dodge?: boolean;
  install?: InstallDef;
  projectiles?: readonly ProjectileSpawn[];
  /** 飞行道具的伤害等参数 */
  damage?: number;
  guard?: GuardType;
  hitstun?: number;
  blockstun?: number;
  hitstop?: number;
  knockback?: Partial<Knockback>;
  knockdown?: boolean;
  burn?: BurnDef;
  hurtboxes?: readonly BoxPx[];
}

/** 无攻击框的招式：强化状态、闪避、纯飞行道具发射。 */
export function utility(s: UtilitySpec): MoveData {
  const base: Pick<FrameData, 'hurtboxes'> = s.hurtboxes ? { hurtboxes: s.hurtboxes } : {};
  return {
    id: s.id,
    name: s.name,
    type: s.type ?? 'special',
    input: { stance: s.stance ?? 'stand', button: s.button, motion: s.motion },
    damage: s.damage ?? 0,
    guard: s.guard ?? 'mid',
    hitstun: s.hitstun ?? 20,
    blockstun: s.blockstun ?? 15,
    hitstop: s.hitstop ?? 10,
    knockback: { x: s.knockback?.x ?? 5, y: s.knockback?.y ?? 0 },
    ...(s.knockdown ? { knockdown: true } : {}),
    ...(s.meterCost !== undefined ? { meterCost: s.meterCost } : {}),
    ...(s.invuln !== undefined ? { invuln: s.invuln } : {}),
    ...(s.dodge ? { dodge: true } : {}),
    ...(s.install ? { install: s.install } : {}),
    ...(s.projectiles ? { projectiles: s.projectiles } : {}),
    ...(s.burn ? { burn: s.burn } : {}),
    frames: s.cast && s.cast > 0 && s.cast < s.startup
      ? [
          { sprite: 0, duration: s.cast, ...base },
          { sprite: 1, duration: s.startup - s.cast, ...base },
          { sprite: 2, duration: s.recovery, ...base },
        ]
      : [
          { sprite: 0, duration: s.startup, ...base },
          { sprite: 1, duration: s.recovery, ...base },
        ],
  };
}

export interface ThrowSpec {
  id: string;
  name: string;
  /** 4 后投 / 6 前投 */
  direction: 4 | 6;
  button: AttackButton;
  damage: number;
  /** 整个投技演出总帧数 */
  total: number;
  knockback?: Partial<Knockback>;
  burn?: BurnDef;
  throwData: Omit<ThrowData, 'switchSides' | 'duration'>;
}

/** 生成普通投技。抓住后对手被锁定，releaseFrame 时结算伤害并击飞。 */
export function throwMove(s: ThrowSpec): MoveData {
  return {
    id: s.id,
    name: s.name,
    type: 'throw',
    input: { stance: 'stand', button: s.button, direction: s.direction },
    damage: s.damage,
    guard: 'unblockable',
    hitstun: 0,
    blockstun: 0,
    hitstop: 0,
    knockback: { x: s.knockback?.x ?? 6, y: s.knockback?.y ?? -7 },
    knockdown: true,
    ...(s.burn ? { burn: s.burn } : {}),
    throwData: { ...s.throwData, duration: s.total, switchSides: s.direction === 4 },
    frames: [{ sprite: 0, duration: s.total }],
  };
}

export function totalFrames(m: MoveData): number {
  return m.frames.reduce((n, f) => n + f.duration, 0);
}

/** 根据已持续帧数定位当前 FrameData；越界返回 null（招式结束）。 */
export function frameAt(m: MoveData, stateFrame: number): FrameData | null {
  let acc = 0;
  for (const f of m.frames) {
    if (stateFrame < acc + f.duration) return f;
    acc += f.duration;
  }
  return null;
}

/** 第一个 active 帧的起始帧号；无攻击帧返回 -1。 */
export function firstActiveFrame(m: MoveData): number {
  let acc = 0;
  for (const f of m.frames) {
    if (f.hitboxes) return acc;
    acc += f.duration;
  }
  return -1;
}

/** 是否仍处于启动或 active 阶段（之后还有攻击帧）——反击判定用。 */
export function inStartupOrActive(m: MoveData, stateFrame: number): boolean {
  let acc = 0;
  let lastActiveEnd = 0;
  for (const f of m.frames) {
    acc += f.duration;
    if (f.hitboxes) lastActiveEnd = acc;
  }
  return stateFrame < lastActiveEnd;
}
