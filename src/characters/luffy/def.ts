import { px, type FighterDef } from '@core/index';
import { luffyMoves } from './moves';

/** 路飞：速攻连段型。血量中、移速快、翻滚远。数值为初始值，M3 实测后调整。 */
export const luffyDef: FighterDef = {
  id: 'luffy',
  name: '路飞',
  maxHp: 1050,
  movement: {
    walkFwdSpeed: px(2.4),
    walkBackSpeed: px(1.8),
    jumpVelocityY: px(-9.5),
    jumpVelocityX: px(2.6),
    hopVelocityY: px(-6.6),
    runSpeed: px(5.2),
    backdashSpeed: px(5),
    backdashFrames: 18,
    backdashInvuln: 6,
    rollSpeed: px(4.4),
    rollFrames: 28,
    rollInvuln: 20,
  },
  pushboxStand: [-14, -88, 28, 88],
  pushboxCrouch: [-16, -60, 32, 60],
  pushboxAir: [-12, -80, 24, 60],
  hurtboxStand: [[-14, -88, 28, 88]],
  hurtboxCrouch: [[-16, -60, 32, 60]],
  hurtboxAir: [[-13, -84, 26, 66]],
  moves: luffyMoves,
  skillSlots: ['sp_gatling', 'sp_bazooka', 'sp_rifle', 'sp_rocket', 'sp_balloon', 'sp_gear2', 'sp_storm', 'sp_gigant_pistol', 'ult_red_hawk'],
  color: 0xe63946,
  tagline: '速攻 · 连段 · 二档',
  quotes: ['我是要成为海贼王的男人！', '还没完呢，再来！', '橡胶……手枪！'],
};
