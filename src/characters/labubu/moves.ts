import { Btn, K, P, attack, balance, normal, throwMove, utility, type InstallDef, type MoveData } from '@core/index';

const { SUPER_COST, ULTIMATE_COST } = balance;

/** 疲劳是顽皮冲劲的明确代价；不新增护盾、治疗或独立状态系统。 */
export const LABUBU_MISCHIEF_DRIVE: InstallDef = {
  id: 'labubu_mischief_drive',
  duration: 420,
  speedNum: 23,
  speedDen: 20,
  specialStartupSkip: 2,
  damageNum: 11,
  damageDen: 10,
  fatigueFrames: 120,
  fatigueSpeedNum: 17,
  fatigueSpeedDen: 20,
};

export const labubuMoves: readonly MoveData[] = [
  // 九项快捷技能：同一条 MoveData 同时服务经典指令和一键输入。
  attack({
    id: 'sp_pounce_rush', name: '扑扑突袭', stance: 'stand', button: P, motion: '236',
    segments: [{ startup: 9, active: 5, hitbox: [5, -65, 32, 58] }],
    recovery: 20, damage: 76, hitstun: 21, blockstun: 14, hitstop: 10,
    knockback: { x: 7 }, stepX: 2.8, activeStepX: 3.6,
  }),
  attack({
    id: 'sp_prank_flurry', name: '捣蛋连拍', stance: 'stand', button: P, motion: '214',
    segments: [
      { startup: 7, active: 3, hitbox: [17, -38, 15, 16] },
      { startup: 3, active: 3, hitbox: [17, -25, 15, 17] },
      { startup: 3, active: 3, hitbox: [17, -38, 15, 16] },
      { startup: 4, active: 4, hitbox: [9, -35, 23, 20] },
    ],
    recovery: 23, damage: 24, hitstun: 27, blockstun: 11, hitstop: 7,
    knockback: { x: 2 }, activeStepX: 0.7,
  }),
  attack({
    id: 'sp_flip_upper', name: '翻身上挑', stance: 'stand', button: P, motion: '623', invuln: 5,
    // 0927实机接触校准：地面对空只覆盖真实上挑爪部，不向无原画的空中延伸。
    segments: [{ startup: 8, active: 6, hitbox: [15, -55, 17, 23] }],
    recovery: 27, damage: 112, hitstun: 27, blockstun: 16, hitstop: 12,
    knockback: { x: 4, y: -9 }, knockdown: true,
  }),
  attack({
    id: 'sp_low_slide', name: '贴地滑冲', stance: 'stand', button: K, motion: '236',
    segments: [{ startup: 11, active: 7, hitbox: [16, -14, 16, 16] }],
    recovery: 28, damage: 88, guard: 'low', hitstun: 22, blockstun: 15, hitstop: 10,
    knockback: { x: 8 }, stepX: 2.4, activeStepX: 3.4,
    hurtboxes: [[-22, -43, 44, 43]],
  }),
  attack({
    id: 'sp_leg_flip', name: '抱腿翻摔', stance: 'stand', button: K, motion: '623',
    segments: [{ startup: 12, active: 4, hitbox: [4, -34, 27, 30] }],
    recovery: 28, damage: 148, guard: 'unblockable',
    knockback: { x: 6, y: -8 },
    throwData: { techWindow: 0, releaseFrame: 24, duration: 46, holdOffset: 30, keepHoldOffsetAtWall: true },
  }),
  utility({
    id: 'sp_mischief_drive', name: '顽皮冲劲', button: K, motion: '22',
    startup: 16, recovery: 11, install: LABUBU_MISCHIEF_DRIVE,
  }),
  attack({
    id: 'sp_tumble_riot', name: '翻滚大闹', type: 'super', stance: 'stand', button: P, motion: '236236',
    meterCost: SUPER_COST, invuln: 8,
    segments: [
      { startup: 10, active: 3, hitbox: [14, -41, 15, 23] },
      { startup: 3, active: 3, hitbox: [12, -41, 15, 32] },
      { startup: 3, active: 3, hitbox: [29, -19, 14, 15] },
      { startup: 3, active: 3, hitbox: [4, -51, 14, 14] },
      { startup: 4, active: 5, hitbox: [7, -29, 27, 17] },
    ],
    recovery: 30, damage: 34, hitstun: 35, blockstun: 13, hitstop: 8,
    knockback: { x: 1, y: 0 }, stepX: 2.1, activeStepX: 1.4,
  }),
  attack({
    id: 'sp_monster_charge', name: '怪兽冲撞', type: 'super', stance: 'stand', button: P, motion: '214214',
    meterCost: SUPER_COST, armor: true, armorFrames: 16, armorBreak: true,
    segments: [{ startup: 22, active: 7, hitbox: [22, -42, 17, 24] }],
    recovery: 42, damage: 230, hitstun: 36, blockstun: 25, hitstop: 17,
    knockback: { x: 14, y: -6 }, wallBounce: true, knockdown: true,
    stepX: 2.3, activeStepX: 4.2,
  }),
  attack({
    id: 'ult_monster_mayhem', name: '怪兽大闹场', type: 'ultimate', stance: 'stand', button: K, motion: '236236',
    meterCost: ULTIMATE_COST, invuln: 12, armorBreak: true,
    // 0927真实短肢改为地面五连击；恢复时间避免命中后必吃反击，原伤害/阶段/耗气保持。
    segments: [
      { startup: 14, active: 4, hitbox: [24, -45, 14, 24] },
      { startup: 4, active: 3, hitbox: [4, -31, 28, 21] },
      { startup: 4, active: 3, hitbox: [6, -56, 15, 21] },
      { startup: 4, active: 3, hitbox: [15, -27, 13, 16] },
      { startup: 5, active: 7, hitbox: [12, -30, 24, 20] },
    ],
    recovery: 43, damage: 58, hitstun: 50, blockstun: 19, hitstop: 12,
    knockback: { x: 2, y: 0 }, wallBounce: true, knockdown: false,
    stepX: 2.8, activeStepX: 2.2,
  }),

  // 吹飞与普通投。0925实机发现旧横向框在身体前沿之外隔空命中；
  // CD/JCD收至已制成短肢活动帧附近，伤害、时序与击退不变。
  normal({
    id: 'cd', name: '双耳大摆', stance: 'stand', button: Btn.C, plus: Btn.D,
    startup: 17, active: 5, recovery: 25, hitbox: [5, -50, 12, 38], damage: 96,
    hitstun: 31, blockstun: 21, hitstop: 14, knockback: { x: 12, y: -5 }, wallBounce: true,
  }),
  normal({
    id: 'j_cd', name: '空中双耳大摆', stance: 'air', button: Btn.C, plus: Btn.D,
    startup: 11, active: 6, recovery: 14, hitbox: [4, -45, 13, 35], damage: 88,
    hitstun: 27, blockstun: 18, hitstop: 12, knockback: { x: 9, y: -4 },
  }),
  throwMove({
    id: 'throw_fwd', name: '顽皮抱摔', direction: 6, button: Btn.C, damage: 116, total: 44,
    knockback: { x: 6, y: -7 }, throwData: { range: 47, techWindow: 8, releaseFrame: 22, holdOffset: 31 },
  }),
  throwMove({
    id: 'throw_back', name: '顽皮抱摔（后）', direction: 4, button: Btn.C, damage: 116, total: 44,
    knockback: { x: 6, y: -7 }, throwData: { range: 47, techWindow: 8, releaseFrame: 22, holdOffset: 31 },
  }),

  normal({
    id: 'f_c', name: '脑袋顶顶', stance: 'stand', button: Btn.C, direction: 6,
    startup: 14, active: 4, recovery: 19, hitbox: [19, -50, 27, 37], damage: 82, guard: 'high',
    knockback: { x: 7 }, stepX: 1.4,
  }),

  // 站立普通技。
  // 0922 corrected normalA 静态接触对照：只收判定框到真实短肢范围，伤害/时序/击退不变；实机手感仍待验。
  normal({ id: 'st_a', name: '轻爪', stance: 'stand', button: Btn.A, startup: 4, active: 3, recovery: 8, hitbox: [4, -39, 13, 13], damage: 34, chain: ['st_c', 'st_d', 'cr_d', 'f_c'] }),
  normal({ id: 'st_b', name: '脚尖踢', stance: 'stand', button: Btn.B, startup: 5, active: 3, recovery: 10, hitbox: [7, -25, 21, 16], damage: 38, chain: ['st_c', 'st_d', 'f_c'] }),
  normal({ id: 'st_c', name: '大爪拍', stance: 'stand', button: Btn.C, startup: 9, active: 4, recovery: 18, hitbox: [2, -39, 20, 17], damage: 72, knockback: { x: 6 }, stepX: 1.0 }),
  normal({ id: 'st_d', name: '转身踢', stance: 'stand', button: Btn.D, startup: 11, active: 5, recovery: 20, hitbox: [2, -38, 33, 23], damage: 76, knockback: { x: 7 } }),

  // 蹲普通技。
  normal({ id: 'cr_a', name: '蹲轻爪', stance: 'crouch', button: Btn.A, startup: 4, active: 3, recovery: 8, hitbox: [16, -27, 14, 15], damage: 32, chain: ['cr_c', 'cr_d', 'st_c'] }),
  normal({ id: 'cr_b', name: '蹲脚尖', stance: 'crouch', button: Btn.B, startup: 5, active: 3, recovery: 10, hitbox: [18, -24, 14, 17], damage: 35, guard: 'low' }),
  normal({ id: 'cr_c', name: '蹲身上拍', stance: 'crouch', button: Btn.C, startup: 8, active: 5, recovery: 18, hitbox: [15, -43, 14, 18], damage: 78, knockback: { x: 3, y: -7 } }),
  normal({ id: 'cr_d', name: '扫堂踢', stance: 'crouch', button: Btn.D, startup: 9, active: 4, recovery: 22, hitbox: [31, -16, 14, 16], damage: 70, guard: 'low', knockdown: true, knockback: { x: 5 } }),

  // 空中普通技。
  normal({ id: 'j_a', name: '空轻爪', stance: 'air', button: Btn.A, startup: 4, active: 6, recovery: 8, hitbox: [12, -41, 12, 15], damage: 34 }),
  normal({ id: 'j_b', name: '空脚尖', stance: 'air', button: Btn.B, startup: 5, active: 6, recovery: 9, hitbox: [18, -36, 12, 17], damage: 39 }),
  normal({ id: 'j_c', name: '空大爪拍', stance: 'air', button: Btn.C, startup: 8, active: 5, recovery: 11, hitbox: [23, -41, 13, 15], damage: 72, knockback: { x: 6 } }),
  normal({ id: 'j_d', name: '空转身踢', stance: 'air', button: Btn.D, startup: 9, active: 6, recovery: 11, hitbox: [14, -37, 11, 15], damage: 77, knockback: { x: 6 } }),
];
