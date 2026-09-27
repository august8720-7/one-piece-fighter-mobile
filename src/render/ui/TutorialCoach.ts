import Phaser from 'phaser';
import type { FightSim, ControlMode } from '@core/index';
import { getInputHub } from '@input/InputHub';
import { LAYOUT_W as SCREEN_W } from '../screen';
import { layoutGroup } from './layoutGroup';
import { UI } from './MenuList';
import { TUTORIAL_STEPS, TutorialProgress, tutorialInstruction } from './tutorialSteps';

const storage = (mode: ControlMode): string => mode === 'classic' ? 'opf.tutorial.v3' : 'opf.tutorial.simple.v1';
export function tutorialDone(mode: ControlMode = 'classic'): boolean {
  try { return globalThis.localStorage?.getItem(storage(mode)) === 'complete'; } catch { return false; }
}
export function tutorialDismissed(mode: ControlMode = 'classic'): boolean {
  try { return ['complete', 'skipped'].includes(globalThis.localStorage?.getItem(storage(mode)) ?? ''); } catch { return false; }
}
function saveTutorial(result: 'complete' | 'skipped', mode: ControlMode): void {
  try {
    if (!tutorialDone(mode)) globalThis.localStorage?.setItem(storage(mode), result);
  } catch { /* 隐私模式不影响练习 */ }
}

/** 教学只观察输入与命中事件，不修改格斗状态。 */
export class TutorialCoach {
  private readonly box: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly skipButton: Phaser.GameObjects.Text;
  private readonly progress = new TutorialProgress();
  private feedbackFrames = 0;
  active = true;
  get stepId(): (typeof TUTORIAL_STEPS)[number] | null { return this.active ? this.progress.stepId : null; }

  constructor(scene: Phaser.Scene, private readonly p1CharId: string, private readonly onComplete: () => void, private readonly mode: ControlMode = 'classic') {
    this.box = scene.add.rectangle(SCREEN_W / 2, 111, 760, 100, 0x0b1220, 0.94).setDepth(70).setStrokeStyle(2, 0xc9a227);
    this.title = scene.add.text(SCREEN_W / 2, 76, '', { fontFamily: UI.font, fontSize: '18px', color: UI.title, fontStyle: 'bold' }).setOrigin(0.5).setDepth(71);
    this.body = scene.add.text(SCREEN_W / 2, 107, '', { fontFamily: UI.font, fontSize: '16px', color: UI.text }).setOrigin(0.5).setDepth(71);
    this.status = scene.add.text(SCREEN_W / 2, 137, '', { fontFamily: UI.font, fontSize: '13px', color: '#a0dfbd' }).setOrigin(0.5).setDepth(71);
    this.skipButton = scene.add.text(SCREEN_W / 2 + 362, 73, '跳过 F12', { fontFamily: UI.font, fontSize: '13px', color: UI.dim }).setOrigin(1, 0.5).setDepth(72).setInteractive({ useHandCursor: true });
    this.skipButton.on('pointerdown', () => this.skip());
    layoutGroup(scene, [this.box, this.title, this.body, this.status, this.skipButton], 70);
    this.refresh(1);
  }
  skip(): void {
    if (!this.active) return;
    this.active = false;
    saveTutorial('skipped', this.mode);
    this.hide();
  }
  tick(sim: FightSim, p1: number): void {
    if (!this.active || sim.state.phase !== 'fight') return;
    const f = sim.state.fighters[0];
    const advanced = this.progress.tick({ p1Bits: p1, p1State: f.state, p1MoveId: f.moveId, p1CharId: this.p1CharId, p2ComboHits: sim.state.fighters[1].comboHits, events: sim.hits });
    if (advanced) {
      this.feedbackFrames = 90;
      if (!this.progress.stepId) {
        this.active = false;
        saveTutorial('complete', this.mode);
        // The completion callback opens the challenge menu; keep one clear completion heading.
        this.hide();
        this.onComplete();
        return;
      }
    }
    if (this.feedbackFrames > 0) this.feedbackFrames--;
    this.refresh(f.facing);
  }
  private hide(): void {
    for (const obj of [this.box, this.title, this.body, this.status, this.skipButton]) obj.setVisible(false);
  }
  private refresh(facing: 1 | -1): void {
    const step = this.progress.stepId;
    if (!step) return;
    const names = { walk: '移动', light: '轻拳', heavy: '重拳', block: '防御', special: '特殊技', combo: '短连段' };
    this.title.setText(`${TUTORIAL_STEPS.indexOf(step) + 1}/${TUTORIAL_STEPS.length} ${names[step]}`);
    this.body.setText(tutorialInstruction(step, this.p1CharId, getInputHub().keyConfig, facing, this.mode));
    this.status.setText(this.feedbackFrames > 0 ? '上一步完成 ✓' : step === 'combo' ? '如果断连，等对手站稳，再从轻拳开始' : '按 Esc 可暂停、改键或查看完整出招表');
  }
}
