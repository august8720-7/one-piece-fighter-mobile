import { describe, expect, it } from 'vitest';
import { Btn, FightSim, MAX_SEPARATION, SUBPIXEL } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import type { FrameAttachments } from '../../src/render/animations';
import { fitFightFraming, frameFramingBounds, unionFightBounds, type FightFraming } from '../../src/render/fightFraming';

// Exact geometry from the recorded A1A8 candidate. Numerical bounds do not require local copyrighted images.
const recovery: FrameAttachments = {
  size: { width: 427, height: 268 }, root: { x: 168.79512415349888, y: 262.48234762979683 }, sockets: {},
};
const knockedDown: FrameAttachments = {
  size: { width: 509, height: 173 }, root: { x: 234.94212189616255, y: 163.3581941309255 }, sockets: {},
};

describe('art-aware fight framing without physics changes', () => {
  it.each([0, 1] as const)('keeps both full bodies after a real giant-pistol knockdown by player %s at both quality settings', player => {
    const sim = new FightSim({ p1: player === 0 ? luffyDef : akainuDef, p2: player === 0 ? akainuDef : luffyDef, seed: 1, introFrames: 0, roundTime: -1 });
    sim.training = { infiniteHp: false, infiniteMeter: true };
    const back = player === 0 ? Btn.Left : Btn.Right;
    for (const bits of [Btn.Down, Btn.Down | back, back, Btn.Down, Btn.Down | back, back | Btn.A]) {
      sim.step(player === 0 ? { p1: bits, p2: 0 } : { p1: 0, p2: bits });
    }
    const attacker = sim.state.fighters[player], victim = sim.state.fighters[player === 0 ? 1 : 0];
    expect(attacker.moveId).toBe('sp_gigant_pistol');
    for (let tick = 0; tick < 120 && victim.state !== 'knockdown'; tick++) sim.step({ p1: 0, p2: 0 });
    expect(victim.state).toBe('knockdown');
    expect(victim.hp).toBe(victim.def.maxHp - 300);
    expect(Math.abs(attacker.x - victim.x)).toBe(MAX_SEPARATION);
    const before = JSON.stringify(sim.state);
    const normalized = [];
    for (const renderScale of [2, 4]) {
      const width = 480 * renderScale, groundY = 230 * renderScale, margin = 12 * renderScale;
      const geometry = [
        frameFramingBounds(recovery, width / 2 + (attacker.x - sim.state.cameraX) / SUBPIXEL * renderScale, groundY, attacker.facing, renderScale / 4),
        frameFramingBounds(knockedDown, width / 2 + (victim.x - sim.state.cameraX) / SUBPIXEL * renderScale, groundY, victim.facing, renderScale / 4),
      ];
      const bounds = unionFightBounds(geometry)!;
      expect(bounds.left < 0 || bounds.right > width).toBe(true); // Reproduced crop in the original fixed view.
      const fitted = fitFightFraming(bounds, { width, groundY, top: 38 * renderScale, sideMargin: margin });
      expect(fitted.zoom).toBeLessThan(1);
      expect(fitted.zoom).toBeGreaterThan(0.8);
      for (const box of geometry) {
        expect(box.left * fitted.zoom + fitted.offsetX).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(box.right * fitted.zoom + fitted.offsetX).toBeLessThanOrEqual(width - margin + 1e-6);
      }
      expect(groundY * fitted.zoom + fitted.offsetY).toBeCloseTo(groundY);
      normalized.push([fitted.zoom, fitted.offsetX / renderScale, fitted.offsetY / renderScale]);
    }
    expect(normalized[0]).toEqual(normalized[1]);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('mirrors an asymmetric drawing around its explicit root, including roots outside the cropped frame', () => {
    const frame = { size: { width: 200, height: 100 }, root: { x: 30, y: 140 }, sockets: {} };
    expect(frameFramingBounds(frame, 400, 500, 1, 2)).toEqual({ left: 340, right: 740, top: 220, bottom: 420 });
    expect(frameFramingBounds(frame, 400, 500, -1, 2)).toEqual({ left: 60, right: 460, top: 220, bottom: 420 });
  });

  it('fits sudden wide poses immediately and eases back only with logical time, keeping the floor fixed', () => {
    const view = { width: 960, groundY: 460, top: 76, sideMargin: 24 };
    const normal = { left: 300, right: 650, top: 220, bottom: 460 };
    const wide = { left: -120, right: 1110, top: 100, bottom: 460 };
    let framing: FightFraming = fitFightFraming(normal, view);
    expect(framing.zoom).toBe(1);
    framing = fitFightFraming(wide, view, framing, 1);
    expect(wide.left * framing.zoom + framing.offsetX).toBeCloseTo(24);
    expect(wide.right * framing.zoom + framing.offsetX).toBeCloseTo(936);
    for (let render = 0; render < 200; render++) expect(fitFightFraming(normal, view, framing, 0)).toEqual(framing);
    const initialZoom = framing.zoom;
    for (let tick = 0; tick < 60; tick++) {
      framing = fitFightFraming(normal, view, framing, 1);
      expect(view.groundY * framing.zoom + framing.offsetY).toBeCloseTo(view.groundY);
    }
    expect(framing.zoom).toBeGreaterThan(initialZoom);
    expect(framing.zoom).toBeGreaterThan(0.99);
    expect(framing.zoom).toBeLessThan(1);
  });

  it('keeps high jump artwork below the fixed HUD without changing the logical altitude', () => {
    const view = { width: 960, groundY: 460, top: 76, sideMargin: 24 };
    const bounds = { left: 120, right: 750, top: -100, bottom: 460 };
    const fitted = fitFightFraming(bounds, view);
    expect(bounds.top * fitted.zoom + fitted.offsetY).toBeCloseTo(view.top);
    expect(view.groundY * fitted.zoom + fitted.offsetY).toBeCloseTo(view.groundY);
    expect(fitFightFraming(null, view)).toEqual({ zoom: 1, centerX: 480, offsetX: 0, offsetY: 0 });
  });
});
