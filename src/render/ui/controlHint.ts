import { getInputHub } from '@input/InputHub';
import type { FighterState } from '@core/index';
import { keyLabel, type KeyConfig } from '@input/keymap';
import { motionArrows, moveCommand } from './moveListData';
import type { SampleCapabilities } from '../anime/sampleMode';

export function currentKeys(cfg?: KeyConfig): KeyConfig {
  return cfg ?? getInputHub().keyConfig;
}

/** 菜单统一提示，随重绑更新 */
export function confirmHint(cfg?: KeyConfig): string {
  const c = currentKeys(cfg);
  return `${keyLabel(c.p1.A)} 确认 / ${keyLabel(c.p1.B)} 返回 / Enter 开始`;
}

export function p1MoveHint(cfg?: KeyConfig): string {
  const c = currentKeys(cfg);
  return `P1 ${keyLabel(c.p1.Left)}${keyLabel(c.p1.Right)}移动 ${keyLabel(c.p1.Up)}跳 ${keyLabel(c.p1.A)}轻拳 ${keyLabel(c.p1.C)}重拳 后方向防御`;
}

/** Only show commands retained by the running sample, with live bindings/facing. */
export function sampleControlHint(fighters: readonly Pick<FighterState, 'def' | 'facing'>[], cfg?: KeyConfig, capabilities: readonly Readonly<SampleCapabilities>[] = []): string {
  const keys = currentKeys(cfg), p1 = fighters[0];
  const enabled = capabilities[0];
  const basic = [`P1 ${keyLabel(keys.p1.Left)}/${keyLabel(keys.p1.Right)}移动`, `${keyLabel(keys.p1.Down)}蹲`];
  if (enabled?.jump) basic.push(`${keyLabel(keys.p1.Up)}跳`);
  if (p1?.def.moves.some(move => move.id === 'st_a')) basic.push(`${keyLabel(keys.p1.A)}轻拳`);
  if (p1?.def.moves.some(move => move.id === 'st_b')) basic.push(`${keyLabel(keys.p1.B)}轻脚`);
  if (p1?.def.moves.some(move => move.id === 'st_c')) basic.push(`${keyLabel(keys.p1.C)}重拳`);
  if (p1?.def.moves.some(move => move.id === 'st_d')) basic.push(`${keyLabel(keys.p1.D)}重脚`);
  if (enabled?.dash) basic.push('双击前冲');
  if (enabled?.backdash) basic.push('双击后撤');
  if (enabled?.rollFwd || enabled?.rollBack) basic.push(`${keyLabel(keys.p1.A)}+${keyLabel(keys.p1.B)}${enabled.rollFwd && enabled.rollBack ? '翻滚' : enabled.rollFwd ? '前滚' : '后滚'}`);
  basic.push('后方向防御', 'F5木桩', 'F6重置', 'F11出招表');
  const abilities: string[] = [];
  for (const [side, fighter] of fighters.entries()) {
    const move = fighter.def.moves.find(candidate => candidate.id === 'sp_daifunka');
    if (!move) continue;
    const bind = side === 0 ? keys.p1 : keys.p2;
    const forward = keyLabel(fighter.facing === 1 ? bind.Right : bind.Left);
    const back = keyLabel(fighter.facing === 1 ? bind.Left : bind.Right);
    const down = keyLabel(bind.Down), up = keyLabel(bind.Up);
    const directions: Record<string, string> = { '1': `${down}+${back}`, '2': down, '3': `${down}+${forward}`, '4': back, '5': '松开', '6': forward, '7': `${up}+${back}`, '8': up, '9': `${up}+${forward}` };
    let command = moveCommand(move, bind, fighter.facing === 1);
    if (move.input.motion) command = command.replace(motionArrows(move.input.motion, fighter.facing === 1), [...move.input.motion].map(digit => directions[digit] ?? digit).join(' → '));
    abilities.push(`P${side + 1} ${move.name}：依次 ${command}${side === 1 ? '（F5切换大喷火木桩/人控）' : ''}`);
  }
  const limit = '仅开放图像和受击依赖完整的能力；未开放的双击方向需松手恢复';
  return `${basic.join('  ')}\n${[...abilities, limit].join('  |  ')}`;
}
