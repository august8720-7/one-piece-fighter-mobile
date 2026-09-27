import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { Btn, FightSim, SUBPIXEL, totalFrames } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { animeAtlasPages, animeSpriteScale, attachmentPoint, currentAnimation, exposureIndex, isAnimeRuntimeManifest, validateAnimeRuntimeManifest, type AnimeRuntimeManifest } from '../../src/render/animations';
import { FighterView } from '../../src/render/FighterView';

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } } } }));

const make = () => new FightSim({ p1: luffyDef, p2: akainuDef, seed: 1, introFrames: 0 });
const manifest = (): AnimeRuntimeManifest => {
  const value: AnimeRuntimeManifest = {
    schemaVersion: 1, characterId: 'luffy', style: 'anime', continuous: true,
    atlas: { image: 'atlas.png', data: 'atlas.json' },
    anims: {
      idle: { frames: 3, fps: 60, loop: true, pixelArt: false, exposures: [{ frame: 0, ticks: 2 }, { frame: 2, ticks: 1 }, { frame: 1, ticks: 3 }] },
      st_a: { frames: 3, fps: 60, loop: false, pixelArt: false, exposures: luffyDef.moves.find(move => move.id === 'st_a')!.frames.map((frame, index) => ({ frame: index, ticks: frame.duration })) },
    },
    attachments: {},
  };
  for (const name of Object.keys(value.anims)) for (let i = 0; i < 3; i++) value.attachments[`luffy/${name}/${i}`] = {
    size: { width: 100, height: 200 }, root: { x: 50, y: 220 }, sockets: { shoulder: { x: 55, y: 60 }, wrist: { x: 90 + i, y: 90 } },
  };
  return value;
};

describe('anime deterministic animation contract', () => {
  it('explicit holds preserve unequal timing, repeat intentionally, and clamp non-loops', () => {
    const exposures = manifest().anims.idle!.exposures!;
    expect(Array.from({ length: 9 }, (_, tick) => exposureIndex(exposures, tick, true))).toEqual([0, 0, 2, 1, 1, 1, 0, 0, 2]);
    expect(exposureIndex(exposures, 100, false)).toBe(1);
  });

  it('new art advances from stateFrame only and preserves real hitstop', () => {
    const sim = make(), f = sim.state.fighters[0], art = manifest();
    f.state = 'attack'; f.moveId = 'st_a'; f.stateFrame = 4; f.hitstop = 3;
    const before = currentAnimation(sim, f, art.anims);
    expect(before).toEqual({ anim: 'st_a', index: 1 });
    const snapshot = JSON.stringify(sim.state);
    for (let i = 0; i < 20; i++) expect(currentAnimation(sim, f, art.anims)).toEqual(before);
    expect(JSON.stringify(sim.state)).toBe(snapshot);
    for (let i = 0; i < 3; i++) { sim.step({ p1: 0, p2: 0 }); expect(currentAnimation(sim, f, art.anims)).toEqual(before); }
  });

  it('connected throws have their own explicit timeline, not startup replay', () => {
    const sim = make(), f = sim.state.fighters[0], art = manifest();
    art.anims.st_a!.throwExposures = [{ frame: 2, ticks: 3 }, { frame: 1, ticks: 4 }];
    f.state = 'throw'; f.moveId = 'st_a'; f.stateFrame = 0;
    expect(currentAnimation(sim, f, art.anims)).toEqual({ anim: 'st_a', index: 2 });
    f.stateFrame = 3;
    expect(currentAnimation(sim, f, art.anims)).toEqual({ anim: 'st_a', index: 1 });
  });

  it('victory presentation advances on its logical clock while explicit debug poses remain held', () => {
    const sim = make(), fighter = sim.state.fighters[0], art = manifest();
    art.anims.win = { frames: 3, fps: 60, loop: false, pixelArt: false, exposures: [{ frame: 0, ticks: 4 }, { frame: 1, ticks: 3 }, { frame: 2, ticks: 5 }] };
    fighter.stateFrame = 300;
    const before = JSON.stringify(sim.state);
    const at = (stateFrame: number) => currentAnimation(sim, fighter, art.anims, { anim: 'win', stateFrame });
    expect([0, 3, 4, 6, 7, 100].map(tick => at(tick).index)).toEqual([0, 0, 1, 1, 2, 2]);
    for (let i = 0; i < 10; i++) expect(at(4)).toEqual({ anim: 'win', index: 1 });
    expect(currentAnimation(sim, fighter, art.anims, 'win')).toEqual({ anim: 'win', index: 0 });
    expect(currentAnimation(sim, fighter, art.anims, 'win/2')).toEqual({ anim: 'win', index: 2 });
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it.each([luffyDef, akainuDef])('$id selects rising/apex/falling drawings from actual short-hop and full-jump physics', def => {
    const poses = { frames: 3, fps: 60, loop: false, pixelArt: false, exposures: [{ frame: 0, ticks: 8 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 8 }], airbornePhases: { rising: 0, apex: { frame: 1, maxSpeed: 1 }, falling: 2 } };
    const trajectories = [1, 4].map(holdTicks => {
      const sim = new FightSim({ p1: def, p2: akainuDef, seed: 1, introFrames: 0 });
      const fighter = sim.state.fighters[0], seen: number[] = [];
      let started = false;
      for (let tick = 0; tick < 90; tick++) {
        sim.step({ p1: tick < holdTicks ? Btn.Up : 0, p2: 0 });
        if (fighter.airborne) {
          started = true;
          const before = JSON.stringify(sim.state);
          const actual = currentAnimation(sim, fighter, { jump_neutral: poses });
          expect(actual).toEqual({ anim: 'jump_neutral', index: Math.abs(fighter.vy) <= SUBPIXEL ? 1 : fighter.vy < 0 ? 0 : 2 });
          expect(JSON.stringify(sim.state)).toBe(before);
          seen.push(actual.index);
        } else if (started) break;
      }
      expect(new Set(seen)).toEqual(new Set([0, 1, 2]));
      return seen;
    });
    expect(trajectories[0]!.length).toBeLessThan(trajectories[1]!.length);
    expect(trajectories[0]!.indexOf(1)).toBeLessThan(trajectories[1]!.indexOf(1));
  });

  it('two-pose jumps switch at the velocity sign and unconfigured legacy animations keep their timing', () => {
    const sim = make(), fighter = sim.state.fighters[0];
    const base = { frames: 2, fps: 60, loop: false, exposures: [{ frame: 0, ticks: 3 }, { frame: 1, ticks: 3 }] };
    const phased = { ...base, airbornePhases: { rising: 0, falling: 1 } };
    fighter.state = 'jump_fwd'; fighter.airborne = true; fighter.stateFrame = 50; fighter.vy = -1;
    expect(currentAnimation(sim, fighter, { jump_fwd: phased }).index).toBe(0);
    expect(currentAnimation(sim, fighter, { jump_fwd: base }).index).toBe(1);
    fighter.vy = 0;
    expect(currentAnimation(sim, fighter, { jump_fwd: phased }).index).toBe(1);
  });

  it('a real lethal strike retains the airborne reaction until core lands in grounded KO', () => {
    const sim = make(), fighter = sim.state.fighters[1], table = {
      hit_air: { frames: 2, fps: 60, loop: false, exposures: [{ frame: 0, ticks: 8 }, { frame: 1, ticks: 8 }] },
      ko: { frames: 1, fps: 60, loop: false, exposures: [{ frame: 0, ticks: 1 }] },
    };
    for (let tick = 0; tick < 120; tick++) sim.step({ p1: Btn.Right, p2: Btn.Left });
    sim.step({ p1: 0, p2: 0 });
    fighter.hp = 1;
    let airborneReaction = false, groundedKo = false;
    for (let tick = 0; tick < 120; tick++) {
      sim.step({ p1: tick === 0 ? Btn.A : 0, p2: 0 });
      if (fighter.hp > 0) continue;
      const actual = currentAnimation(sim, fighter, table);
      if (fighter.airborne) {
        airborneReaction = true;
        expect(actual.anim).toBe('hit_air');
      } else {
        groundedKo = true;
        expect(actual).toEqual({ anim: 'ko', index: 0 });
      }
    }
    expect(airborneReaction).toBe(true);
    expect(groundedKo).toBe(true);
  });

  it('rejects missing phase frames and never lets jump configuration replace attack timing', () => {
    const art = manifest();
    art.anims.st_a!.airbornePhases = { rising: 0, falling: 1 };
    expect(validateAnimeRuntimeManifest(art, luffyDef.moves)).toContain('st_a: invalid airborne phase poses');
    delete art.anims.st_a!.airbornePhases;
    art.anims.jump_neutral = { ...art.anims.idle!, loop: false, airbornePhases: { rising: 0, falling: 3 } };
    expect(validateAnimeRuntimeManifest(art)).toContain('jump_neutral: invalid airborne phase poses');
    art.anims.jump_neutral.airbornePhases = { rising: 0, falling: 2, apex: { frame: 1, maxSpeed: -1 } };
    expect(validateAnimeRuntimeManifest(art)).toContain('jump_neutral: invalid airborne phase poses');
  });

  it('validates candidate completeness and move durations before installation', () => {
    const art = manifest();
    expect(isAnimeRuntimeManifest(art)).toBe(true);
    expect(validateAnimeRuntimeManifest(art, luffyDef.moves)).toEqual([]);
    art.anims.st_a!.exposures = [{ frame: 1, ticks: totalFrames(luffyDef.moves.find(move => move.id === 'st_a')!) + 1 }];
    expect(validateAnimeRuntimeManifest(art, luffyDef.moves)).toContain('st_a: exposure duration must match the non-looping move');
    delete art.attachments['luffy/st_a/2'];
    expect(isAnimeRuntimeManifest(art)).toBe(false);
  });

  it('rejects zero/negative holds, unavailable drawings and per-action body scaling', () => {
    const art = manifest();
    art.anims.idle!.exposures = [{ frame: 3, ticks: 0 }];
    art.anims.idle!.drawScale = 1.2;
    const errors = validateAnimeRuntimeManifest(art);
    expect(errors).toContain('idle: invalid exposures exposure');
    expect(errors).toContain('idle: per-action body scaling is forbidden');
  });

  it('validates density and every page assignment while preserving the single-page contract', () => {
    const art = manifest();
    expect(animeAtlasPages(art)).toEqual([{ id: 'p0', image: 'atlas.png', data: 'atlas.json' }]);
    art.schemaVersion = 2;
    art.textureDensity = 2;
    art.pages = [
      { id: 'p0', image: 'atlas.png', data: 'atlas.json', width: 512, height: 512 },
      { id: 'p1', image: 'atlas-p1.png', data: 'atlas-p1.json', width: 512, height: 512 },
    ];
    art.framePages = Object.fromEntries(Object.keys(art.attachments).map(name => [name, name.includes('/idle/') ? 'p0' : 'p1']));
    expect(validateAnimeRuntimeManifest(art)).toEqual([]);
    art.framePages['luffy/st_a/0'] = 'p2';
    expect(validateAnimeRuntimeManifest(art)).toContain('luffy/st_a/0: missing or invalid atlas page');
    art.framePages['luffy/st_a/0'] = 'p1';
    art.pages[1]!.image = '../outside.png';
    expect(validateAnimeRuntimeManifest(art).some(error => error.includes('invalid atlas page p1'))).toBe(true);
    art.pages[1]!.image = 'atlas-p1.png';
    art.pages[1]!.width = 8192;
    art.textureDensity = 0;
    expect(validateAnimeRuntimeManifest(art)).toContain('textureDensity must be in (0,4]');
    expect(validateAnimeRuntimeManifest(art).some(error => error.includes('invalid atlas page p1'))).toBe(true);
  });

  it.each([2, 4])('D1/D2 roots and sockets occupy the same world display at renderScale %s', renderScale => {
    const original = manifest().attachments['luffy/idle/0']!;
    const dense = { size: { width: original.size.width * 2, height: original.size.height * 2 }, root: { x: original.root.x * 2, y: original.root.y * 2 }, sockets: Object.fromEntries(Object.entries(original.sockets).map(([key, point]) => [key, { x: point.x * 2, y: point.y * 2 }])) };
    for (const facing of [1, -1] as const) {
      const originalScale = animeSpriteScale(renderScale, 1), denseScale = animeSpriteScale(renderScale, 2);
      const transform = { x: 340, y: 420, facing, scaleX: originalScale, scaleY: originalScale };
      expect(attachmentPoint(original, 'wrist', transform)).toEqual(attachmentPoint(dense, 'wrist', { ...transform, scaleX: denseScale, scaleY: denseScale }));
      expect(original.size.height * originalScale).toBe(dense.size.height * denseScale);
    }
  });

  it.each([1, -1] as const)('outside-crop roots and sockets mirror about the same world root (%s)', (facing) => {
    const geometry = manifest().attachments['luffy/idle/0']!;
    expect(attachmentPoint(geometry, 'root', { x: 100, y: 300, facing, scaleX: 2, scaleY: 2 })).toEqual({ x: 100, y: 300 });
    expect(attachmentPoint(geometry, 'wrist', { x: 100, y: 300, facing, scaleX: 2, scaleY: 2 })).toEqual({ x: 100 + facing * 80, y: 40 });
    expect(attachmentPoint(geometry, 'absent', { x: 0, y: 0, facing, scaleX: 1, scaleY: 1 })).toBeNull();
  });
});

class SpriteRecord {
  x = 0; y = 0; scaleX = 1; scaleY = 1; flipX = false; visible = false;
  originX = 0; originY = 1; filter = -1; name = '';
  key = 'new-candidate';
  pageFrames = new Map<string, Set<string>>();
  frame = { customPivot: false, pivotX: 0.5, pivotY: 1 };
  available = new Set(['luffy/st_a/0', 'luffy/st_a/1', 'luffy/st_a/2']);
  texture = { customData: { meta: { capabilities: { continuous: true }, style: 'anime' } } as { meta?: { capabilities?: { continuous: boolean }; style?: string; pixelArt?: boolean } }, has: (name: string) => this.available.has(name), setFilter: (value: number) => { this.filter = value; } };
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setDepth() { return this; }
  setVisible(value: boolean) { this.visible = value; return this; }
  setFrame(name: string) { this.name = name; return this; }
  setTexture(key: string) { this.key = key; this.available = this.pageFrames.get(key) ?? new Set(); return this; }
  setScale(value: number) { this.scaleX = value; this.scaleY = value; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setFlipX(value: boolean) { this.flipX = value; return this; }
  setAlpha() { return this; }
  clearTint() { return this; }
  setTint() { return this; }
}

describe('FighterView explicit capabilities', () => {
  it('keeps legacy pixel atlases continuous while old concept atlases use logical sprite poses', () => {
    const sim = make(), f = sim.state.fighters[0], art = manifest();
    f.state = 'attack'; f.moveId = 'st_a'; f.stateFrame = 0;
    art.anims.st_a!.exposures = [{ frame: 2, ticks: 14 }];
    for (const pixelArt of [true, false]) {
      const sprite = new SpriteRecord();
      sprite.texture.customData = { meta: { pixelArt } };
      const scene = { add: { sprite: () => sprite } } as unknown as Phaser.Scene;
      const view = new FighterView(scene, 'legacy-atlas', 'luffy', art.anims);
      expect(view.update(sim, f, 100, 300, null, 1)).toBe(true);
      expect(sprite.name).toBe(`luffy/st_a/${pixelArt ? 2 : 0}`);
    }
  });

  it('draws continuous art without artSource and updates its current mirrored sockets', () => {
    const sprite = new SpriteRecord(), art = manifest();
    const scene = { add: { sprite: () => sprite } } as unknown as Phaser.Scene;
    const view = new FighterView(scene, 'new-candidate', 'luffy', art.anims, art);
    const sim = make(), f = sim.state.fighters[0];
    f.state = 'attack'; f.moveId = 'st_a'; f.stateFrame = 4; f.facing = -1;
    expect(view.update(sim, f, 100, 300, null, 1)).toBe(true);
    expect(sprite.name).toBe('luffy/st_a/1');
    expect(sprite.originY).toBe(1.1);
    expect(view.socket('wrist')).toEqual({ x: 59, y: 170 });
    expect(sprite.filter).toBe(0);
    view.hide();
    expect(view.socket('wrist')).toBeNull();
  });

  it('a missing candidate drawing fails visibly instead of borrowing a legacy frame', () => {
    const sprite = new SpriteRecord(), art = manifest();
    sprite.available.delete('luffy/st_a/2');
    art.anims.st_a!.exposures = [{ frame: 2, ticks: 14 }];
    const scene = { add: { sprite: () => sprite } } as unknown as Phaser.Scene;
    const view = new FighterView(scene, 'new-candidate', 'luffy', art.anims, art);
    const sim = make(), f = sim.state.fighters[0];
    f.state = 'attack'; f.moveId = 'st_a'; f.stateFrame = 0;
    expect(view.update(sim, f, 100, 300, null, 1)).toBe(false);
    expect(view.missingFrames).toEqual(['luffy/st_a/2']);
    expect(view.socket('wrist')).toBeNull();
  });

  it('changes immutable pages and divides packed density without changing the root or timing', () => {
    const sprite = new SpriteRecord(), art = manifest();
    art.textureDensity = 2;
    art.frameTextures = { 'luffy/st_a/0': 'new-candidate', 'luffy/st_a/1': 'second-page-hash', 'luffy/st_a/2': 'second-page-hash' };
    sprite.pageFrames.set('new-candidate', new Set(['luffy/st_a/0']));
    sprite.pageFrames.set('second-page-hash', new Set(['luffy/st_a/1', 'luffy/st_a/2']));
    sprite.available = sprite.pageFrames.get('new-candidate')!;
    const scene = { add: { sprite: () => sprite } } as unknown as Phaser.Scene;
    const view = new FighterView(scene, 'new-candidate', 'luffy', art.anims, art);
    const sim = make(), fighter = sim.state.fighters[0];
    fighter.state = 'attack'; fighter.moveId = 'st_a'; fighter.stateFrame = 4;
    expect(view.update(sim, fighter, 100, 300, null, 1, undefined, 2)).toBe(true);
    expect(view.key).toBe('second-page-hash');
    expect(sprite.scaleX).toBe(1);
    expect(sprite.originY).toBe(1.1);
    expect(view.socket('wrist')).toEqual({ x: 141, y: 170 });
    fighter.stateFrame = 0;
    expect(view.update(sim, fighter, 100, 300, null, 1, undefined, 1)).toBe(true);
    expect(view.key).toBe('new-candidate');
    expect(sprite.scaleX).toBe(0.5);
  });
});
