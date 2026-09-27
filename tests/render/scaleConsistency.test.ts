import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FightSim, SUBPIXEL, px } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => { vi.doUnmock('../../src/render/screen'); vi.resetModules(); });

async function scaleModules(scale: 2 | 4) {
  vi.resetModules();
  vi.doMock('../../src/render/screen', () => ({ RENDER_SCALE: scale, UI_SCALE: scale / 2, SCREEN_W: 480 * scale, SCREEN_H: 270 * scale, LAYOUT_W: 960, LAYOUT_H: 540 }));
  return {
    Marineford: (await import('../../src/render/stage/Marineford')).Marineford,
    Particles: (await import('../../src/render/fx/Particles')).Particles,
    SkillEffects: (await import('../../src/render/fx/SkillEffects')).SkillEffects,
  };
}

function sceneRecord(hasTextures = true) {
  const commands: { method: string; args: unknown[] }[] = [];
  const images: Record<string, unknown>[] = [];
  const graphic = new Proxy({}, { get: (_, property) => (...args: unknown[]) => { commands.push({ method: String(property), args }); return graphic; } });
  const image = (x: number, y: number) => {
    const record: Record<string, unknown> = { x, y };
    const proxy = new Proxy(record, {
      get: (target, property) => {
        if (typeof property === 'string' && property.startsWith('set')) return (...args: unknown[]) => { target[property] = args; return proxy; };
        if (property === 'clearTint') return () => proxy;
        return target[String(property)];
      },
      set: (target, property, value) => { target[String(property)] = value; return true; },
    });
    images.push(record);
    return proxy;
  };
  const scene = {
    textures: { exists: () => hasTextures, get: () => ({ has: () => hasTextures }) },
    add: { graphics: () => graphic, image, tileSprite: image },
  } as unknown as Phaser.Scene;
  return { scene, commands, images };
}

describe('display quality does not change stage or effect coverage', () => {
  it.each([{ art: 'anime', images: true }, { art: 'classic', images: true }, { art: 'anime', images: false }] as const)('$art stage (images=$images) retains exactly the same design-space drawing', async options => {
    const results = [];
    for (const scale of [2, 4] as const) {
      const { Marineford } = await scaleModules(scale), fixture = sceneRecord(options.images);
      const stage = new Marineford(fixture.scene, 212 * scale, options.art);
      stage.draw(px(120), 143);
      results.push({ ...fixture, unit: scale / 2 });
    }
    const [standard, high] = results;
    expect(high!.commands.filter(call => call.method !== 'setScale')).toEqual(standard!.commands.filter(call => call.method !== 'setScale'));
    expect(high!.commands.find(call => call.method === 'setScale')?.args).toEqual([2]);
    for (let i = 0; i < standard!.images.length; i++) {
      const before = standard!.images[i]!, after = high!.images[i]!;
      expect(Number(after.x) / 2).toBe(Number(before.x));
      if (before.setDisplaySize) expect((after.setDisplaySize as number[]).map(value => value / 2)).toEqual(before.setDisplaySize);
      if (before.setTileScale) expect((after.setTileScale as number[]).map(value => value / 2)).toEqual(before.setTileScale);
      if (before.tilePositionX !== undefined) expect(after.tilePositionX).toBe(before.tilePositionX);
    }
  });

  it('particle travel, gravity, spread and radius remain identical after normalization', async () => {
    const results = [];
    for (const scale of [2, 4] as const) {
      const { Particles } = await scaleModules(scale), fixture = sceneRecord();
      const particles = new Particles(fixture.scene);
      particles.hitSpark(80 * scale, 40 * scale, 80);
      particles.groundBurst(60 * scale, 120 * scale);
      particles.dust(90 * scale, 100 * scale);
      for (let i = 0; i < 4; i++) particles.tick();
      const pool = (particles as unknown as { pool: Record<string, number | boolean>[] }).pool;
      results.push(pool.filter(particle => particle.alive).map(particle => Object.fromEntries(Object.entries(particle).map(([key, value]) => [key, ['x', 'y', 'vx', 'vy', 'gravity', 'size'].includes(key) ? Number(value) / scale : value]))));
    }
    expect(results[1]).toEqual(results[0]);
  });

  it.each([false, true])('steam, magma body, charge and timed smoke scale once with embedded character limbs=%s', async embeddedBody => {
    const results = [];
    for (const scale of [2, 4] as const) {
      const { SkillEffects } = await scaleModules(scale), fixture = sceneRecord();
      const effects = new SkillEffects(fixture.scene);
      const sim = new FightSim({ p1: luffyDef, p2: akainuDef, seed: 1, introFrames: 0 });
      const luffy = sim.state.fighters[0], akainu = sim.state.fighters[1];
      luffy.install = 'gear2';
      luffy.state = 'attack'; luffy.moveId = 'sp_gear2';
      akainu.state = 'attack'; akainu.moveId = 'sp_magma_body';
      const screen = (value: number) => value / SUBPIXEL * scale;
      effects.begin(); effects.fighters(sim, screen, screen, () => embeddedBody);
      akainu.moveId = 'sp_daifunka'; akainu.stateFrame = 2;
      effects.fighters(sim, screen, screen, () => embeddedBody);
      effects.projectileEnd({ id: 1, owner: 1, moveId: 'sp_meteor', kind: 'meteor', frame: 1, x: px(100), y: px(120), reason: 'timeout' });
      for (let i = 0; i < 3; i++) effects.tick();
      effects.finish(screen, screen);
      results.push(fixture.images.map(image => ({
        texture: image.setTexture,
        position: (image.setPosition as number[]).map(value => value / scale),
        size: (image.setDisplaySize as number[]).map(value => value / scale),
        alpha: image.setAlpha,
      })));
    }
    expect(results[1]).toEqual(results[0]);
  });
});
