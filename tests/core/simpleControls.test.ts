import { describe, expect, it } from 'vitest';
import { Btn, FightSim, SKILL_BUTTONS, px, type ControlMode, type Facing, type FighterDef } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

const empty = { p1: 0, p2: 0 };
function make(def: FighterDef = luffyDef, mode: ControlMode = 'simple', facing: Facing = 1) {
  const sim = new FightSim({ p1: def, p2: def === luffyDef ? akainuDef : luffyDef, controlModes: [mode, 'classic'], introFrames: 0, roundTime: -1 });
  const [me, opponent] = sim.state.fighters;
  me.x = px(-65) * facing; opponent.x = px(65) * facing;
  me.facing = facing; opponent.facing = facing === 1 ? -1 : 1;
  me.meter = 300;
  return sim;
}

function direction(digit: string, facing: Facing): number {
  const forward = facing === 1 ? Btn.Right : Btn.Left;
  const backward = facing === 1 ? Btn.Left : Btn.Right;
  return ({ '2': Btn.Down, '3': Btn.Down | forward, '6': forward, '4': backward, '1': Btn.Down | backward, '5': 0 } as Record<string, number>)[digit] ?? 0;
}

// The only expected difference at the attack edge is its physical input bit.
const combatState = (sim: FightSim) => JSON.parse(JSON.stringify(sim.state, (key, value) =>
  key === 'def' ? (value as FighterDef).id : key === 'bits' || key === 'prevBits' ? (value as number) & 15 : value));

describe('all eighteen one-key skills', () => {
  for (const def of [luffyDef, akainuDef]) {
    for (const [slot, id] of def.skillSlots!.entries()) {
      const move = def.moves.find(m => m.id === id)!;
      for (const facing of [1, -1] as const) {
        it(`${def.id}/${id}, facing ${facing}: one key from stand/crouch, exact cost, no motion required`, () => {
          for (const crouch of [false, true]) {
            const sim = make(def, 'simple', facing);
            sim.step({ p1: SKILL_BUTTONS[slot]! | (crouch ? Btn.Down : 0), p2: 0 });
            expect(sim.state.fighters[0].moveId).toBe(id);
            expect(sim.state.fighters[0].meter).toBe(300 - (move.meterCost ?? 0));
            expect(sim.skillFeedback[0]?.reason).toBe('ready');
          }
        });

        it(`${def.id}/${id}, facing ${facing}: classic and shortcut produce identical combat after the same legal frame`, () => {
          const classic = make(def, 'classic', facing);
          const simple = make(def, 'simple', facing);
          const digits = move.input.motion === '22' ? '252' : move.input.motion!;
          for (const digit of digits.slice(0, -1)) {
            const input = { p1: direction(digit, facing), p2: 0 };
            classic.step(input); simple.step(input);
          }
          const lastDirection = direction(digits.at(-1)!, facing);
          const button = move.input.button & -move.input.button;
          classic.step({ p1: lastDirection | button, p2: 0 });
          simple.step({ p1: lastDirection | SKILL_BUTTONS[slot]!, p2: 0 });
          expect(classic.state.fighters[0].moveId).toBe(id);
          expect(combatState(simple)).toEqual(combatState(classic));
          for (let tick = 0; tick < 180; tick++) {
            classic.step(empty); simple.step(empty);
            expect(combatState(simple)).toEqual(combatState(classic));
            expect(simple.hits).toEqual(classic.hits);
            expect(simple.projectileEnds).toEqual(classic.projectileEnds);
          }
        });
      }

      it(`${def.id}/${id}: airborne rejection and insufficient meter never downgrade`, () => {
        const sim = make(def);
        const me = sim.state.fighters[0];
        me.airborne = true; me.y = px(-50); me.state = 'jump_neutral';
        expect(sim.skillAvailability(0, slot).reason).toBe('air');
        sim.step({ p1: SKILL_BUTTONS[slot]! | Btn.A, p2: 0 });
        expect(me.moveInstance).toBe(0);
        expect(sim.skillFeedback[0]?.reason).toBe('air');
        if (move.meterCost) {
          const poor = make(def);
          poor.state.fighters[0].meter = move.meterCost - 1;
          poor.step({ p1: SKILL_BUTTONS[slot]! | Btn.A | Btn.B, p2: 0 });
          expect(poor.state.fighters[0].moveInstance).toBe(0);
          expect(poor.state.fighters[0].state).toBe('idle');
          expect(poor.skillFeedback[0]?.reason).toBe('meter');
          for (let tick = 0; tick < 20; tick++) poor.step(empty);
          poor.state.fighters[0].meter = 300;
          poor.step(empty);
          expect(poor.state.fighters[0].moveInstance).toBe(0);
        }
      });
    }
  }
});

describe('simple control boundaries', () => {
  it('simple ignores motion recognition while classic still recognizes it', () => {
    for (const mode of ['classic', 'simple'] as const) {
      const sim = make(luffyDef, mode);
      for (const p1 of [Btn.Down, Btn.Down | Btn.Right, Btn.Right | Btn.A]) sim.step({ p1, p2: 0 });
      expect(sim.state.fighters[0].moveId).toBe(mode === 'simple' ? 'st_a' : 'sp_gatling');
    }
  });

  it('no mode means classic; shortcut bits cannot issue a move', () => {
    const sim = new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0 });
    sim.step({ p1: Btn.Skill1, p2: Btn.Skill1 });
    expect(sim.controlModes).toEqual(['classic', 'classic']);
    expect(sim.state.fighters.map(f => f.moveInstance)).toEqual([0, 0]);
  });

  it('mixed players use independent input rules, so CPU/classic specials remain available', () => {
    const sim = make();
    for (const p2 of [Btn.Down, Btn.Down | Btn.Left]) sim.step({ p1: 0, p2 });
    sim.step({ p1: Btn.Skill1, p2: Btn.Left | Btn.A });
    expect(sim.state.fighters.map(f => f.moveId)).toEqual(['sp_gatling', 'sp_daifunka']);
  });

  it('first slot wins simultaneous keys, ahead of ordinary punch/roll; holding does not repeat', () => {
    const sim = make();
    for (let tick = 0; tick < 240; tick++) sim.step({ p1: Btn.Skill1 | Btn.Skill9 | Btn.A | Btn.B, p2: 0 });
    expect(sim.state.fighters[0].moveInstance).toBe(1);
  });

  it('early recovery buffers expire and do not run after recovery', () => {
    const sim = make();
    sim.state.fighters[1].x = px(220);
    sim.step({ p1: Btn.C, p2: 0 });
    sim.step({ p1: Btn.Skill1, p2: 0 });
    expect(sim.skillFeedback[0]?.reason).toBe('cancel');
    for (let tick = 0; tick < 80; tick++) sim.step(empty);
    expect(sim.state.fighters[0].moveInstance).toBe(1);
    expect(sim.state.fighters[0].buffered).toBeNull();
  });

  for (const blocked of [false, true]) {
    it(`short skill tap during ${blocked ? 'block' : 'hit'} stop survives until a legal cancel`, () => {
      const sim = make();
      const [me, other] = sim.state.fighters;
      me.x = px(-20); other.x = px(20);
      const p2 = blocked ? Btn.Right : 0;
      sim.step({ p1: Btn.C | Btn.D, p2 });
      for (let tick = 0; tick < 60 && !me.hasHit; tick++) sim.step({ p1: 0, p2 });
      expect(me.hasHit).toBe(true);
      expect(me.hitstop).toBeGreaterThan(0);
      sim.step({ p1: Btn.Skill1, p2 });
      for (let tick = 0; tick < 30 && me.moveId !== 'sp_gatling'; tick++) sim.step({ p1: 0, p2 });
      expect(me.moveId).toBe('sp_gatling');
    });
  }

  it('hurt stun cannot be bypassed and resetting clears old skill feedback', () => {
    const sim = make();
    const me = sim.state.fighters[0];
    me.state = 'hit_stand'; me.stun = 12;
    sim.step({ p1: Btn.Skill9, p2: 0 });
    expect(sim.skillFeedback[0]?.reason).toBe('recovery');
    for (let tick = 0; tick < 16; tick++) sim.step(empty);
    expect(me.moveInstance).toBe(0);
    sim.resetMatch();
    expect(sim.skillFeedback).toEqual([null, null]);
  });

  it('pause/focus flush discards a skill buffered in hitstop without cancelling the current move', () => {
    const sim = make();
    const [me, other] = sim.state.fighters;
    me.x = px(-20); other.x = px(20);
    sim.step({ p1: Btn.C | Btn.D, p2: 0 });
    for (let tick = 0; tick < 60 && !me.hasHit; tick++) sim.step(empty);
    expect(me.hitstop).toBeGreaterThan(0);
    sim.step({ p1: Btn.Skill1, p2: 0 });
    expect(me.buffered?.skillSlot).toBe(0);
    const frame = me.stateFrame;
    sim.clearInputs();
    expect(me.moveId).toBe('cd');
    expect(me.stateFrame).toBe(frame);
    expect(me.buffered).toBeNull();
    for (let tick = 0; tick < 80; tick++) sim.step(empty);
    expect(me.moveInstance).toBe(1);
  });

  it('invalid/missing slots are data errors, not an arbitrary fallback', () => {
    const sim = make({ ...luffyDef, skillSlots: ['not_a_move'] });
    expect(sim.skillAvailability(0, 0).reason).toBe('missing');
    expect(sim.skillAvailability(0, -1).reason).toBe('missing');
    sim.step({ p1: Btn.Skill1 | Btn.A, p2: 0 });
    expect(sim.state.fighters[0].moveInstance).toBe(0);
  });
});
