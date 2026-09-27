import { px, type FighterDef } from '@core/index';
import { akainuMoves } from './moves';

/** 赤犬：重型压制型。血量高、移速慢、翻滚短。数值为初始值，M3 实测后调整。 */
export const akainuDef: FighterDef = {
  id: 'akainu',
  name: '赤犬',
  maxHp: 1050,
  movement: {
    walkFwdSpeed: px(1.7),
    walkBackSpeed: px(1.3),
    jumpVelocityY: px(-8.8),
    jumpVelocityX: px(2.0),
    hopVelocityY: px(-6.2),
    runSpeed: px(4.2),
    backdashSpeed: px(4.2),
    backdashFrames: 20,
    backdashInvuln: 5,
    rollSpeed: px(3.8),
    rollFrames: 30,
    rollInvuln: 20,
  },
  pushboxStand: [-17, -100, 34, 100],
  pushboxCrouch: [-19, -68, 38, 68],
  pushboxAir: [-15, -92, 30, 68],
  hurtboxStand: [[-17, -100, 34, 100]],
  hurtboxCrouch: [[-19, -68, 38, 68]],
  hurtboxAir: [[-16, -96, 32, 74]],
  moves: akainuMoves,
  skillSlots: ['sp_daifunka', 'sp_inugami', 'sp_meigou', 'sp_meteor', 'sp_ground_split', 'sp_magma_body', 'sp_daifunka_ren', 'sp_meteor_rain', 'ult_meigou_end'],
  color: 0xf4a261,
  tagline: '压制 · 霸体 · 灼烧',
  quotes: ['正义，必胜。', '恶，必须彻底铲除。', '这就是海军的正义。'],
};
