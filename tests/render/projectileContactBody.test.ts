import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import {
  Btn, FightSim, SUBPIXEL, px, toWorldBox,
  type FighterDef, type HitEvent, type InputFrame, type ProjectileState,
} from '../../src/core';
import { luffyDef, twinkleDef } from '../../src/characters';
import { SkillEffects } from '../../src/render/fx/SkillEffects';
import { endedProjectileVisual, PROJECTILE_PRESENTATIONS } from '../../src/render/fx/movePresentation';
import { RENDER_SCALE } from '../../src/render/screen';

const waveId = 'sp_shining_wave';
const waveKind = 'twinkle_shining_wave';
const screen = (value: number) => value / SUBPIXEL * RENDER_SCALE;

class ImageRecord {
  key = ''; frame = ''; x = 0; y = 0; width = 0; height = 0;
  visible = true; flip = false; alpha = 1; tint: number | null = null;
  setTexture(key: string, frame: string) { this.key = key; this.frame = frame; return this; }
  setVisible(value: boolean) { this.visible = value; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setOrigin(_x: number, _y: number) { return this; }
  setDisplaySize(width: number, height: number) { this.width = width; this.height = height; return this; }
  setFlipX(value: boolean) { this.flip = value; return this; }
  setAlpha(value: number) { this.alpha = value; return this; }
  setDepth(_value: number) { return this; }
  clearTint() { this.tint = null; return this; }
  setTint(value: number) { this.tint = value; return this; }
}

function renderer() {
  const images: ImageRecord[] = [];
  const scene = {
    textures: { exists: () => true, get: () => ({ has: () => true }) },
    add: { image: () => { const image = new ImageRecord(); images.push(image); return image; } },
  } as unknown as Phaser.Scene;
  const effects = new SkillEffects(scene);
  const draw = () => {
    effects.begin();
    effects.finish(screen, screen);
    return images.filter(image => image.visible);
  };
  return { effects, draw, waves: () => draw().filter(image => image.frame === 'wave') };
}

function fight(distance = 120, facing: 1 | -1 = 1, opponent: FighterDef = luffyDef) {
  const sim = new FightSim({ p1: twinkleDef, p2: opponent, controlModes: ['simple', 'simple'], introFrames: 0, roundTime: -1 });
  const [a, b] = sim.state.fighters;
  a.x = px(-distance / 2) * facing; b.x = -a.x;
  a.facing = facing; b.facing = facing === 1 ? -1 : 1; a.meter = 100;
  return sim;
}

/** Capture real pre-step values, never references that reflection can mutate underneath the renderer. */
function untilWaveEnds(sim: FightSim, input: (tick: number) => InputFrame) {
  const hits: HitEvent[] = [];
  let wasEverLive = false;
  let beforeReflection: ProjectileState | undefined;
  for (let tick = 0; tick < 160; tick++) {
    const previous = new Map<number, ProjectileState>();
    for (const projectile of sim.state.projectiles) previous.set(projectile.id, { ...projectile });
    sim.step(input(tick));
    hits.push(...sim.hits);
    if (sim.hits.some(event => event.kind === 'reflect' && event.moveId === waveId)) {
      beforeReflection = [...previous.values()].find(projectile => projectile.kind === waveKind);
    }
    wasEverLive ||= sim.state.projectiles.some(projectile => projectile.kind === waveKind);
    const end = sim.projectileEnds.find(event => event.kind === waveKind);
    if (end) return { sim, end, previous: previous.get(end.id), beforeReflection, hits, wasEverLive, ends: [...sim.projectileEnds] };
  }
  throw new Error('The real wave did not end within the bounded scenario');
}

describe('projectile contact body afterglow', () => {
  it.each([1, -1] as const)('draws a birth-step hit facing %s for eight ticks without creating another damage field', facing => {
    const result = untilWaveEnds(fight(120, facing), tick => ({ p1: tick === 0 ? Btn.Skill8 : 0, p2: 0 }));
    const { sim, end } = result;
    expect(end.reason).toBe('hit');
    expect(result.wasEverLive).toBe(false);
    expect(result.previous).toBeUndefined();
    expect(sim.state.projectiles).toHaveLength(0);
    expect(result.hits.filter(event => event.kind === 'hit').map(event => event.damage)).toEqual([186]);

    const pose = endedProjectileVisual(end, sim.state, twinkleDef.moves);
    expect(pose).toBeDefined();
    const { effects, waves } = renderer();
    const stateBeforeDrawing = JSON.stringify(sim.state);
    for (const hit of sim.hits) effects.contact(hit, sim.state);
    effects.projectileEnd(end, pose);
    const first = waves();
    expect(first).toHaveLength(1);
    const image = first[0]!;
    const box = toWorldBox(pose!.box, end.x, end.y, facing);
    const style = PROJECTILE_PRESENTATIONS[waveKind]!;
    expect(image).toMatchObject({ key: 'fx-twinkle', frame: 'wave', flip: facing === -1, tint: null });
    expect(image.x).toBe(screen(box.x + box.w / 2));
    expect(image.y).toBe(screen(box.y + box.h / 2));
    expect(image.width).toBeCloseTo(screen(box.w) * style.widthScale);
    expect(image.height).toBeCloseTo(screen(box.h) * style.heightScale);
    const size = [image.width, image.height];

    // Render-only redraws do not age the afterglow or mutate the deterministic world.
    for (let redraw = 0; redraw < 3; redraw++) expect(waves()).toHaveLength(1);
    expect(JSON.stringify(sim.state)).toBe(stateBeforeDrawing);
    const hpAfterContact = sim.state.fighters[1].hp;
    const laterHits: HitEvent[] = [];
    for (let age = 1; age <= 8; age++) {
      effects.tick(); sim.step({ p1: 0, p2: 0 }); laterHits.push(...sim.hits);
      const visible = waves();
      if (age < 8) {
        expect(visible).toHaveLength(1);
        expect([visible[0]!.width, visible[0]!.height]).toEqual(size);
      } else expect(visible).toHaveLength(0);
      expect(sim.state.projectiles).toHaveLength(0);
      expect(sim.state.fighters[1].hp).toBe(hpAfterContact);
    }
    for (let tick = 0; tick < 100; tick++) {
      sim.step({ p1: 0, p2: 0 }); laterHits.push(...sim.hits);
    }
    expect(laterHits.some(event => event.projectile && event.kind === 'hit')).toBe(false);
    expect(sim.state.fighters[1].hp).toBe(luffyDef.maxHp - 186);
  });

  it('also displays the real wave body on a birth-step block without damaging the defender', () => {
    const result = untilWaveEnds(fight(), tick => ({ p1: tick === 0 ? Btn.Skill8 : 0, p2: Btn.Right }));
    expect(result.end.reason).toBe('block');
    expect(result.previous).toBeUndefined();
    expect(result.sim.state.fighters[1].hp).toBe(luffyDef.maxHp);
    const { effects, waves } = renderer();
    effects.projectileEnd(result.end, endedProjectileVisual(result.end, result.sim.state, twinkleDef.moves));
    expect(waves()).toHaveLength(1);
  });

  it('uses the actual last geometry on a clash, while the ordinary star does not acquire a contact body', () => {
    const result = untilWaveEnds(fight(280, 1, twinkleDef), tick => ({
      p1: tick === 0 ? Btn.Skill8 : 0, p2: tick === 0 ? Btn.Skill1 : 0,
    }));
    expect(result.end.reason).toBe('clash');
    expect(result.previous).toBeDefined();
    // No declared source is supplied: this must use the real live projectile snapshot.
    const pose = endedProjectileVisual(result.end, result.sim.state, [], result.previous);
    expect(pose?.box).toEqual(result.previous!.box);
    const { effects, draw } = renderer();
    for (const end of result.ends) {
      effects.projectileEnd(end, endedProjectileVisual(end, result.sim.state, twinkleDef.moves, end.id === result.end.id ? result.previous : undefined));
    }
    expect(draw().map(image => image.frame)).toEqual(['wave']);
    expect(result.sim.state.projectiles).toHaveLength(0);
    expect(result.hits.some(event => event.kind === 'hit')).toBe(false);
  });

  it('retains a truly reflected wave direction and tint, including an older owner snapshot', () => {
    const result = untilWaveEnds(fight(230), tick => ({
      p1: tick === 0 ? Btn.Skill8 : 0, p2: tick === 0 ? Btn.Skill5 : 0,
    }));
    expect(result.hits.some(event => event.kind === 'reflect')).toBe(true);
    expect(result.end).toMatchObject({ reason: 'hit', owner: 1 });
    expect(result.beforeReflection).toMatchObject({ owner: 0, facing: 1, reflected: false });
    const current = endedProjectileVisual(result.end, result.sim.state, [], result.previous);
    const changedOwner = endedProjectileVisual(result.end, result.sim.state, [], result.beforeReflection);
    expect(current).toMatchObject({ facing: -1, reflected: true });
    expect(changedOwner).toEqual(current);
    const { effects, waves } = renderer();
    effects.projectileEnd(result.end, current);
    expect(waves()).toHaveLength(1);
    expect(waves()[0]).toMatchObject({ key: 'fx-twinkle', frame: 'wave', flip: true, tint: 0x89dfff });
    expect(result.sim.state.projectiles).toHaveLength(0);
    expect(result.hits.filter(event => event.kind === 'hit')).toHaveLength(1);
  });

  it('clears an existing afterglow and does not create one from an actual position reset', () => {
    const contact = untilWaveEnds(fight(), tick => ({ p1: tick === 0 ? Btn.Skill8 : 0, p2: 0 }));
    const { effects, waves } = renderer();
    effects.projectileEnd(contact.end, endedProjectileVisual(contact.end, contact.sim.state, twinkleDef.moves));
    expect(waves()).toHaveLength(1);

    const sim = fight(300);
    let previous: ProjectileState | undefined;
    for (let tick = 0; tick < 30 && !previous; tick++) {
      sim.step({ p1: tick === 0 ? Btn.Skill8 : 0, p2: 0 });
      const live = sim.state.projectiles.find(projectile => projectile.kind === waveKind);
      if (live) previous = { ...live };
    }
    expect(previous).toBeDefined();
    sim.resetPositions();
    const reset = sim.projectileEnds.find(event => event.kind === waveKind)!;
    expect(reset.reason).toBe('position_reset');
    effects.clear();
    effects.projectileEnd(reset, endedProjectileVisual(reset, sim.state, twinkleDef.moves, previous));
    for (let tick = 0; tick < 10; tick++) { effects.tick(); expect(waves()).toHaveLength(0); }
    expect(sim.state.projectiles).toHaveLength(0);
  });
});
