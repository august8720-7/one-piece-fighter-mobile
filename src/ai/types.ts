import type { MotionId } from '@core/index';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** 难度参数：全部是"人的缺陷"的量化，AI 只走正常输入，不作弊 */
export interface DifficultyParams {
  /** 两次决策之间的最少帧数（反应延迟） */
  reaction: number;
  /** 看到对手出招时选择防御的概率（%） */
  blockChance: number;
  /** 搓招成功率（%），失败退化为普通技 */
  motionSuccess: number;
  /** 命中确认后继续连段的概率（%） */
  comboWill: number;
  /** 中立时选择进攻类行动的概率（%） */
  aggression: number;
  /** 拆投反应概率（%） */
  techChance: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { reaction: 24, blockChance: 20, motionSuccess: 50, comboWill: 20, aggression: 40, techChance: 10 },
  normal: { reaction: 12, blockChance: 55, motionSuccess: 80, comboWill: 60, aggression: 60, techChance: 40 },
  hard: { reaction: 4, blockChance: 90, motionSuccess: 100, comboWill: 95, aggression: 75, techChance: 80 },
};

export type Btn4 = 'A' | 'B' | 'C' | 'D';

/** AI 行动：由 Cpu 编译成多帧输入脚本 */
export type AiAction =
  | { kind: 'walk'; dir: 1 | -1; frames: number }
  | { kind: 'run'; frames: number }
  | { kind: 'jump'; dir: -1 | 0 | 1; attack?: Btn4; delay?: number }
  | { kind: 'normal'; stance: 'stand' | 'crouch'; button: Btn4; forward?: boolean }
  | { kind: 'special'; motion: MotionId; button: 'P' | 'K'; minMeter?: number; cooldown?: number }
  | { kind: 'throw' }
  | { kind: 'block'; frames: number; low?: boolean }
  | { kind: 'roll'; dir: 1 | -1 }
  | { kind: 'backdash' }
  | { kind: 'wait'; frames: number };

export interface AiOption {
  weight: number;
  action: AiAction;
}

/** 角色策略表 */
export interface AiProfile {
  /** 距离分区（像素） */
  closeRange: number;
  midRange: number;
  far: AiOption[];
  mid: AiOption[];
  close: AiOption[];
  /** 对手空中接近时 */
  antiAir: AiOption[];
  /** 有飞行道具飞来时 */
  projectileAnswer: AiOption[];
  /** 对手倒地时的起身压制 */
  okizeme: AiOption[];
  /** 命中确认后的连段续招（按当前招式 id 匹配；'*' 任意） */
  followups: { from: readonly string[]; options: AiOption[] }[];
  /** 验收用指定连段：from 命中且仍在取消窗口时固定取消到 action */
  confirmCombo?: { from: string; action: AiAction };
  /** 确反（对手收招时）用的选项；省略则用 close */
  punish?: AiOption[];
  /** 对手起手霸体招时的破霸体应对 */
  armorBreak?: AiAction;
}
