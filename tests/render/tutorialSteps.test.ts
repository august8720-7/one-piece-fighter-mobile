import { describe, expect, it } from 'vitest';
import { Btn, FightSim, px, type HitEvent } from '../../src/core';
import { luffyDef, akainuDef } from '../../src/characters';
import { Dummy } from '../../src/ai/dummy';
import { defaultKeyConfig } from '../../src/input/keymap';
import { TutorialProgress, tutorialInstruction, tutorialSpecial, tutorialStepDone, type TutorialContext } from '../../src/render/ui/tutorialSteps';

const ctx: TutorialContext = { p1Bits: 0, p1State: 'idle', p1MoveId: null, p1CharId: 'luffy', p2ComboHits: 0, events: [] };
const hit = (moveId: string, comboHits = 1): HitEvent => ({ frame: 1, kind: 'hit', attacker: 0, defender: 1, moveId, damage: 30, counter: false, comboHits, comboDamage: 30, projectile: false, x: 0, y: 0 });

describe('tutorialSteps', () => {
  it('空挥、后退和旧连击不冒充完成', () => {
    expect(tutorialStepDone('special', { ...ctx, p1State: 'attack', p1MoveId: 'sp_gatling' })).toBe(false);
    expect(tutorialStepDone('special', { ...ctx, events: [{ ...hit('sp_gatling'), kind: 'block' }] })).toBe(false);
    expect(tutorialStepDone('special', { ...ctx, events: [hit('sp_gatling')] })).toBe(true);
    expect(tutorialStepDone('light', { ...ctx, p1State: 'attack', p1MoveId: 'st_a' })).toBe(false);
    expect(tutorialStepDone('block', { ...ctx, p1State: 'walk_back', p1Bits: Btn.Left })).toBe(false);
    expect(tutorialStepDone('combo', { ...ctx, p1MoveId: 'st_c', p2ComboHits: 5 })).toBe(false);
    expect(tutorialStepDone('combo', { ...ctx, events: [hit('st_c', 2)] })).toBe(false);
    expect(tutorialStepDone('block', { ...ctx, events: [{ ...hit('st_a'), kind: 'block', attacker: 1, defender: 0 }] })).toBe(true);
  });
  it('方向按朝向镜像，并使用当前键位', () => {
    const keys = defaultKeyConfig(); keys.p1.A = 'KeyX';
    expect(tutorialInstruction('special', 'luffy', keys, 1)).toContain('S → S+D → D+X');
    expect(tutorialInstruction('special', 'luffy', keys, -1)).toContain('S → S+A → A+X');
    expect(tutorialSpecial('akainu').moveId).toBe('sp_daifunka');
    keys.p1.Skill1 = 'KeyT';
    expect(tutorialInstruction('special', 'luffy', keys, -1, 'simple')).toContain('按 T 橡胶机关枪打中一次');
  });
  for (const [p1, p2] of [[luffyDef, akainuDef], [akainuDef, luffyDef]]) {
    it(`${p1!.name} 通过真实输入和碰撞完成全部六步`, () => {
      const sim = new FightSim({ p1: p1!, p2: p2!, introFrames: 0, roundTime: -1 });
      sim.training = { infiniteHp: true, infiniteMeter: true };
      const progress = new TutorialProgress();
      const dummy = new Dummy();
      const tick = (p1Bits: number, p2Bits = 0) => {
        sim.step({ p1: p1Bits, p2: p2Bits });
        const f = sim.state.fighters[0];
        progress.tick({ p1Bits, p1State: f.state, p1MoveId: f.moveId, p1CharId: p1!.id, p2ComboHits: sim.state.fighters[1].comboHits, events: sim.hits });
      };
      for (let f = 0; f < 24; f++) tick(Btn.Right);
      expect(progress.stepId).toBe('light');
      const close = () => { sim.resetPositions(); sim.state.fighters[0].x = px(-20); sim.state.fighters[1].x = px(20); };
      close(); tick(Btn.A); for (let f = 0; f < 45; f++) tick(0);
      expect(progress.stepId).toBe('heavy');
      close(); tick(Btn.C); for (let f = 0; f < 60; f++) tick(0);
      expect(progress.stepId).toBe('block');
      sim.resetPositions(); dummy.mode = 'attack';
      for (let f = 0; f < 1500 && progress.stepId === 'block'; f++) tick(Btn.Left, dummy.input(sim, 1)!);
      expect(progress.stepId).toBe('special');
      close(); tick(Btn.Down); tick(Btn.Down | Btn.Right); tick(Btn.Right | Btn.A);
      expect(progress.stepId).toBe('special');
      for (let f = 0; f < 90 && progress.stepId === 'special'; f++) tick(0);
      expect(progress.stepId).toBe('combo');
      close(); tick(Btn.C); for (let f = 0; f < 60; f++) tick(0);
      expect(progress.stepId).toBe('combo');
      close(); tick(Btn.A);
      for (let f = 0; f < 20 && !sim.state.fighters[0].hasHit; f++) tick(0);
      expect(sim.state.fighters[0].hasHit).toBe(true);
      tick(Btn.C); for (let f = 0; f < 40; f++) tick(0);
      expect(progress.stepId).toBe(null);
    });
  }
});
