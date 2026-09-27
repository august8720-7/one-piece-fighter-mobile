import type { BurnDef, InstallDef } from './types';

/** 灼烧：8 / 秒 × 3 秒（原 10，平衡自动对局后下调），不叠加只刷新（PLAN 4.5） */
export const BURN: BurnDef = { dps: 8, frames: 180 };

/** 二档：10 秒，移速 +30%，特殊技启动 −3 帧、伤害 +15%，结束后疲劳 1.5 秒移速 −20%（PLAN 4.4） */
export const GEAR_SECOND: InstallDef = {
  id: 'gear2',
  duration: 600,
  speedNum: 13,
  speedDen: 10,
  specialStartupSkip: 3,
  damageNum: 23,
  damageDen: 20,
  fatigueFrames: 90,
  fatigueSpeedNum: 4,
  fatigueSpeedDen: 5,
};

/** 超必杀 1 格，终极技 3 格 */
export const SUPER_COST = 100;
export const ULTIMATE_COST = 300;
/** 熔岩化闪避消耗 1/3 格 */
export const DODGE_COST = 33;
