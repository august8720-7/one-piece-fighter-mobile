import Phaser from 'phaser';
import { Btn, type FighterDef, type InputFrame, type MoveData, type ControlModes } from '@core/index';
import { keyLabel, type KeyBinding, type KeyConfig } from '@input/keymap';
import { LAYOUT_H as SCREEN_H, LAYOUT_W as SCREEN_W } from '../screen';
import { layoutGroup } from './layoutGroup';
import { UI } from './MenuList';
import { MOVE_GROUPS, MOVES_PER_PAGE, moveCommand, moveProperties, movesInGroup } from './moveListData';

export class MoveListPanel {
  private readonly nodes: Phaser.GameObjects.GameObject[] = [];
  private cfg: KeyConfig | null = null;
  private facing: [boolean, boolean] = [true, false];
  private groupIndex = 0;
  private page = 0;
  visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly defs: [FighterDef, FighterDef],
    private readonly modes: ControlModes = ['classic', 'classic'],
  ) {}

  toggle(cfg: KeyConfig, facing: [boolean, boolean]): void {
    if (this.visible) this.hide();
    else this.show(cfg, facing);
  }

  hide(): void {
    this.visible = false;
    this.clear();
  }

  private clear(): void {
    for (const n of this.nodes) n.destroy();
    this.nodes.length = 0;
  }

  show(cfg: KeyConfig, facing: [boolean, boolean]): void {
    this.cfg = cfg;
    this.facing = facing;
    this.visible = true;
    this.draw();
  }

  /** 键盘和手柄共用方向输入，返回 true 表示请求关闭。 */
  update(input: InputFrame): boolean {
    const bits = input.p1 | input.p2;
    if (bits & Btn.B) return true;
    if (bits & (Btn.Left | Btn.Right)) {
      this.groupIndex = (this.groupIndex + (bits & Btn.Left ? MOVE_GROUPS.length - 1 : 1)) % MOVE_GROUPS.length;
      this.page = 0;
      this.draw();
    } else if (bits & (Btn.Up | Btn.Down)) {
      const pages = this.pageCount();
      this.page = (this.page + (bits & Btn.Up ? pages - 1 : 1)) % pages;
      this.draw();
    }
    return false;
  }

  private pageCount(): number {
    const group = MOVE_GROUPS[this.groupIndex]!.id;
    return Math.max(1, ...this.defs.map((def) => Math.ceil(movesInGroup(def, group).length / MOVES_PER_PAGE)));
  }

  private draw(): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.clear();
    const bg = this.scene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x07080c, 0.88).setOrigin(0).setDepth(210);
    const title = this.scene.add
      .text(SCREEN_W / 2, 18, '出招表', { fontFamily: UI.font, fontSize: '28px', color: UI.title, fontStyle: 'bold' })
      .setOrigin(0.5, 0)
      .setDepth(211)
      .setStroke('#2a1c12', 5);
    const hint = this.scene.add
      .text(SCREEN_W / 2, SCREEN_H - 18, `${keyLabel(cfg.p1.Left)} / ${keyLabel(cfg.p1.Right)} 切分类   ${keyLabel(cfg.p1.Up)} / ${keyLabel(cfg.p1.Down)} 翻页   ${keyLabel(cfg.p1.B)} / Esc 关闭   手柄方向键同样可用`, {
        fontFamily: UI.font,
        fontSize: '13px',
        color: UI.dim,
      })
      .setOrigin(0.5)
      .setDepth(211);
    this.nodes.push(bg, title, hint);
    MOVE_GROUPS.forEach((group, i) => {
      const tab = this.scene.add.text(126 + i * 236, 69, group.label, {
        fontFamily: UI.font, fontSize: '18px', color: i === this.groupIndex ? UI.title : UI.dim,
        backgroundColor: i === this.groupIndex ? '#303043' : '#111927', padding: { x: 14, y: 5 },
      }).setOrigin(0.5).setDepth(211).setInteractive({ useHandCursor: true });
      tab.on('pointerdown', () => { this.groupIndex = i; this.page = 0; this.draw(); });
      this.nodes.push(tab);
    });
    const cols: [FighterDef, KeyBinding, boolean, number][] = [
      [this.defs[0], cfg.p1, this.facing[0], 28],
      [this.defs[1], cfg.p2, this.facing[1], SCREEN_W / 2 + 16],
    ];
    for (const [player, [def, bind, face, x]] of cols.entries()) {
      const rows = movesInGroup(def, MOVE_GROUPS[this.groupIndex]!.id);
      const head = this.scene.add
        .text(x, 101, `P${player + 1} ${def.name} ${face ? '→' : '←'}   ${rows.length}招`, { fontFamily: UI.font, fontSize: '16px', color: UI.accent, fontStyle: 'bold' })
        .setDepth(211);
      const keys = this.scene.add.text(x, 123, `方向 ↑${keyLabel(bind.Up)}  ↓${keyLabel(bind.Down)}  ←${keyLabel(bind.Left)}  →${keyLabel(bind.Right)}   + 表示同时按`, {
        fontFamily: UI.font, fontSize: '12px', color: UI.dim,
      }).setDepth(211);
      this.nodes.push(head, keys);
      const pageRows = rows.slice(this.page * MOVES_PER_PAGE, (this.page + 1) * MOVES_PER_PAGE);
      pageRows.forEach((move, i) => this.drawMove(move, bind, face, x, 147 + i * 33, player as 0 | 1));
      if (!pageRows.length) {
        this.nodes.push(this.scene.add.text(x, 163, rows.length ? '本角色的招式已在前页列出' : '本角色无此类招式', {
          fontFamily: UI.font, fontSize: '15px', color: UI.dim,
        }).setDepth(211));
      }
    }
    const pages = this.pageCount();
    const footer = this.scene.add.text(SCREEN_W / 2, 489, `${MOVE_GROUPS[this.groupIndex]!.label}   ${this.page + 1} / ${pages} 页   箭头按当前朝向显示`, {
      fontFamily: UI.font, fontSize: '13px', color: UI.accent,
    }).setOrigin(0.5).setDepth(211);
    this.nodes.push(footer);
    if (pages > 1) {
      for (const offset of [-1, 1]) {
        const control = this.scene.add.text(SCREEN_W / 2 + offset * 300, 489, offset === -1 ? '◀ 上页' : '下页 ▶', {
          fontFamily: UI.font, fontSize: '14px', color: UI.title,
        }).setOrigin(0.5).setDepth(211).setInteractive({ useHandCursor: true });
        control.on('pointerdown', () => { this.page = (this.page + offset + pages) % pages; this.draw(); });
        this.nodes.push(control);
      }
    }
    const group = layoutGroup(this.scene, [...this.nodes], 210);
    this.nodes.length = 0;
    this.nodes.push(group);
  }

  private drawMove(move: MoveData, bind: KeyBinding, face: boolean, x: number, y: number, player: 0 | 1): void {
    const name = this.scene.add.text(x, y, move.name, { fontFamily: UI.font, fontSize: '15px', color: UI.text }).setDepth(211);
    const properties = this.scene.add.text(x + 416, y + 1, moveProperties(move), {
      fontFamily: UI.font, fontSize: '12px', color: UI.dim,
    }).setOrigin(1, 0).setDepth(211);
    const command = this.scene.add.text(x, y + 17, moveCommand(move, bind, face, this.modes[player], this.defs[player].skillSlots), {
      fontFamily: UI.font, fontSize: '13px', color: UI.title,
    }).setDepth(211);
    this.nodes.push(name, properties, command);
  }
}
