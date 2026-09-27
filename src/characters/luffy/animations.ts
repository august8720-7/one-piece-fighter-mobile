import { spriteAnimations } from '@render/animations';
import manifest from '../../../scripts/sprite_manifest.json';
import { luffyMoves } from './moves';

/** 已验收的 Gigant Battle! 2 连续精灵；动作和图集共同使用显式清单。 */
export const luffyAnims = spriteAnimations(manifest.characters.luffy.states, manifest.characters.luffy.moves, luffyMoves);
