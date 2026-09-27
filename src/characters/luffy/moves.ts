import { Btn, K, P, attack, balance, normal, throwMove, utility, type MoveData } from '@core/index';

const { GEAR_SECOND, SUPER_COST, ULTIMATE_COST } = balance;

/**
 * 路飞招式表（PLAN 4.4）。特点：伸长手脚 → 射程长、伤害偏低、启动快、连段多；二档强化。
 * 数值为初始值，用训练模式实测后调整。
 */
export const luffyMoves: readonly MoveData[] = [
  // ======== 终极技（3 气）：火拳铳 ========
  attack({
    id: 'ult_red_hawk', name: '火拳铳', type: 'ultimate', stance: 'stand', button: K, motion: '236236',
    meterCost: ULTIMATE_COST, invuln: 14, armorBreak: true,
    segments: [
      { startup: 16, active: 4, hitbox: [16, -100, 60, 40] },
      { startup: 6, active: 8, hitbox: [20, -120, 200, 90] },
    ],
    recovery: 40, damage: 225,
    hitstun: 40, blockstun: 26, hitstop: 18,
    knockback: { x: 14, y: -8 }, wallBounce: true, knockdown: true, stepX: 3,
  }),

  // ======== 超必杀（1 气）========
  attack({
    id: 'sp_storm', name: '橡胶暴风雨', type: 'super', stance: 'stand', button: P, motion: '236236',
    meterCost: SUPER_COST, invuln: 8,
    segments: [
      { startup: 10, active: 3, hitbox: [16, -100, 130, 40] },
      { startup: 3, active: 3, hitbox: [16, -70, 134, 40] },
      { startup: 3, active: 3, hitbox: [16, -100, 138, 40] },
      { startup: 3, active: 3, hitbox: [16, -60, 142, 40] },
      { startup: 3, active: 3, hitbox: [16, -100, 146, 40] },
      { startup: 3, active: 3, hitbox: [16, -80, 150, 40] },
      { startup: 4, active: 4, hitbox: [16, -110, 160, 70] },
    ],
    recovery: 30, damage: 40,
    hitstun: 22, blockstun: 14, hitstop: 8,
    knockback: { x: 2, y: -3 }, stepX: 2,
  }),
  attack({
    id: 'sp_gigant_pistol', name: '三档·巨人手枪', type: 'super', stance: 'stand', button: P, motion: '214214',
    meterCost: SUPER_COST, armor: true, armorBreak: true,
    segments: [{ startup: 26, active: 6, hitbox: [24, -130, 260, 110] }],
    recovery: 44, damage: 300,
    hitstun: 40, blockstun: 30, hitstop: 18,
    knockback: { x: 16, y: -7 }, wallBounce: true,
  }),

  // ======== 特殊技 ========
  attack({
    id: 'sp_gatling', name: '橡胶机关枪', stance: 'stand', button: P, motion: '236',
    segments: [
      { startup: 8, active: 3, hitbox: [16, -96, 130, 26] },
      { startup: 3, active: 3, hitbox: [16, -76, 136, 26] },
      { startup: 3, active: 3, hitbox: [16, -90, 142, 26] },
      { startup: 3, active: 3, hitbox: [16, -66, 148, 26] },
      { startup: 3, active: 3, hitbox: [16, -84, 154, 30] },
    ],
    recovery: 22, damage: 28,
    hitstun: 18, blockstun: 12, hitstop: 7,
    knockback: { x: 2 },
  }),
  attack({
    id: 'sp_bazooka', name: '橡胶火箭炮', stance: 'stand', button: P, motion: '214',
    segments: [{ startup: 14, active: 4, hitbox: [20, -104, 150, 48] }],
    recovery: 22, damage: 130,
    hitstun: 26, blockstun: 18, hitstop: 12,
    knockback: { x: 12, y: -4 }, wallBounce: true, stepX: 1.5,
  }),
  attack({
    id: 'sp_rifle', name: '橡胶回旋弹', stance: 'stand', button: P, motion: '623', armorBreak: true,
    segments: [{ startup: 12, active: 5, hitbox: [18, -100, 150, 36] }],
    recovery: 24, damage: 140,
    hitstun: 28, blockstun: 18, hitstop: 13,
    knockback: { x: 8, y: -6 },
  }),
  attack({
    id: 'sp_rocket', name: '橡胶火箭', stance: 'stand', button: K, motion: '236',
    segments: [{ startup: 6, active: 12, hitbox: [10, -90, 40, 60] }],
    recovery: 16, damage: 80,
    hitstun: 24, blockstun: 16, hitstop: 10,
    knockback: { x: 6, y: -5 }, activeStepX: 9,
  }),
  attack({
    id: 'sp_balloon', name: '橡胶气球', stance: 'stand', button: P, motion: '22', reflect: true,
    segments: [{ startup: 4, active: 22, hitbox: [-30, -120, 90, 120] }],
    recovery: 12, damage: 0,
    hurtboxes: [[-24, -110, 48, 110]],
  }),
  utility({
    id: 'sp_gear2', name: '二档', button: K, motion: '22',
    meterCost: SUPER_COST, startup: 18, recovery: 6, install: GEAR_SECOND,
  }),

  // ======== 吹飞 C+D：橡胶镰刀 ========
  normal({
    id: 'cd', name: '橡胶镰刀', stance: 'stand', button: Btn.C, plus: Btn.D,
    startup: 16, active: 5, recovery: 24,
    hitbox: [12, -84, 120, 30], damage: 90,
    hitstun: 30, blockstun: 20, hitstop: 14,
    knockback: { x: 11, y: -5 }, wallBounce: true,
  }),
  normal({
    id: 'j_cd', name: '橡胶镰刀（空）', stance: 'air', button: Btn.C, plus: Btn.D,
    startup: 10, active: 6, recovery: 12,
    hitbox: [10, -70, 60, 34], damage: 80,
    hitstun: 26, blockstun: 16, hitstop: 12,
    knockback: { x: 9, y: -4 },
  }),

  // ======== 投技：橡胶大槌 ========
  throwMove({
    id: 'throw_fwd', name: '橡胶大槌', direction: 6, button: Btn.C, damage: 110, total: 44,
    knockback: { x: 6, y: -8 },
    throwData: { range: 46, techWindow: 8, releaseFrame: 22, holdOffset: 34 },
  }),
  throwMove({
    id: 'throw_back', name: '橡胶大槌（后）', direction: 4, button: Btn.C, damage: 110, total: 44,
    knockback: { x: 6, y: -8 },
    throwData: { range: 46, techWindow: 8, releaseFrame: 22, holdOffset: 34 },
  }),

  // ======== 特殊普通技 ========
  normal({
    id: 'f_c', name: '橡胶钟', stance: 'stand', button: Btn.C, direction: 6,
    startup: 14, active: 4, recovery: 18,
    hitbox: [14, -104, 50, 30], damage: 75, guard: 'high',
    knockback: { x: 4 },
  }),
  normal({
    id: 'j_2d', name: '橡胶战斧', stance: 'air', button: Btn.D, down: true,
    startup: 9, active: 6, recovery: 10,
    hitbox: [0, -60, 50, 60], damage: 90, guard: 'high',
    knockback: { x: 4, y: 3 },
  }),

  // ======== 站立普通技 ========
  normal({
    id: 'st_a', name: '轻拳', stance: 'stand', button: Btn.A,
    startup: 4, active: 3, recovery: 7,
    hitbox: [10, -78, 34, 14], damage: 34,
    chain: ['st_a', 'st_b', 'st_c', 'st_d', 'cr_c', 'cr_d', 'f_c'],
  }),
  normal({
    id: 'st_b', name: '轻脚', stance: 'stand', button: Btn.B,
    startup: 5, active: 3, recovery: 9,
    hitbox: [12, -44, 38, 16], damage: 40,
    chain: ['st_c', 'st_d', 'cr_c', 'cr_d', 'f_c'],
  }),
  normal({
    id: 'st_c', name: '橡胶手枪', stance: 'stand', button: Btn.C,
    startup: 9, active: 4, recovery: 16,
    hitbox: [14, -80, 140, 20], damage: 80,
    hurtboxes: [[-14, -88, 28, 88], [14, -84, 110, 22]],
    knockback: { x: 6 },
  }),
  normal({
    id: 'st_d', name: '橡胶印章', stance: 'stand', button: Btn.D,
    startup: 10, active: 4, recovery: 18,
    hitbox: [12, -52, 54, 24], damage: 90,
    knockback: { x: 7 },
  }),

  // ======== 蹲普通技 ========
  normal({
    id: 'cr_a', name: '蹲轻拳', stance: 'crouch', button: Btn.A,
    startup: 4, active: 3, recovery: 6,
    hitbox: [10, -50, 32, 14], damage: 28,
    chain: ['cr_a', 'cr_b', 'cr_c', 'cr_d', 'st_c', 'st_d'],
  }),
  normal({
    id: 'cr_b', name: '蹲轻脚', stance: 'crouch', button: Btn.B,
    startup: 5, active: 3, recovery: 9,
    hitbox: [10, -14, 40, 14], damage: 30, guard: 'low',
    chain: ['cr_c', 'cr_d', 'st_c', 'st_d'],
  }),
  normal({
    id: 'cr_c', name: '蹲重拳', stance: 'crouch', button: Btn.C,
    startup: 7, active: 4, recovery: 15,
    hitbox: [6, -110, 30, 60], damage: 70,
    knockback: { x: 3, y: -7 },
  }),
  normal({
    id: 'cr_d', name: '橡胶鞭', stance: 'crouch', button: Btn.D,
    startup: 9, active: 4, recovery: 20,
    hitbox: [10, -16, 100, 16], damage: 80, guard: 'low',
    knockdown: true, knockback: { x: 5 },
  }),

  // ======== 空中普通技 ========
  normal({
    id: 'j_a', name: '空轻拳', stance: 'air', button: Btn.A,
    startup: 4, active: 6, recovery: 8,
    hitbox: [8, -70, 30, 16], damage: 30,
  }),
  normal({
    id: 'j_b', name: '空轻脚', stance: 'air', button: Btn.B,
    startup: 5, active: 6, recovery: 8,
    hitbox: [10, -50, 36, 18], damage: 35,
  }),
  normal({
    id: 'j_c', name: '空重拳', stance: 'air', button: Btn.C,
    startup: 7, active: 5, recovery: 10,
    hitbox: [8, -76, 60, 20], damage: 65,
    knockback: { x: 5 },
  }),
  normal({
    id: 'j_d', name: '橡胶印章（空）', stance: 'air', button: Btn.D,
    startup: 8, active: 5, recovery: 10,
    hitbox: [10, -40, 60, 30], damage: 85,
    knockback: { x: 6 },
  }),
];
