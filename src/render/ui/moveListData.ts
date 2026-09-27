import { Btn, K, METER_STOCK, P, type FighterDef, type MoveData, type ControlMode } from '@core/index';
import { keyLabel, type KeyBinding, type Action } from '@input/keymap';

export const MOVE_GROUPS = [
  { id: 'ground', label: '地面招式' },
  { id: 'air_throw', label: '空中 / 投技' },
  { id: 'special', label: '特殊技' },
  { id: 'super', label: '超必杀' },
] as const;
export type MoveGroup = (typeof MOVE_GROUPS)[number]['id'];
export const MOVES_PER_PAGE = 10;

export function moveGroup(move: MoveData): MoveGroup {
  if (move.type === 'super' || move.type === 'ultimate') return 'super';
  if (move.type === 'special') return 'special';
  if (move.type === 'throw' || move.input.stance === 'air') return 'air_throw';
  return 'ground';
}

/** 不按数量截断或按显示名去重；每个实际招式均能在表中找到。 */
export function movesInGroup(def: FighterDef, group: MoveGroup): MoveData[] {
  const order = (move: MoveData) => {
    if (move.type === 'throw') return 4;
    if (move.type === 'command_normal' || move.type === 'blowback') return 3;
    return move.input.stance === 'crouch' ? 1 : 0;
  };
  return def.moves.filter((move) => moveGroup(move) === group).sort((a, b) => order(a) - order(b));
}

function buttonText(button: number, bind: KeyBinding): string {
  if ((button & P) === P) return `拳(${keyLabel(bind.A)}/${keyLabel(bind.C)})`;
  if ((button & K) === K) return `脚(${keyLabel(bind.B)}/${keyLabel(bind.D)})`;
  const action = button === Btn.A ? 'A' : button === Btn.B ? 'B' : button === Btn.C ? 'C' : button === Btn.D ? 'D' : null;
  return action ? keyLabel(bind[action]) : '?';
}

/** 数字方向相对人物前方，展示时转换成屏幕方向。 */
export function motionArrows(motion: string, facingRight: boolean): string {
  const right: Record<string, string> = { '1': '↙', '2': '↓', '3': '↘', '4': '←', '5': '·', '6': '→', '7': '↖', '8': '↑', '9': '↗' };
  const mirror: Record<string, string> = { '1': '3', '3': '1', '4': '6', '6': '4', '7': '9', '9': '7' };
  return [...motion].map((digit) => right[facingRight ? digit : mirror[digit] ?? digit] ?? digit).join('');
}

export function moveCommand(move: MoveData, bind: KeyBinding, facingRight: boolean, mode: ControlMode = 'classic', slots: readonly string[] = []): string {
  const slot = slots.indexOf(move.id);
  if (mode === 'simple' && slot >= 0) return `${keyLabel(bind[`Skill${slot + 1}` as Action] ?? '')} · 一键（需满足空地 / 气量 / 取消条件）`;
  const direction: string[] = [];
  if (move.input.stance === 'crouch' || move.input.down) direction.push('↓');
  if (move.input.direction) direction.push(motionArrows(String(move.input.direction), facingRight));
  if (move.input.motion) direction.push(motionArrows(move.input.motion, facingRight));
  const buttons = [buttonText(move.input.button, bind)];
  if (move.input.plus) buttons.push(buttonText(move.input.plus, bind));
  const prefix = move.input.stance === 'air' ? '空中 ' : '';
  return prefix + [...direction, ...buttons].join(' + ');
}

/** 出招姿态与防御属性不同：蹲拳不必然是下段，空中招式不等于对空。 */
export function moveProperties(move: MoveData): string {
  const tags: string[] = [];
  if (move.meterCost) tags.push(`${move.meterCost / METER_STOCK}格气`);
  if (move.type === 'throw') tags.push(move.throwData?.techWindow === 0 ? '指令投' : '近身投');
  else if (move.install) tags.push('强化');
  else if (move.reflect) tags.push('弹反');
  else if (move.dodge) tags.push('闪避');
  else tags.push(move.guard === 'high' ? '中段·站防' : move.guard === 'low' ? '下段·蹲防' : move.guard === 'unblockable' ? '不可防' : '上段·站/蹲防');
  if (move.armorBreak) tags.push('破霸体');
  else if (move.burn) tags.push('灼烧');
  return tags.join('  ');
}
