import type { AiProfile } from '../../ai/types';

/** 赤犬 AI：压制 → 惩罚接近。远距离飞行道具，中距离等对手进来吃大喷火，近身指令投 / 下扫。 */
export const akainuAi: AiProfile = {
  closeRange: 75,
  midRange: 200,
  far: [
    { weight: 3, action: { kind: 'special', motion: '214', button: 'P', cooldown: 210 } }, // 犬噛红莲（限频：约 3.5 秒一发）
    { weight: 2, action: { kind: 'special', motion: '214', button: 'K', cooldown: 300 } }, // 流星火山
    { weight: 3, action: { kind: 'walk', dir: 1, frames: 16 } },
    { weight: 3, action: { kind: 'wait', frames: 12 } },
    { weight: 1, action: { kind: 'special', motion: '214214', button: 'K', minMeter: 100 } }, // 流星火山·雨
  ],
  mid: [
    { weight: 1, action: { kind: 'special', motion: '236', button: 'P', cooldown: 240 } }, // 大喷火（霸体，限频）
    { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } }, // 熔岩拳
    { weight: 2, action: { kind: 'normal', stance: 'stand', button: 'D' } },
    { weight: 1, action: { kind: 'special', motion: '214', button: 'P', cooldown: 210 } },
    { weight: 3, action: { kind: 'wait', frames: 10 } },
    { weight: 2, action: { kind: 'walk', dir: 1, frames: 10 } },
    { weight: 1, action: { kind: 'block', frames: 14, low: true } },
  ],
  close: [
    { weight: 2, action: { kind: 'special', motion: '623', button: 'P', cooldown: 180 } }, // 冥狗
    { weight: 3, action: { kind: 'normal', stance: 'crouch', button: 'D' } }, // 熔岩下扫
    { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'A' } },
    { weight: 2, action: { kind: 'throw' } },
    { weight: 1, action: { kind: 'normal', stance: 'stand', button: 'C', forward: true } }, // 熔岩重锤（霸体）
    { weight: 1, action: { kind: 'special', motion: '22', button: 'P', minMeter: 33 } }, // 熔岩化脱困
  ],
  antiAir: [
    { weight: 4, action: { kind: 'normal', stance: 'crouch', button: 'C' } }, // 熔岩上勾
    { weight: 2, action: { kind: 'special', motion: '236', button: 'P' } },
    { weight: 1, action: { kind: 'block', frames: 20 } },
  ],
  projectileAnswer: [
    { weight: 3, action: { kind: 'block', frames: 24 } },
    { weight: 2, action: { kind: 'special', motion: '214', button: 'P' } }, // 对消
    { weight: 1, action: { kind: 'jump', dir: 0 } },
  ],
  okizeme: [
    { weight: 3, action: { kind: 'special', motion: '214', button: 'K', cooldown: 240 } }, // 流星火山压起身
    { weight: 2, action: { kind: 'walk', dir: 1, frames: 8 } },
    { weight: 2, action: { kind: 'wait', frames: 10 } },
  ],
  punish: [
    { weight: 4, action: { kind: 'normal', stance: 'stand', button: 'C' } },
    { weight: 3, action: { kind: 'special', motion: '623', button: 'P' } }, // 冥狗
    { weight: 2, action: { kind: 'special', motion: '236', button: 'P', cooldown: 120 } },
  ],
  confirmCombo: { from: 'st_a', action: { kind: 'normal', stance: 'stand', button: 'C' } },
  followups: [
    {
      from: ['st_a', 'cr_a'],
      options: [
        { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } },
        { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'D' } },
      ],
    },
    {
      from: ['st_b'],
      options: [{ weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } }],
    },
    {
      from: ['st_c', 'st_d', 'cr_c', 'f_c'],
      options: [
        { weight: 4, action: { kind: 'special', motion: '236', button: 'P' } }, // 大喷火
        { weight: 3, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } }, // 大喷火·连
      ],
    },
    {
      from: ['sp_daifunka', 'sp_ground_split'],
      options: [
        { weight: 3, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } },
        { weight: 1, action: { kind: 'special', motion: '236236', button: 'K', minMeter: 300 } }, // 冥狗·终焉
      ],
    },
  ],
};
