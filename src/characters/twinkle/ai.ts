import type { AiProfile } from '../../ai/types';

/** 星星人 AI：保持中距离，以直线、斜上与固定落点星弹迫使对手选择路线。 */
export const twinkleAi: AiProfile = {
  closeRange: 72,
  midRange: 205,
  far: [
    { weight: 5, action: { kind: 'special', motion: '236', button: 'P', cooldown: 105 } },
    { weight: 2, action: { kind: 'special', motion: '22', button: 'P', cooldown: 150 } },
    { weight: 3, action: { kind: 'walk', dir: 1, frames: 10 } },
    { weight: 2, action: { kind: 'wait', frames: 9 } },
    { weight: 1, action: { kind: 'special', motion: '214214', button: 'P', minMeter: 100, cooldown: 240 } },
  ],
  mid: [
    { weight: 4, action: { kind: 'special', motion: '236', button: 'P', cooldown: 105 } },
    { weight: 2, action: { kind: 'special', motion: '22', button: 'P', cooldown: 150 } },
    { weight: 2, action: { kind: 'normal', stance: 'stand', button: 'C' } },
    { weight: 2, action: { kind: 'walk', dir: -1, frames: 8 } },
    { weight: 2, action: { kind: 'block', frames: 15, low: true } },
    { weight: 1, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100, cooldown: 210 } },
  ],
  close: [
    { weight: 4, action: { kind: 'normal', stance: 'stand', button: 'A' } },
    { weight: 3, action: { kind: 'special', motion: '214', button: 'P', cooldown: 80 } },
    { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'B' } },
    { weight: 2, action: { kind: 'throw' } },
    { weight: 2, action: { kind: 'backdash' } },
    { weight: 1, action: { kind: 'special', motion: '22', button: 'K', minMeter: 33, cooldown: 150 } },
  ],
  antiAir: [
    { weight: 5, action: { kind: 'special', motion: '623', button: 'P', cooldown: 90 } },
    { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'C' } },
    { weight: 1, action: { kind: 'block', frames: 18 } },
  ],
  projectileAnswer: [
    { weight: 5, action: { kind: 'special', motion: '214', button: 'K', cooldown: 90 } },
    { weight: 3, action: { kind: 'block', frames: 22 } },
    { weight: 1, action: { kind: 'jump', dir: 0 } },
  ],
  okizeme: [
    { weight: 4, action: { kind: 'special', motion: '22', button: 'P', cooldown: 150 } },
    { weight: 2, action: { kind: 'walk', dir: -1, frames: 8 } },
    { weight: 2, action: { kind: 'wait', frames: 10 } },
  ],
  punish: [
    { weight: 4, action: { kind: 'special', motion: '214', button: 'P', cooldown: 80 } },
    { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } },
    { weight: 1, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } },
  ],
  confirmCombo: { from: 'st_a', action: { kind: 'normal', stance: 'stand', button: 'C' } },
  followups: [
    {
      from: ['st_a', 'cr_a'],
      options: [
        { weight: 4, action: { kind: 'normal', stance: 'stand', button: 'C' } },
        { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'D' } },
      ],
    },
    {
      from: ['st_c', 'st_d', 'f_c'],
      options: [
        { weight: 4, action: { kind: 'special', motion: '214', button: 'P' } },
        { weight: 2, action: { kind: 'special', motion: '236', button: 'P' } },
      ],
    },
    {
      from: ['sp_starlight_push'],
      options: [
        { weight: 3, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } },
        { weight: 1, action: { kind: 'special', motion: '236236', button: 'K', minMeter: 300 } },
      ],
    },
  ],
};
