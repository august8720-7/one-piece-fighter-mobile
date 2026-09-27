import { Btn, K, P, attack, balance, normal, throwMove, utility, type MoveData, type ProjectileSpawn } from '@core/index';

const { DODGE_COST, SUPER_COST, ULTIMATE_COST } = balance;

export const TWINKLE_PROJECTILE_KINDS = [
  'twinkle_tiny_star',
  'twinkle_upward_star',
  'twinkle_falling_star',
  'twinkle_star_rain',
  'twinkle_shining_wave',
  'twinkle_symphony_star',
] as const;

const fallingStar = (frame: number, x: number, kind: 'twinkle_falling_star' | 'twinkle_star_rain'): ProjectileSpawn => ({
  frame, kind, x, y: -158, vx: 0, vy: 4.4, gravity: 0.12, ttl: 76,
  box: [-15, -15, 30, 30], durability: 1, damage: kind === 'twinkle_star_rain' ? 38 : 96,
  hitstun: kind === 'twinkle_star_rain' ? 18 : 24,
  blockstun: kind === 'twinkle_star_rain' ? 12 : 16,
  knockback: { x: 3, y: kind === 'twinkle_star_rain' ? -3 : -6 }, dieOnGround: true,
});

export const twinkleMoves: readonly MoveData[] = [
  utility({
    id: 'sp_tiny_star', name: '小星弹', button: P, motion: '236', startup: 11, cast: 8, recovery: 18,
    damage: 66, hitstun: 20, blockstun: 14, hitstop: 9, knockback: { x: 6 },
    projectiles: [{
      frame: 8, kind: 'twinkle_tiny_star', x: 56, y: -38, vx: 3.6, vy: 0, ttl: 120,
      box: [-11, -11, 22, 22], durability: 1,
    }],
  }),
  attack({
    id: 'sp_starlight_push', name: '星光推推', stance: 'stand', button: P, motion: '214',
    segments: [{ startup: 9, active: 5, hitbox: [12, -78, 72, 58] }],
    recovery: 20, damage: 90, hitstun: 23, blockstun: 16, hitstop: 11,
    knockback: { x: 12 },
  }),
  utility({
    id: 'sp_upward_spark', name: '向上闪亮', button: P, motion: '623', startup: 9, cast: 6, recovery: 21,
    damage: 82, hitstun: 24, blockstun: 15, hitstop: 10, knockback: { x: 4, y: -7 },
    projectiles: [{
      frame: 6, kind: 'twinkle_upward_star', x: 20, y: -56, vx: 2.0, vy: -5.4, gravity: 0.13, ttl: 70,
      box: [-12, -12, 24, 24], durability: 1, dieOnGround: true,
    }],
  }),
  utility({
    id: 'sp_falling_star', name: '星星落下', button: P, motion: '22', startup: 16, cast: 10, recovery: 23,
    damage: 96, hitstun: 24, blockstun: 16, hitstop: 11, knockback: { x: 3, y: -6 }, knockdown: true,
    // x 固定相对施放者，不读取对手位置，也不追踪。
    projectiles: [fallingStar(10, 92, 'twinkle_falling_star')],
  }),
  attack({
    id: 'sp_star_reflect', name: '星光反弹', stance: 'stand', button: K, motion: '214', reflect: true,
    segments: [{ startup: 8, active: 10, hitbox: [5, -62, 62, 58] }],
    recovery: 24, damage: 0, hitstun: 0, blockstun: 0, hitstop: 0, knockback: { x: 0 },
  }),
  utility({
    id: 'sp_blink_dodge', name: '闪一下', button: K, motion: '22', meterCost: DODGE_COST,
    startup: 18, recovery: 14, invuln: 18, dodge: true,
  }),
  utility({
    id: 'sp_star_rain', name: '星雨来啦', type: 'super', button: P, motion: '214214',
    meterCost: SUPER_COST, invuln: 7, startup: 28, cast: 8, recovery: 32,
    damage: 38, hitstun: 18, blockstun: 12, hitstop: 8, knockback: { x: 3, y: -3 },
    projectiles: [
      fallingStar(8, 44, 'twinkle_star_rain'),
      fallingStar(14, 84, 'twinkle_star_rain'),
      fallingStar(20, 124, 'twinkle_star_rain'),
      fallingStar(26, 164, 'twinkle_star_rain'),
    ],
  }),
  utility({
    id: 'sp_shining_wave', name: '闪亮推波', type: 'super', button: P, motion: '236236',
    meterCost: SUPER_COST, invuln: 8, startup: 17, cast: 12, recovery: 34,
    damage: 186, hitstun: 32, blockstun: 23, hitstop: 15, knockback: { x: 13, y: -4 }, knockdown: true,
    projectiles: [{
      frame: 12, kind: 'twinkle_shining_wave', x: 26, y: -34, vx: 4.0, vy: 0, ttl: 82,
      box: [0, -34, 118, 68], durability: 1,
    }],
  }),
  utility({
    id: 'ult_star_symphony', name: '星光大合奏', type: 'ultimate', button: K, motion: '236236',
    meterCost: ULTIMATE_COST, invuln: 12, startup: 34, cast: 8, recovery: 44,
    damage: 56, hitstun: 21, blockstun: 14, hitstop: 10, knockback: { x: 4, y: -4 }, knockdown: true,
    projectiles: [
      { frame: 8, kind: 'twinkle_symphony_star', x: 20, y: -38, vx: 4.8, vy: -0.4, ttl: 90, box: [-14, -14, 28, 28], durability: 2 },
      { frame: 12, kind: 'twinkle_symphony_star', x: 22, y: -72, vx: 4.5, vy: 0, ttl: 90, box: [-14, -14, 28, 28], durability: 2 },
      { frame: 16, kind: 'twinkle_symphony_star', x: 18, y: -104, vx: 4.2, vy: 0.35, ttl: 90, box: [-14, -14, 28, 28], durability: 2 },
      { frame: 21, kind: 'twinkle_symphony_star', x: 26, y: -54, vx: 5.0, vy: -0.2, ttl: 90, box: [-16, -16, 32, 32], durability: 2 },
      { frame: 26, kind: 'twinkle_symphony_star', x: 24, y: -86, vx: 4.7, vy: 0.2, ttl: 90, box: [-16, -16, 32, 32], durability: 2 },
      { frame: 32, kind: 'twinkle_symphony_star', x: 20, y: -68, vx: 5.2, vy: 0, ttl: 90, box: [-19, -19, 38, 38], durability: 3 },
    ],
  }),

  normal({
    id: 'cd', name: '星芒吹飞', stance: 'stand', button: Btn.C, plus: Btn.D,
    startup: 18, active: 5, recovery: 26, hitbox: [6, -55, 68, 45], damage: 94,
    hitstun: 31, blockstun: 21, hitstop: 14, knockback: { x: 12, y: -5 }, wallBounce: true,
  }),
  normal({
    id: 'j_cd', name: '空中星芒吹飞', stance: 'air', button: Btn.C, plus: Btn.D,
    // 0925按已制成前手活动帧校准，避免79px根点距离仍能隔空扣血。
    startup: 12, active: 6, recovery: 14, hitbox: [5, -48, 47, 40], damage: 86,
    hitstun: 27, blockstun: 18, hitstop: 12, knockback: { x: 9, y: -4 },
  }),
  throwMove({
    id: 'throw_fwd', name: '星光转圈', direction: 6, button: Btn.C, damage: 108, total: 46,
    knockback: { x: 6, y: -7 }, throwData: { range: 46, techWindow: 8, releaseFrame: 23, holdOffset: 32 },
  }),
  throwMove({
    id: 'throw_back', name: '星光转圈（后）', direction: 4, button: Btn.C, damage: 108, total: 46,
    knockback: { x: 6, y: -7 }, throwData: { range: 46, techWindow: 8, releaseFrame: 23, holdOffset: 32 },
  }),

  normal({
    id: 'f_c', name: '星角点点', stance: 'stand', button: Btn.C, direction: 6,
    startup: 15, active: 4, recovery: 20, hitbox: [17, -57, 31, 45], damage: 80, guard: 'high',
    knockback: { x: 7 }, stepX: 1.0,
  }),

  // 0922 corrected normalA 静态接触对照：只收判定框到真实短肢范围，伤害/时序/击退不变；实机手感仍待验。
  normal({ id: 'st_a', name: '轻星拍', stance: 'stand', button: Btn.A, startup: 5, active: 3, recovery: 9, hitbox: [22, -47, 28, 20], damage: 34, chain: ['st_c', 'st_d', 'cr_d', 'f_c'] }),
  normal({ id: 'st_b', name: '星尖踢', stance: 'stand', button: Btn.B, startup: 6, active: 3, recovery: 11, hitbox: [3, -35, 31, 24], damage: 38, chain: ['st_c', 'st_d', 'f_c'] }),
  normal({ id: 'st_c', name: '大星拍', stance: 'stand', button: Btn.C, startup: 10, active: 4, recovery: 19, hitbox: [10, -42, 27, 20], damage: 72, knockback: { x: 6 } }),
  normal({ id: 'st_d', name: '星尾踢', stance: 'stand', button: Btn.D, startup: 12, active: 5, recovery: 21, hitbox: [7, -49, 38, 30], damage: 76, knockback: { x: 7 } }),

  normal({ id: 'cr_a', name: '蹲轻星拍', stance: 'crouch', button: Btn.A, startup: 5, active: 3, recovery: 8, hitbox: [21, -32, 19, 16], damage: 32, chain: ['cr_c', 'cr_d', 'st_c'] }),
  normal({ id: 'cr_b', name: '蹲星尖', stance: 'crouch', button: Btn.B, startup: 6, active: 3, recovery: 10, hitbox: [20, -25, 17, 18], damage: 35, guard: 'low' }),
  normal({ id: 'cr_c', name: '星芒上扬', stance: 'crouch', button: Btn.C, startup: 9, active: 5, recovery: 19, hitbox: [-1, -52, 16, 27], damage: 78, knockback: { x: 3, y: -7 }, stepX: 0.5 }),
  normal({ id: 'cr_d', name: '星光扫地', stance: 'crouch', button: Btn.D, startup: 10, active: 4, recovery: 23, hitbox: [30, -17, 19, 16], damage: 70, guard: 'low', knockdown: true, knockback: { x: 5 } }),

  normal({ id: 'j_a', name: '空轻星拍', stance: 'air', button: Btn.A, startup: 5, active: 6, recovery: 8, hitbox: [18, -53, 17, 16], damage: 34 }),
  normal({ id: 'j_b', name: '空星尖踢', stance: 'air', button: Btn.B, startup: 6, active: 6, recovery: 9, hitbox: [14, -40, 19, 16], damage: 39 }),
  normal({ id: 'j_c', name: '空大星拍', stance: 'air', button: Btn.C, startup: 9, active: 5, recovery: 11, hitbox: [21, -50, 18, 18], damage: 72, knockback: { x: 6 } }),
  normal({ id: 'j_d', name: '空星尾踢', stance: 'air', button: Btn.D, startup: 10, active: 6, recovery: 12, hitbox: [15, -49, 15, 17], damage: 77, knockback: { x: 6 } }),
];
