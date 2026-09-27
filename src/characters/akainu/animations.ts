import { spriteAnimations } from '@render/animations';
import manifest from '../../../scripts/sprite_manifest.json';
import { akainuMoves } from './moves';

/** 同系列连续精灵；不完整的招式复刻在清单 note 中明示。 */
export const akainuAnims = spriteAnimations(manifest.characters.akainu.states, manifest.characters.akainu.moves, akainuMoves);
