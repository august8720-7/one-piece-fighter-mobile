import { Btn, type HitEvent, type ControlMode } from '@core/index';
import { keyLabel, type KeyConfig } from '@input/keymap';

export const TUTORIAL_STEPS = ['walk', 'light', 'heavy', 'block', 'special', 'combo'] as const;
export type TutorialStepId = (typeof TUTORIAL_STEPS)[number];
export const TUTORIAL_HOLD: Record<TutorialStepId, number> = { walk: 24, light: 1, heavy: 1, block: 1, special: 1, combo: 1 };

const SPECIAL_BY_CHAR: Record<string, { moveId: string; name: string }> = {
  luffy: { moveId: 'sp_gatling', name: '橡胶机关枪' },
  akainu: { moveId: 'sp_daifunka', name: '大喷火' },
  labubu: { moveId: 'sp_pounce_rush', name: '扑扑突袭' },
  twinkle: { moveId: 'sp_tiny_star', name: '小星弹' },
};
export function tutorialSpecial(charId: string): { moveId: string; name: string } {
  const special = SPECIAL_BY_CHAR[charId];
  if (!special) throw new Error(`未知教学角色：${charId}`);
  return special;
}
export interface TutorialContext {
  p1Bits: number;
  p1State: string;
  p1MoveId: string | null;
  p1CharId: string;
  p2ComboHits: number;
  events: readonly HitEvent[];
  comboStarted?: boolean;
}
export function tutorialStepDone(step: TutorialStepId, ctx: TutorialContext): boolean {
  const hits = ctx.events.filter((e) => e.attacker === 0 && e.kind === 'hit');
  if (step === 'walk') return (ctx.p1Bits & (Btn.Left | Btn.Right)) !== 0 && ['walk_fwd', 'walk_back'].includes(ctx.p1State);
  if (step === 'light') return hits.some((e) => e.moveId === 'st_a');
  if (step === 'heavy') return hits.some((e) => e.moveId === 'st_c');
  if (step === 'block') return ctx.events.some((e) => e.kind === 'block' && e.defender === 0);
  if (step === 'special') return hits.some(e => e.moveId === tutorialSpecial(ctx.p1CharId).moveId);
  return !!ctx.comboStarted && hits.some((e) => e.moveId === 'st_c' && e.comboHits >= 2);
}

/** 只认当前步骤实际发生的动作；旧连击和空挥不能完成教学。 */
export class TutorialProgress {
  private index = 0;
  private held = 0;
  private comboStarted = false;
  get stepId(): TutorialStepId | null { return TUTORIAL_STEPS[this.index] ?? null; }
  tick(ctx: TutorialContext): boolean {
    const step = this.stepId;
    if (!step) return false;
    if (step === 'combo') {
      if (ctx.p2ComboHits === 0) this.comboStarted = false;
      for (const e of ctx.events) {
        if (e.kind === 'hit' && e.attacker === 0 && e.comboHits === 1) this.comboStarted = e.moveId === 'st_a';
      }
    }
    this.held = tutorialStepDone(step, { ...ctx, comboStarted: this.comboStarted }) ? this.held + 1 : 0;
    if (this.held < TUTORIAL_HOLD[step]) return false;
    this.index++;
    this.held = 0;
    this.comboStarted = false;
    return true;
  }
}

export function tutorialInstruction(step: TutorialStepId, charId: string, keys: KeyConfig, facing: 1 | -1, mode: ControlMode = 'classic'): string {
  const k = keys.p1;
  const forward = keyLabel(facing === 1 ? k.Right : k.Left);
  const back = keyLabel(facing === 1 ? k.Left : k.Right);
  const down = keyLabel(k.Down), light = keyLabel(k.A), heavy = keyLabel(k.C);
  switch (step) {
    case 'walk': return `按住 ${forward} 走近对手，或 ${back} 后退`;
    case 'light': return `走到对手身边，按 ${light} 轻拳打中一次（空挥不算）`;
    case 'heavy': return `按 ${heavy} 重拳打中一次；打不到就再靠近一些`;
    case 'block': return `木桩会靠近出拳，按住 ${back} 后方向，成功挡住一次`;
    case 'special': if (mode === 'simple') return `走近对手，按 ${keyLabel(k.Skill1 ?? '')} ${tutorialSpecial(charId).name}打中一次（空挥不算）`; return `快速依次按 ${down} → ${down}+${forward} → ${forward}+${light}：${tutorialSpecial(charId).name}`;
    case 'combo': return `靠近后按 ${light}，轻拳打中立刻按 ${heavy}：轻拳 → 重拳连中两下`;
  }
}
