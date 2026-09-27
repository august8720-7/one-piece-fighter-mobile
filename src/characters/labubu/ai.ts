import type { AiProfile } from '../../ai/types';

/** LABUBU AI：主动贴近，在短打、下段和抱摔间做选择，落空后保留防守退路。 */
export const labubuAi: AiProfile = {
  closeRange: 68,
  midRange: 145,
  far: [
    { weight: 5, action: { kind: 'run', frames: 16 } },
    { weight: 3, action: { kind: 'special', motion: '236', button: 'P', cooldown: 90 } },
    { weight: 2, action: { kind: 'jump', dir: 1, attack: 'D', delay: 14 } },
    { weight: 1, action: { kind: 'special', motion: '22', button: 'K', cooldown: 540 } },
  ],
  mid: [
    { weight: 3, action: { kind: 'special', motion: '236', button: 'P', cooldown: 90 } },
    { weight: 2, action: { kind: 'special', motion: '236', button: 'K', cooldown: 120 } },
    { weight: 3, action: { kind: 'walk', dir: 1, frames: 9 } },
    { weight: 2, action: { kind: 'normal', stance: 'stand', button: 'D' } },
    { weight: 2, action: { kind: 'block', frames: 12, low: true } },
    { weight: 1, action: { kind: 'roll', dir: 1 } },
  ],
  close: [
    { weight: 4, action: { kind: 'normal', stance: 'stand', button: 'A' } },
    { weight: 3, action: { kind: 'normal', stance: 'crouch', button: 'B' } },
    { weight: 2, action: { kind: 'special', motion: '214', button: 'P', cooldown: 75 } },
    { weight: 2, action: { kind: 'special', motion: '623', button: 'K', cooldown: 150 } },
    { weight: 2, action: { kind: 'throw' } },
    { weight: 1, action: { kind: 'backdash' } },
  ],
  antiAir: [
    { weight: 5, action: { kind: 'special', motion: '623', button: 'P', cooldown: 80 } },
    { weight: 2, action: { kind: 'normal', stance: 'crouch', button: 'C' } },
    { weight: 1, action: { kind: 'block', frames: 18 } },
  ],
  projectileAnswer: [
    { weight: 3, action: { kind: 'roll', dir: 1 } },
    { weight: 3, action: { kind: 'block', frames: 20 } },
    { weight: 2, action: { kind: 'jump', dir: 1 } },
  ],
  okizeme: [
    { weight: 3, action: { kind: 'special', motion: '236', button: 'K', cooldown: 120 } },
    { weight: 2, action: { kind: 'walk', dir: 1, frames: 7 } },
    { weight: 2, action: { kind: 'wait', frames: 8 } },
  ],
  punish: [
    { weight: 4, action: { kind: 'special', motion: '214', button: 'P', cooldown: 75 } },
    { weight: 3, action: { kind: 'normal', stance: 'stand', button: 'C' } },
    { weight: 1, action: { kind: 'special', motion: '214214', button: 'P', minMeter: 100 } },
  ],
  armorBreak: { kind: 'special', motion: '214214', button: 'P', minMeter: 100 },
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
        { weight: 4, action: { kind: 'special', motion: '236', button: 'P' } },
        { weight: 2, action: { kind: 'special', motion: '214', button: 'P' } },
      ],
    },
    {
      from: ['sp_pounce_rush', 'sp_prank_flurry'],
      options: [
        { weight: 3, action: { kind: 'special', motion: '236236', button: 'P', minMeter: 100 } },
        { weight: 1, action: { kind: 'special', motion: '236236', button: 'K', minMeter: 300 } },
      ],
    },
  ],
};
