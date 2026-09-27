import { Btn, K, P, attack, balance, normal, throwMove, utility, type MoveData, type ProjectileSpawn } from '@core/index';

const { BURN, SUPER_COST, ULTIMATE_COST, DODGE_COST } = balance;

/** 流星火山：从天而降的熔岩拳 */
const meteor = (frame: number, x: number): ProjectileSpawn => ({
  frame,
  kind: 'meteor',
  x,
  y: -188,
  vx: 0,
  vy: 5.2,
  gravity: 0.28,
  ttl: 80,
  box: [-20, -36, 40, 42],
  dieOnGround: true,
  knockback: { x: 4, y: -7 },
});

/**
 * 赤犬招式表（PLAN 4.5）。特点：启动慢、伤害高、击退大、霸体、灼烧、飞行道具压制、指令投。
 * 数值为初始值，用训练模式实测后调整。
 */
export const akainuMoves: readonly MoveData[] = [
  // ======== 终极技（3 气）：冥狗·终焉（指令投演出）========
  attack({
    id: 'ult_meigou_end', name: '冥狗·终焉', type: 'ultimate', stance: 'stand', button: K, motion: '236236',
    meterCost: ULTIMATE_COST, invuln: 12, burn: BURN,
    segments: [{ startup: 12, active: 6, hitbox: [10, -100, 70, 100] }],
    recovery: 30, damage: 480,
    knockback: { x: 10, y: -10 },
    throwData: { techWindow: 0, releaseFrame: 70, duration: 90, holdOffset: 36 },
  }),

  // ======== 超必杀（1 气）========
  attack({
    id: 'sp_daifunka_ren', name: '大喷火·连', type: 'super', stance: 'stand', button: P, motion: '236236',
    meterCost: SUPER_COST, invuln: 10, burn: BURN,
    segments: [
      { startup: 14, active: 5, hitbox: [20, -110, 150, 70] },
      { startup: 10, active: 5, hitbox: [24, -100, 160, 70] },
      { startup: 10, active: 6, hitbox: [28, -120, 170, 90] },
    ],
    recovery: 34, damage: 105,
    hitstun: 30, blockstun: 22, hitstop: 14,
    knockback: { x: 6, y: -5 }, stepX: 1.5,
  }),
  utility({
    id: 'sp_meteor_rain', name: '流星火山·雨', type: 'super', button: K, motion: '214214',
    meterCost: SUPER_COST, invuln: 10, startup: 30, recovery: 30, cast: 12,
    damage: 45, guard: 'high', hitstun: 26, blockstun: 18, hitstop: 10, burn: BURN,
    projectiles: [
      meteor(20, 40), meteor(24, 90), meteor(28, 140), meteor(32, 190),
      meteor(36, 240), meteor(40, 290), meteor(44, 340), meteor(48, 390),
    ],
  }),

  // ======== 特殊技 ========
  attack({
    id: 'sp_daifunka', name: '大喷火', stance: 'stand', button: P, motion: '236', armor: true, armorFrames: 11, burn: BURN,
    segments: [{ startup: 20, active: 5, hitbox: [20, -110, 160, 70] }],
    recovery: 32, damage: 130,
    hitstun: 30, blockstun: 22, hitstop: 14,
    knockback: { x: 13, y: -6 }, wallBounce: true, stepX: 1,
  }),
  utility({
    id: 'sp_inugami', name: '犬噛红莲', button: P, motion: '214',
    startup: 16, recovery: 26,
    damage: 60, guard: 'mid', hitstun: 20, blockstun: 16, hitstop: 9,
    knockback: { x: 6, y: 0 },
    projectiles: [{ frame: 14, kind: 'dog', x: 40, y: -50, vx: 4.5, vy: 0, ttl: 140, box: [-20, -26, 40, 40] }],
  }),
  utility({
    id: 'sp_meteor', name: '流星火山', button: K, motion: '214',
    startup: 24, recovery: 20, cast: 10,
    damage: 50, guard: 'high', hitstun: 24, blockstun: 16, hitstop: 10, burn: BURN,
    projectiles: [meteor(18, 70), meteor(22, 130), meteor(26, 190)],
  }),
  attack({
    id: 'sp_meigou', name: '冥狗', stance: 'stand', button: P, motion: '623', burn: BURN,
    segments: [{ startup: 8, active: 4, hitbox: [10, -100, 56, 100] }],
    recovery: 26, damage: 140,
    knockback: { x: 7, y: -7 },
    throwData: { techWindow: 0, releaseFrame: 26, duration: 40, holdOffset: 34 },
  }),
  attack({
    id: 'sp_ground_split', name: '熔岩地裂', stance: 'stand', button: K, motion: '22',
    segments: [{ startup: 16, active: 6, hitbox: [40, -70, 60, 70] }],
    recovery: 24, damage: 100, guard: 'low',
    hitstun: 26, blockstun: 18, hitstop: 12,
    knockback: { x: 4, y: -9 },
  }),
  utility({
    id: 'sp_magma_body', name: '熔岩化', button: P, motion: '22',
    meterCost: DODGE_COST, startup: 20, recovery: 14, invuln: 20, dodge: true,
  }),

  // ======== 吹飞 C+D：熔岩双掌 ========
  normal({
    id: 'cd', name: '熔岩双掌', stance: 'stand', button: Btn.C, plus: Btn.D,
    startup: 18, active: 5, recovery: 26,
    hitbox: [14, -90, 120, 40], damage: 100,
    hitstun: 32, blockstun: 22, hitstop: 15,
    knockback: { x: 12, y: -5 }, wallBounce: true, stepX: 1.2,
  }),
  normal({
    id: 'j_cd', name: '熔岩双掌（空）', stance: 'air', button: Btn.C, plus: Btn.D,
    startup: 12, active: 6, recovery: 14,
    hitbox: [10, -76, 52, 40], damage: 90,
    hitstun: 28, blockstun: 18, hitstop: 13,
    knockback: { x: 10, y: -4 },
  }),

  // ======== 投技：熔岩抓摔 ========
  throwMove({
    id: 'throw_fwd', name: '熔岩抓摔', direction: 6, button: Btn.C, damage: 120, total: 48, burn: BURN,
    knockback: { x: 5, y: -7 },
    throwData: { range: 50, techWindow: 8, releaseFrame: 24, holdOffset: 38 },
  }),
  throwMove({
    id: 'throw_back', name: '熔岩抓摔（后）', direction: 4, button: Btn.C, damage: 120, total: 48, burn: BURN,
    knockback: { x: 5, y: -7 },
    throwData: { range: 50, techWindow: 8, releaseFrame: 24, holdOffset: 38 },
  }),

  // ======== 特殊普通技 ========
  normal({
    id: 'f_c', name: '熔岩重锤', stance: 'stand', button: Btn.C, direction: 6, armor: true, armorFrames: 9,
    startup: 16, active: 4, recovery: 20,
    hitbox: [14, -110, 120, 40], damage: 95, guard: 'high',
    knockback: { x: 6 },
  }),

  // ======== 站立普通技 ========
  normal({
    id: 'st_a', name: '轻拳', stance: 'stand', button: Btn.A,
    startup: 5, active: 3, recovery: 9,
    hitbox: [12, -86, 36, 16], damage: 38,
    chain: ['st_c', 'st_d', 'cr_d', 'f_c'],
  }),
  normal({
    id: 'st_b', name: '轻脚', stance: 'stand', button: Btn.B,
    startup: 6, active: 3, recovery: 11,
    hitbox: [14, -48, 40, 18], damage: 42,
    chain: ['st_c', 'st_d', 'f_c'],
  }),
  normal({
    id: 'st_c', name: '熔岩拳', stance: 'stand', button: Btn.C,
    startup: 12, active: 4, recovery: 20,
    hitbox: [16, -92, 150, 36], damage: 80,
    knockback: { x: 9 }, stepX: 1.5,
  }),
  normal({
    id: 'st_d', name: '熔岩踢', stance: 'stand', button: Btn.D,
    startup: 13, active: 5, recovery: 22,
    hitbox: [16, -70, 66, 34], damage: 80,
    knockback: { x: 8 },
  }),

  // ======== 蹲普通技 ========
  normal({
    id: 'cr_a', name: '蹲轻拳', stance: 'crouch', button: Btn.A,
    startup: 5, active: 3, recovery: 8,
    hitbox: [12, -56, 34, 16], damage: 35,
    chain: ['cr_c', 'cr_d', 'st_c'],
  }),
  normal({
    id: 'cr_b', name: '蹲轻脚', stance: 'crouch', button: Btn.B,
    startup: 6, active: 3, recovery: 11,
    hitbox: [12, -16, 42, 16], damage: 38, guard: 'low',
  }),
  normal({
    id: 'cr_c', name: '熔岩上勾', stance: 'crouch', button: Btn.C,
    startup: 9, active: 5, recovery: 18,
    hitbox: [8, -120, 36, 70], damage: 85,
    knockback: { x: 3, y: -8 },
  }),
  normal({
    id: 'cr_d', name: '熔岩下扫', stance: 'crouch', button: Btn.D,
    startup: 11, active: 4, recovery: 24,
    hitbox: [12, -18, 80, 18], damage: 80, guard: 'low',
    knockdown: true, knockback: { x: 6 },
  }),

  // ======== 空中普通技 ========
  normal({
    id: 'j_a', name: '空轻拳', stance: 'air', button: Btn.A,
    startup: 5, active: 6, recovery: 9,
    hitbox: [10, -80, 32, 18], damage: 38,
  }),
  normal({
    id: 'j_b', name: '空轻脚', stance: 'air', button: Btn.B,
    startup: 6, active: 6, recovery: 9,
    hitbox: [12, -56, 38, 20], damage: 42,
  }),
  normal({
    id: 'j_c', name: '空熔岩拳', stance: 'air', button: Btn.C,
    startup: 9, active: 5, recovery: 12,
    hitbox: [10, -84, 46, 28], damage: 80,
    knockback: { x: 7 },
  }),
  normal({
    id: 'j_d', name: '空熔岩踢', stance: 'air', button: Btn.D,
    startup: 10, active: 6, recovery: 12,
    hitbox: [10, -44, 50, 34], damage: 85,
    knockback: { x: 7 },
  }),
];
