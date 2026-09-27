import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { px } from '../../src/core';
import { Particles } from '../../src/render/fx/Particles';
import { Afterimages } from '../../src/render/fx/Afterimages';
import { RENDER_SCALE } from '../../src/render/screen';
import { FightScene } from '../../src/render/scenes/FightScene';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

function fixture() {
  const objects: Record<string, unknown>[] = [];
  const object = () => {
    const data: Record<string, unknown> = { x: 0, y: 0, visible: false, frame: { customPivot: true, pivotX: 0.4, pivotY: 0.9 } };
    const proxy: object = new Proxy(data, { get: (target, property) => {
      if (property in target) return target[String(property)];
      return (...args: unknown[]) => {
        if (property === 'setPosition') { target.x = args[0]; target.y = args[1]; }
        if (property === 'setVisible') target.visible = args[0];
        return proxy;
      };
    } });
    objects.push(data);
    return proxy;
  };
  const scene = { add: { graphics: object, sprite: object }, textures: { exists: () => true, get: () => ({ has: () => true }) } } as unknown as Phaser.Scene;
  return { scene, objects };
}

describe('transient effects keep their world locations through camera pan and zoom', () => {
  it('moves existing particles, both kinds of afterimage and popup by the same camera delta exactly once', () => {
    const { scene, objects } = fixture();
    const particles = new Particles(scene, 64), after = new Afterimages(scene);
    particles.hitSpark(320, 250, 40);
    after.spawnSprite('fixture', 'luffy/hit_air/0', 400, 300, true, undefined, 0.8);
    after.spawnBox(380, 280, 40, 80, 0xff8800);
    const particle = Reflect.get(particles, 'pool')[0] as Record<string, number>;
    const sprite = objects.at(-1)!;
    const box = Reflect.get(after, 'boxes')[0] as Record<string, number>;
    const popup = { text: { x: 320, y: 240 }, ttl: 20 };
    const original = { particle: { ...particle }, spriteX: Number(sprite.x), boxX: box.x, popupX: popup.text.x };
    const fight = Object.create(FightScene.prototype) as FightScene;
    Object.assign(fight, { effectsCameraX: px(10), fx: particles, after, popups: [popup] });
    const reproject = (cameraX: number) => Reflect.apply(Reflect.get(fight, 'reprojectTransientEffects'), fight, [cameraX]);
    reproject(px(30));
    const dx = -20 * RENDER_SCALE;
    expect(particle.x).toBe(original.particle.x! + dx);
    expect(sprite.x).toBe(original.spriteX + dx);
    expect(box.x).toBe(original.boxX! + dx);
    expect(popup.text.x).toBe(original.popupX + dx);
    for (const property of ['y', 'vx', 'vy', 'gravity', 'life', 'size']) expect(particle[property]).toBe(original.particle[property]);
    // A repeated rendering callback has no extra pan, irrespective of container zoom.
    reproject(px(30));
    expect(particle.x).toBe(original.particle.x! + dx);
    expect(popup.text.x).toBe(original.popupX + dx);
    particles.clear(); after.clear();
    const expiredParticle = particle.x, expiredSprite = sprite.x, expiredBox = box.x;
    reproject(px(60));
    expect(particle.x).toBe(expiredParticle); expect(sprite.x).toBe(expiredSprite); expect(box.x).toBe(expiredBox);
    expect(sprite.visible).toBe(false);
  });
});
