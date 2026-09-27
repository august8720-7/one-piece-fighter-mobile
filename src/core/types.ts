/** 判定框 [x, y, w, h]，原点角色脚下中心，面朝右，单位像素（数据文件）。y 向上为负。 */
export type BoxPx = readonly [x: number, y: number, w: number, h: number];

/** 运行时判定框，单位子像素，已镜像与平移到世界坐标。 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Facing = 1 | -1;
export type PlayerIndex = 0 | 1;
export type ControlMode = 'classic' | 'simple';
export type ControlModes = readonly [ControlMode, ControlMode];

/** 按键位图。方向按绝对方向存储，镜像由 core 处理。 */
export enum Btn {
  Up = 1 << 0,
  Down = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  A = 1 << 4, // 轻拳
  B = 1 << 5, // 轻脚
  C = 1 << 6, // 重拳
  D = 1 << 7, // 重脚
  Start = 1 << 8,
  Skill1 = 1 << 9,
  Skill2 = 1 << 10,
  Skill3 = 1 << 11,
  Skill4 = 1 << 12,
  Skill5 = 1 << 13,
  Skill6 = 1 << 14,
  Skill7 = 1 << 15,
  Skill8 = 1 << 16,
  Skill9 = 1 << 17,
}

export const SKILL_BUTTONS = [Btn.Skill1, Btn.Skill2, Btn.Skill3, Btn.Skill4, Btn.Skill5, Btn.Skill6, Btn.Skill7, Btn.Skill8, Btn.Skill9] as const;
export const ANY_SKILL = SKILL_BUTTONS.reduce((mask, bit) => mask | bit, 0);
export type SkillReason = 'ready' | 'meter' | 'air' | 'recovery' | 'cancel' | 'phase' | 'missing';
export interface SkillAvailability { moveId: string; available: boolean; reason: SkillReason }
export interface SkillFeedback { slot: number; frame: number; reason: SkillReason }

export const ATTACK_BUTTONS = [Btn.A, Btn.B, Btn.C, Btn.D] as const;
export type AttackButton = (typeof ATTACK_BUTTONS)[number];
/** 任一拳 / 任一脚 */
export const P = Btn.A | Btn.C;
export const K = Btn.B | Btn.D;
export const ANY_ATTACK = Btn.A | Btn.B | Btn.C | Btn.D;

/** 一帧两名玩家的输入。 */
export interface InputFrame {
  readonly p1: number;
  readonly p2: number;
}

/** 姿态：决定默认受击框与可用招式。 */
export type Stance = 'stand' | 'crouch' | 'air';

/**
 * 防御属性（KOF 口径）：
 * mid 站蹲皆可防；high（中段 / overhead）只能站防；low 只能蹲防。
 */
export type GuardType = 'high' | 'mid' | 'low' | 'unblockable';

/** 摇杆指令（数字记法，面朝右） */
export type MotionId = '236' | '214' | '623' | '22' | '236236' | '214214';

/** 单帧数据。 */
export interface FrameData {
  /** 精灵帧索引（M0～M2 占位渲染不用） */
  sprite: number;
  /** 持续逻辑帧数 */
  duration: number;
  /** 受击框；省略则用姿态默认框 */
  hurtboxes?: readonly BoxPx[];
  /** 攻击框；有则为 active 帧 */
  hitboxes?: readonly BoxPx[];
  /** 多段攻击的段号（1 起）；同一段只命中一次。省略视为 1 */
  hitId?: number;
  /** 本帧位移（像素 / 帧），面朝右为正 */
  velocity?: { x?: number; y?: number };
  /** 霸体帧：被打击时扣血但不中断（每招一次） */
  armor?: boolean;
}

export interface Knockback {
  /** 地面击退水平速度（像素 / 帧），远离攻击者为正 */
  x: number;
  /** 空中命中 / 浮空的竖直速度（像素 / 帧），负为向上；0 表示不浮空 */
  y: number;
}

export interface MoveInput {
  stance: Stance;
  /** 按键位掩码：可为单键，或 P（A|C）/ K（B|D） */
  button: number;
  /** 双键同按（如 C+D 吹飞）。A+B 保留给翻滚。 */
  plus?: AttackButton;
  /** 需要同时按住的相对方向：4 后 / 6 前（投技、特殊普通技） */
  direction?: 4 | 6;
  /** 需要按住下（空中 ↓+D 等） */
  down?: boolean;
  /** 摇杆指令（特殊技 / 超必杀） */
  motion?: MotionId;
}

export interface ThrowData {
  /** 可抓距离（像素，双方原点水平距离）。指令投用抓取框代替，此值可为 0 */
  range: number;
  /** 拆投窗口（帧，自抓住起）；0 = 不可拆（指令投） */
  techWindow: number;
  /** 伤害与击飞生效帧（自抓住起） */
  releaseFrame: number;
  /** 抓住演出总帧数 */
  duration: number;
  /** 抓住时对手相对攻击者的水平偏移（像素，面朝方向为正） */
  holdOffset: number;
  /** Explicit opt-in: keep both held roots inside the stage without shortening holdOffset. */
  keepHoldOffsetAtWall?: boolean;
  /** 4+按键 时把对手甩到身后 */
  switchSides: boolean;
}

/** 飞行道具生成（挂在招式上，frame 为招式内的帧号） */
export interface ProjectileSpawn {
  frame: number;
  /** 渲染种类标识 */
  kind: string;
  /** 生成位置（像素，相对角色原点，面朝右） */
  x: number;
  y: number;
  /** 速度（像素 / 帧，面朝方向为正） */
  vx: number;
  vy: number;
  /** 重力（像素 / 帧²），省略 0 */
  gravity?: number;
  /** 存活帧数 */
  ttl: number;
  /** 判定框（相对道具位置，面朝右） */
  box: BoxPx;
  /** 可承受的对消次数（默认 1） */
  durability?: number;
  /** 覆盖招式的伤害 / 硬直 / 击退（省略继承） */
  damage?: number;
  hitstun?: number;
  blockstun?: number;
  knockback?: Knockback;
  guard?: GuardType;
  /** 落地即消失 */
  dieOnGround?: boolean;
}

/** 持续伤害（灼烧） */
export interface BurnDef {
  /** 每秒伤害 */
  dps: number;
  /** 持续帧数 */
  frames: number;
}

/** 强化状态（二档） */
export interface InstallDef {
  id: string;
  duration: number;
  /** 移速倍率（分子 / 分母，整数运算） */
  speedNum: number;
  speedDen: number;
  /** 特殊技启动减少的帧数 */
  specialStartupSkip: number;
  /** 伤害倍率 */
  damageNum: number;
  damageDen: number;
  /** 结束后疲劳帧数与移速倍率 */
  fatigueFrames: number;
  fatigueSpeedNum: number;
  fatigueSpeedDen: number;
}

export interface ProjectileState {
  id: number;
  owner: PlayerIndex;
  kind: string;
  moveId: string;
  moveInstance: number;
  x: number; // 子像素
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  facing: Facing;
  ttl: number;
  box: BoxPx;
  durability: number;
  damage: number;
  guard: GuardType;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockback: Knockback;
  burn: BurnDef | null;
  dieOnGround: boolean;
  /** 被弹反后为 true（渲染变色） */
  reflected: boolean;
}

export type ProjectileEndReason =
  | 'hit' | 'block' | 'clash' | 'ground' | 'timeout' | 'out_of_bounds'
  | 'round_end' | 'round_reset' | 'position_reset';

/** 道具真正离场时的值快照；不是每一次接触事件。坐标保持逻辑子像素单位。 */
export interface ProjectileEndEvent {
  id: number;
  kind: string;
  /** 结束时的持有者，包含弹反后的归属。 */
  owner: PlayerIndex;
  moveId: string;
  x: number;
  y: number;
  /** 与 HitEvent 相同：执行本次 step 或直接 reset 时的逻辑帧号。 */
  frame: number;
  /** hit 包含霸体接触；耐久未耗尽时不产生结束事件。 */
  reason: ProjectileEndReason;
}

export type MoveType = 'normal' | 'command_normal' | 'blowback' | 'special' | 'super' | 'ultimate' | 'throw';

/** 取消等级：只能取消进更高等级（或 chain 列表中的同级） */
export const MOVE_RANK: Record<MoveType, number> = {
  normal: 0,
  command_normal: 0,
  blowback: 0,
  throw: 0,
  special: 1,
  super: 2,
  ultimate: 3,
};

/** 招式定义。 */
export interface MoveData {
  id: string;
  name: string;
  type: MoveType;
  input: MoveInput;
  /** 每段伤害 */
  damage: number;
  guard: GuardType;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  knockback: Knockback;
  /** 命中后直接硬倒（不可受身） */
  knockdown?: boolean;
  /** 击飞撞墙后反弹（吹飞攻击） */
  wallBounce?: boolean;
  /** 消耗气（超必杀 100 / 终极 300） */
  meterCost?: number;
  /** 启动无敌帧（超必杀） */
  invuln?: number;
  /** 命中 / 被防御后可取消的窗口（帧，自命中起）。省略用默认 */
  cancelWindow?: number;
  /** 同级链式目标（普通技 → 普通技），move id 列表 */
  chain?: readonly string[];
  /** 投技参数（type === 'throw' 为普通投；带 frames/hitboxes 的为指令投，hitbox 即抓取框） */
  throwData?: ThrowData;
  /** 无视对手霸体 */
  armorBreak?: boolean;
  /** 命中附加灼烧 */
  burn?: BurnDef;
  /** 飞行道具 */
  projectiles?: readonly ProjectileSpawn[];
  /** 弹反：hitbox 只对飞行道具生效，把它们反弹给对手 */
  reflect?: boolean;
  /** 强化状态 */
  install?: InstallDef;
  /** 闪避：invuln 帧内对打击与投技全无敌 */
  dodge?: boolean;
  frames: readonly FrameData[];
}

/** 移动参数（子像素 / 帧，帧数） */
export interface MovementDef {
  walkFwdSpeed: number;
  walkBackSpeed: number;
  jumpVelocityY: number;
  jumpVelocityX: number;
  hopVelocityY: number;
  runSpeed: number;
  backdashSpeed: number;
  backdashFrames: number;
  backdashInvuln: number;
  rollSpeed: number;
  rollFrames: number;
  rollInvuln: number;
}

/** 角色基础参数（每角色一份，来自 characters/<id>/）。 */
export interface FighterDef {
  id: string;
  name: string;
  maxHp: number;
  movement: MovementDef;
  pushboxStand: BoxPx;
  pushboxCrouch: BoxPx;
  pushboxAir: BoxPx;
  hurtboxStand: readonly BoxPx[];
  hurtboxCrouch: readonly BoxPx[];
  hurtboxAir: readonly BoxPx[];
  moves: readonly MoveData[];
  /** 一键技能槽位，顺序固定，不依赖招式表排序。 */
  skillSlots?: readonly string[];
  /** 占位渲染颜色 */
  color: number;
  /** 胜利台词（演出用，随机取一句） */
  quotes?: readonly string[];
  /** 选人界面一句话定位 */
  tagline?: string;
}

export type StateId =
  | 'idle'
  | 'walk_fwd'
  | 'walk_back'
  | 'crouch'
  | 'prejump'
  | 'jump_neutral'
  | 'jump_fwd'
  | 'jump_back'
  | 'landing'
  | 'dash'
  | 'backdash'
  | 'roll_fwd'
  | 'roll_back'
  | 'attack'
  | 'block_stand'
  | 'block_crouch'
  | 'hit_stand'
  | 'hit_crouch'
  | 'hit_air'
  | 'knockdown'
  | 'getup'
  | 'throw'
  | 'thrown'
  | 'throw_tech'
  | 'ko';

export const INPUT_HISTORY = 32;
export const MAX_METER = 300;
export const METER_STOCK = 100;
export const MAX_JUGGLE = 3;

/** 攻击键按下时的完整意图；定格只延后执行，不重读之后的方向或搓招历史。 */
export interface AttackIntent {
  bits: number;
  pressed: number;
  facing: Facing;
  motions: readonly MotionId[];
  /** 仅简易输入声明；经典输入不改变既有意图结构。 */
  skillSlot?: number;
}

export interface FighterState {
  def: FighterDef;
  player: PlayerIndex;
  x: number; // 子像素
  y: number; // 子像素，0 为地面，向上为负
  vx: number;
  vy: number;
  facing: Facing;
  state: StateId;
  stateFrame: number;
  hp: number;
  meter: number;
  airborne: boolean;
  /** 当前招式（attack / throw 时有效） */
  moveId: string | null;
  /** 本次出招已命中的段号位掩码（bit hitId） */
  hitMask: number;
  /** 本次出招是否已命中或被防御（用于取消判定） */
  hasHit: boolean;
  /** 可取消的截止 stateFrame */
  cancelUntil: number;
  /** 打击定格剩余帧 */
  hitstop: number;
  /** 受击 / 防御硬直剩余帧 */
  stun: number;
  /** 本帧输入位图 */
  bits: number;
  /** 上一帧输入位图（边沿检测） */
  prevBits: number;
  /** 最近 INPUT_HISTORY 帧的相对数字方向（1-9），末尾最新 */
  history: number[];
  /** 最近一次尚未消费的攻击输入；新输入替换旧输入，不拼接不同时刻的按键。 */
  buffered: AttackIntent | null;
  bufferTtl: number;
  /** 地面近身打击的击退来源；墙挡住的位移返还给攻击者，飞行道具不反推远处施放者。 */
  groundPushbackFrom: PlayerIndex | null;
  /** 作为被击方：当前连段段数 / 累计伤害 */
  comboHits: number;
  comboDamage: number;
  /** 空中连续受击次数（按招式实例计，同一招的多段只算一次） */
  juggle: number;
  /** 最后一次使 juggle 增加的攻击方招式实例号 */
  juggleInstance: number;
  /** 出招实例计数（每次 startMove 递增，用于区分同一招的多段与新招） */
  moveInstance: number;
  /** 本次倒地是否硬倒（不可受身） */
  hardKnockdown: boolean;
  /** 上一帧被击中（渲染闪白用） */
  justHit: boolean;
  /** 上一帧成功防御（渲染用） */
  justBlocked: boolean;
  /** 空中受击撞墙可反弹（一次性） */
  wallBounce: boolean;
  /** 小跳标记（prejump 结束时决定） */
  hopPending: boolean;
  /** 进入预跳时锁存的绝对水平方向，松开斜上后仍保留小跳方向。 */
  jumpDirection: -1 | 0 | 1;
  /** 本次出招的霸体是否已被消耗 */
  armorBroken: boolean;
  /** 强化状态 id 与剩余帧 */
  install: string | null;
  installFrames: number;
  /** 强化结束后的疲劳剩余帧 */
  fatigueFrames: number;
  /** 灼烧剩余帧 / 每秒伤害 / 结算计数 */
  burnFrames: number;
  burnDps: number;
  burnTick: number;
}

export type Phase = 'intro' | 'fight' | 'round_end' | 'match_end';

export interface WorldState {
  frame: number;
  fighters: readonly [FighterState, FighterState];
  projectiles: readonly ProjectileState[];
  cameraX: number;
  phase: Phase;
  phaseFrame: number;
  round: number;
  wins: readonly [number, number];
  /** 剩余帧；-1 表示无限 */
  timer: number;
  /** 本回合胜者；null = 平局或未结束 */
  roundWinner: PlayerIndex | null;
  /** 兼容：回合是否已结束 */
  roundOver: boolean;
  winner: PlayerIndex | null;
}

export type HitKind = 'hit' | 'block' | 'throw' | 'tech' | 'armor' | 'reflect' | 'clash' | 'burn';

/** 一次命中 / 防御 / 投技等事件，供渲染层做特效 / 音效。 */
export interface HitEvent {
  frame: number;
  kind: HitKind;
  attacker: PlayerIndex;
  defender: PlayerIndex;
  moveId: string;
  damage: number;
  counter: boolean;
  comboHits: number;
  comboDamage: number;
  /** 由飞行道具造成 */
  projectile: boolean;
  x: number; // 子像素
  y: number;
}
