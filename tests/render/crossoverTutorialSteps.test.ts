import { describe, expect, it } from 'vitest';
import { Btn, FightSim, px, type HitEvent } from '../../src/core';
import { Dummy } from '../../src/ai/dummy';
import { defaultKeyConfig } from '../../src/input/keymap';
import { labubuDef, twinkleDef } from '../../src/characters';
import { TutorialProgress, tutorialInstruction, tutorialSpecial, tutorialStepDone } from '../../src/render/ui/tutorialSteps';

const hit = (moveId: string): HitEvent => ({
  frame: 1, kind: 'hit', attacker: 0, defender: 1, moveId,
  damage: 30, counter: false, comboHits: 1, comboDamage: 30, projectile: false, x: 0, y: 0,
});

describe('crossover tutorial configuration', () => {
  it('maps both real representative skills and rejects an unknown character explicitly', () => {
    expect(tutorialSpecial('labubu')).toEqual({ moveId: 'sp_pounce_rush', name: '扑扑突袭' });
    expect(tutorialSpecial('twinkle')).toEqual({ moveId: 'sp_tiny_star', name: '小星弹' });
    expect(() => tutorialSpecial('missing')).toThrow('未知教学角色：missing');
    expect(tutorialStepDone('special', { p1Bits: 0, p1State: 'attack', p1MoveId: 'sp_pounce_rush', p1CharId: 'labubu', p2ComboHits: 0, events: [hit('sp_pounce_rush')] })).toBe(true);
  });

  it('uses each new fighter name in classic and one-key instructions', () => {
    const keys = defaultKeyConfig();
    keys.p1.Skill1 = 'KeyT';
    expect(tutorialInstruction('special', 'labubu', keys, 1)).toContain('扑扑突袭');
    expect(tutorialInstruction('special', 'twinkle', keys, -1, 'simple')).toContain('按 T 小星弹');
  });

  for (const [fighter, opponent] of [[labubuDef, twinkleDef], [twinkleDef, labubuDef]] as const) {
    it(`${fighter.id} completes all six tutorial steps through real input and collision`, () => {
      const sim = new FightSim({ p1: fighter, p2: opponent, introFrames: 0, roundTime: -1 });
      sim.training = { infiniteHp: true, infiniteMeter: true };
      const progress = new TutorialProgress();
      const dummy = new Dummy();
      const tick = (p1Bits: number, p2Bits = 0) => {
        sim.step({ p1: p1Bits, p2: p2Bits });
        const me = sim.state.fighters[0];
        progress.tick({
          p1Bits, p1State: me.state, p1MoveId: me.moveId, p1CharId: fighter.id,
          p2ComboHits: sim.state.fighters[1].comboHits, events: sim.hits,
        });
      };
      const close = () => {
        sim.resetPositions();
        const contact = (fighter.pushboxStand[2] + opponent.pushboxStand[2]) / 2;
        sim.state.fighters[0].x = px(-contact / 2);
        sim.state.fighters[1].x = px(contact / 2);
      };

      for (let frame = 0; frame < 24; frame++) tick(Btn.Right);
      expect(progress.stepId).toBe('light');
      close(); tick(Btn.A); for (let frame = 0; frame < 45; frame++) tick(0);
      expect(progress.stepId).toBe('heavy');
      close(); tick(Btn.C); for (let frame = 0; frame < 60; frame++) tick(0);
      expect(progress.stepId).toBe('block');
      sim.resetPositions(); dummy.mode = 'attack';
      for (let frame = 0; frame < 1500 && progress.stepId === 'block'; frame++) tick(Btn.Left, dummy.input(sim, 1)!);
      expect(progress.stepId).toBe('special');
      close(); tick(Btn.Down); tick(Btn.Down | Btn.Right); tick(Btn.Right | Btn.A);
      for (let frame = 0; frame < 120 && progress.stepId === 'special'; frame++) tick(0);
      expect(progress.stepId).toBe('combo');
      close(); tick(Btn.A);
      for (let frame = 0; frame < 20 && !sim.state.fighters[0].hasHit; frame++) tick(0);
      expect(sim.state.fighters[0].hasHit).toBe(true);
      tick(Btn.C); for (let frame = 0; frame < 45; frame++) tick(0);
      expect(progress.stepId).toBe(null);
    });
  }
});
