import { px, type FighterDef } from '@core/index';
import { labubuMoves } from './moves';

/**
 * LABUBU：贴身短打型。78px 的有效站立高度介于旧角色的蹲姿与站姿之间；
 * 横向受击框略宽，避免潮玩比例变成不合理的穿拳优势。
 */
export const labubuDef: FighterDef = {
  id: 'labubu',
  name: 'LABUBU',
  maxHp: 1000,
  movement: {
    walkFwdSpeed: px(2.5),
    walkBackSpeed: px(1.9),
    jumpVelocityY: px(-9.2),
    jumpVelocityX: px(2.5),
    hopVelocityY: px(-6.5),
    runSpeed: px(5.0),
    backdashSpeed: px(4.8),
    backdashFrames: 18,
    backdashInvuln: 6,
    rollSpeed: px(4.6),
    rollFrames: 26,
    rollInvuln: 18,
  },
  // 纠正短臂素材后，站立实体碰撞收至32px；受击面仍保持40px，避免靠小体型穿拳。
  // 这样真实贴身时 st_a 的17px最远端可接触所有四角，不需要拉长手臂或旧角色受击框。
  pushboxStand: [-16, -78, 32, 78],
  pushboxCrouch: [-21, -55, 42, 55],
  // 空中短肢不被自身实体框顶开；受击面仍38px，保持可被打中的体型。
  pushboxAir: [-15, -72, 30, 58],
  hurtboxStand: [[-20, -78, 40, 78]],
  hurtboxCrouch: [[-22, -55, 44, 55]],
  hurtboxAir: [[-19, -74, 38, 62]],
  moves: labubuMoves,
  skillSlots: [
    'sp_pounce_rush',
    'sp_prank_flurry',
    'sp_flip_upper',
    'sp_low_slide',
    'sp_leg_flip',
    'sp_mischief_drive',
    'sp_tumble_riot',
    'sp_monster_charge',
    'ult_monster_mayhem',
  ],
  color: 0x9b5de5,
  tagline: '贴身 · 连拍 · 抱摔',
  quotes: ['抓到你啦！', '再闹一回！', '嘻嘻，轮到我啦！'],
};
