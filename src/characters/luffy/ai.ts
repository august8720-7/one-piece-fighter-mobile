import type { AiProfile } from '../../ai/types';

/** 路飞 AI：接近 → 连段。远距离用火箭 / 奔跑接近，中距离用长手牵制，近身连段与投技混合。 */
export const luffyAi: AiProfile = {
  closeRange: 70,
  midRange: 190,
  far: [
    { weight: 4, action: { kind: 'run', frames: 18 } },
    { weight: 2, action: { kind: 'special', motion: '236', button: 'K' } }, // 橡胶火箭
    { weight: 2, action: { kind: 'jump', dir: 1, attack: 'D', delay: 16 } },
    { weight: 1, action: { kind: 'walk', dir: 1, frames: 20 } },
    { weight: 1, action: { kind: 'special', motion: '22', button: 'K', minMeter: 100 } }, // 二档
  ],
  mid: [
    { weight: 2, action: { kind: 'normal', stance: 'stand', button: 'C' } }, // 橡胶手枪
    { weight: 1, action: { kind: 'normal', stance: 'stand', button: 'D' } }, // 橡胶印章
    { weight: 1, action: { kind: 'special', motion: '236', button: 'P', cooldown: 90 } }, // 机关枪
    { weight: 2, action: { kind: 'walk', dir: 1, frames: 10 } },
    { weight: 3, action: { kind: 'block', frames: 16, low: true } }, // 等对手先动，确反交给 punish
    { weight: 2, action: { kind: 'wait', frames: 8 } },
    { weight: 1, action: { kind: 'jump', dir: 1, attack: 'D', delay: 14 } },
    { weight: 1, action: { kind: 'roll', dir: 1 } },
  ],
  close: [
    { weight: 4, action: { kind: 'normal', stance: 'stand', button: 'A' } },
    { weight: 3, action: { kind: 'normal', stance: 'crouch', button: 'B' } },
    { weight: 2, action: { kind: 'throw' } },
    { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'D' } }, // 橡胶鞭
    { weight: 1, action: { kind: 'normal', stance: 'stand', button: 'C', forward: true } }, // 橡胶钟
    { weight: 1, action: { kind: 'backdash' } },
  ],
  antiAir: [
    { weight: 4, action: { kind: 'normal', stance: 'crouch', button: 'C' } },
    { weight: 1, action: { kind: 'special', motion: '623', button: 'P' } },
    { weight: 1, action: { kind: 'block', frames: 20 } },
  ],
  projectileAnswer: [
    { weight: 4, action: { kind: 'special', motion: '22', button: 'P' } }, // 橡胶气球
    { weight: 3, action: { kind: 'block', frames: 28, low: false } },
    { weight: 2, action: { kind: 'jump', dir: 1 } },
    { weight: 1, action: { kind: 'roll', dir: 1 } },
  ],
  okizeme: [
    { weight: 3, action: { kind: 'walk', dir: 1, frames: 10 } },
    { weight: 2, action: { kind: 'wait', frames: 8 } },
    { weight: 1, action: { kind: 'normal', stance: 'crouch', button: 'B' } },
  ],
  punish: [
    { weight: 4, action: { kind: 'normal', stance: 'stand', button: 'C' } }, // 橡胶手枪确反
    { weight: 3, action: { kind: 'special', motion: '236', button: 'P' } }, // 机关枪
    { weight: 2, action: { kind: 'special', motion: '623', button: 'P' } }, // 回旋弹
    { weight: 2, action: { kind: 'throw' } },
  ],
  armorBreak: { kind: 'special', motion: '623', button: 'P' },
  confirmCombo: { from: 'st_a', action: { kind: 'normal', stance: 'stand', button: 'C' } },
  followups: [
    {
      from: ['st_a', 'cr_a'],
      options: [
        { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } },
        { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'D' } },
        { weight: 1, action: { kind: 'normal', stance: 'stand', button: 'A' } },
      ],
    },
    {
      from: ['st_b', 'cr_b'],
      options: [
        { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } },
        { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'D' } },
      ],
    },
    {
      from: ['st_c', 'st_d', 'cr_c', 'f_c'],
      options: [
        { weight: 4, action: { kind: 'special', motion: '236', button: 'P' } }, // 机关枪
        { weight: 2, action: { kind: 'special', motion: '214', button: 'P' } }, // 火箭炮
        { weight: 3, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } }, // 暴风雨
      ],
    },
    {
      from: ['sp_gatling', 'sp_bazooka', 'sp_rifle'],
      options: [
        { weight: 3, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } },
        { weight: 1, action: { kind: 'special', motion: '236236', button: 'K', minMeter: 300 } }, // 火拳铳
      ],
    },
  ],
};
