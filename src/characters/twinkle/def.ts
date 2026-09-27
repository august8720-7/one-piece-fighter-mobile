import { px, type FighterDef } from '@core/index';
import { twinkleMoves } from './moves';

/**
 * 星星人：中距离控场型。84px 站立高度接近路飞的 88px，较宽星形轮廓保留可读受击面。
 */
export const twinkleDef: FighterDef = {
  id: 'twinkle',
  name: '星星人',
  maxHp: 960,
  movement: {
    walkFwdSpeed: px(2.0),
    walkBackSpeed: px(1.8),
    jumpVelocityY: px(-9.0),
    jumpVelocityX: px(2.2),
    hopVelocityY: px(-6.4),
    runSpeed: px(4.5),
    backdashSpeed: px(5.0),
    backdashFrames: 19,
    backdashInvuln: 7,
    rollSpeed: px(4.0),
    rollFrames: 28,
    rollInvuln: 20,
  },
  pushboxStand: [-18, -84, 36, 84],
  pushboxCrouch: [-14, -58, 28, 58],
  pushboxAir: [-17, -78, 34, 62],
  hurtboxStand: [[-21, -84, 42, 84]],
  hurtboxCrouch: [[-22, -58, 44, 58]],
  hurtboxAir: [[-20, -80, 40, 66]],
  moves: twinkleMoves,
  skillSlots: [
    'sp_tiny_star',
    'sp_starlight_push',
    'sp_upward_spark',
    'sp_falling_star',
    'sp_star_reflect',
    'sp_blink_dodge',
    'sp_star_rain',
    'sp_shining_wave',
    'ult_star_symphony',
  ],
  color: 0x4cc9f0,
  tagline: '星弹 · 落点 · 反弹',
  quotes: ['让星光陪你玩！', '亮晶晶，再来一次！', '看，星星落下来啦！'],
};
