import type Phaser from 'phaser';
import { MAX_METER, METER_STOCK, type FightSim, type ControlModes } from '@core/index';
import { keyLabel, type Action, type KeyConfig } from '@input/keymap';
import { SCREEN_H, SCREEN_W, font, ui } from '../screen';
import { UI } from '../ui/MenuList';

export const SKILL_REASON: Record<string, string> = {
  ready: '可用', meter: '气不足', air: '空地条件不符', recovery: '硬直中',
  cancel: '尚不可取消', phase: '等待开战', missing: '技能未配置',
};

function setTextIfChanged(target: Phaser.GameObjects.Text | null, value: string): void {
  if (target && target.text !== value) target.setText(value);
}

/** The strip occupies the floor margin below the fighters, never the combat corridor. */
export class SkillBar {
  private readonly cells: [Phaser.GameObjects.Text[], Phaser.GameObjects.Text[]] = [[], []];
  private readonly details: [Phaser.GameObjects.Text[], Phaser.GameObjects.Text[]] = [[], []];
  private readonly meters: [Phaser.GameObjects.Graphics | null, Phaser.GameObjects.Graphics | null] = [null, null];
  private readonly headers: [Phaser.GameObjects.Text | null, Phaser.GameObjects.Text | null] = [null, null];
  private readonly feedback: [Phaser.GameObjects.Text | null, Phaser.GameObjects.Text | null] = [null, null];

  constructor(scene: Phaser.Scene, private readonly modes: ControlModes) {
    for (const player of [0, 1] as const) {
      if (modes[player] !== 'simple') continue;
      const left = player * SCREEN_W / 2 + ui(8);
      const width = SCREEN_W / 2 - ui(16);
      scene.add.rectangle(left, SCREEN_H - ui(79), SCREEN_W / 2 - ui(16), ui(79), 0x0b1220, 0.9).setOrigin(0).setDepth(51);
      this.meters[player] = scene.add.graphics().setDepth(52);
      this.headers[player] = scene.add.text(left + ui(4), SCREEN_H - ui(78), '', {
        fontFamily: UI.font, fontSize: font(9), color: player === 0 ? UI.p1 : UI.p2, fontStyle: 'bold',
      }).setDepth(53);
      for (let slot = 0; slot < 9; slot++) {
        const cell = scene.add.text(left + ui(5) + slot % 3 * ui(153), SCREEN_H - ui(68) + Math.floor(slot / 3) * ui(22), '', {
          fontFamily: UI.font, fontSize: font(11), color: '#dce8ed',
        }).setDepth(52);
        this.cells[player].push(cell);
        this.details[player].push(scene.add.text(cell.x, cell.y + ui(12), '', { fontFamily: UI.font, fontSize: font(9), color: '#b8cbd4' }).setDepth(52));
      }
      this.feedback[player] = scene.add.text(left + width - ui(4), SCREEN_H - ui(78), '', {
        fontFamily: UI.font, fontSize: font(9), color: '#ffd66f',
      }).setOrigin(1, 0).setDepth(53);
    }
  }

  draw(sim: FightSim, keys: KeyConfig): void {
    for (const player of [0, 1] as const) {
      if (this.modes[player] !== 'simple') continue;
      const def = sim.state.fighters[player].def;
      this.cells[player].forEach((cell, slot) => {
        const state = sim.skillAvailability(player, slot);
        const move = def.moves.find(item => item.id === state.moveId);
        const key = keys[player === 0 ? 'p1' : 'p2'][`Skill${slot + 1}` as Action];
        const cost = (move?.meterCost ?? 0) / METER_STOCK;
        const text = `${keyLabel(key ?? '')} ${move?.name ?? '未配置'}`;
        if (cell.text !== text) cell.setText(text);
        const color = state.available ? '#e4eff4' : '#9aaab5';
        if (cell.style.color !== color) cell.setColor(color);
        setTextIfChanged(this.details[player][slot]!, `${cost}气 · ${SKILL_REASON[state.reason] ?? state.reason}`);
      });
      const meter = sim.state.fighters[player].meter;
      const left = player * SCREEN_W / 2 + ui(8);
      const width = SCREEN_W / 2 - ui(16);
      this.meters[player]?.clear().fillStyle(0x334552).fillRect(left, SCREEN_H - ui(79), width, ui(2)).fillStyle(0x74cbd9).fillRect(left, SCREEN_H - ui(79), width * Math.min(1, meter / MAX_METER), ui(2));
      const latest = sim.skillFeedback[player];
      const recent = latest && sim.state.frame - latest.frame < 90;
      setTextIfChanged(this.headers[player], `P${player + 1}  气 ${(meter / METER_STOCK).toFixed(1)} / ${MAX_METER / METER_STOCK}`);
      setTextIfChanged(this.feedback[player], recent
        ? `技能${latest.slot + 1} ${latest.reason === 'ready' ? '已接收' : SKILL_REASON[latest.reason] ?? latest.reason}`
        : 'F11 招式表');
    }
  }
}
