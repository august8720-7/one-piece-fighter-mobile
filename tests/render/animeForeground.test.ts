import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { Btn, FightSim, totalFrames } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { validateAnimeRuntimeManifest, type AnimeRuntimeManifest } from '../../src/render/animations';
import { FighterView } from '../../src/render/FighterView';

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } } } }));

const python = (body: string) => JSON.parse(execFileSync('python', ['-c', `
import importlib.util,json,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location("builder",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from PIL import Image
${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' }));

const bodyFrame = 'akainu/throw_fwd/0', foregroundFrame = `${bodyFrame}/foreground`;
const releaseFrame = 'akainu/throw_fwd/1', releaseForeground = `${releaseFrame}/foreground`;
function runtime(): AnimeRuntimeManifest {
  const move = akainuDef.moves.find(entry => entry.id === 'throw_fwd')!;
  const geometry = { size: { width: 100, height: 200 }, root: { x: 45, y: 220 }, sockets: { palm: { x: 80, y: 90 } } };
  return {
    schemaVersion: 2, style: 'anime', continuous: true, characterId: 'akainu', textureDensity: 2,
    atlas: { image: 'atlas.png', data: 'atlas.json' },
    pages: [{ id: 'p0', image: 'atlas.png', data: 'atlas.json', width: 512, height: 512 }, { id: 'p1', image: 'atlas-p1.png', data: 'atlas-p1.json', width: 512, height: 512 }],
    anims: { throw_fwd: { frames: 3, fps: 60, loop: false, pixelArt: false, exposures: [{ frame: 0, ticks: totalFrames(move) }], throwExposures: [{ frame: 0, ticks: move.throwData!.releaseFrame }, { frame: 1, ticks: 6 }, { frame: 2, ticks: move.throwData!.duration - move.throwData!.releaseFrame - 6 }] } },
    foregroundFrames: { [bodyFrame]: foregroundFrame, [releaseFrame]: releaseForeground },
    attachments: Object.fromEntries([bodyFrame, foregroundFrame, releaseFrame, releaseForeground, 'akainu/throw_fwd/2'].map(key => [key, structuredClone(geometry)])),
    framePages: { [bodyFrame]: 'p0', [foregroundFrame]: 'p1', [releaseFrame]: 'p0', [releaseForeground]: 'p1', 'akainu/throw_fwd/2': 'p0' },
    frameTextures: { [bodyFrame]: 'body', [foregroundFrame]: 'forearm', [releaseFrame]: 'body', [releaseForeground]: 'forearm', 'akainu/throw_fwd/2': 'body' },
  };
}

describe('explicit foreground pixel layers', () => {
  it('partitions already-resampled RGBA without duplicating, losing or independently resizing pixels', () => {
    const result = python(`
im=Image.new("RGBA",(20,20),(0,255,0,0))
for y in range(2,18):
    for x in range(2,18):im.putpixel((x,y),(x*10,y*10,73,91 if x==2 else 255))
config={"crop":[0,0,20,20],"root":[10,24],"sockets":{"palm":[15,8]},"transparency":{"mode":"source-alpha"},"foregroundPolygon":[[9,1],[19,1],[19,19],[9,19]],"foregroundNote":"Explicit in-memory test selection only"}
full,geometry,_=m.prepare_frame(im,config,1.75)
body,front,proof=m.split_foreground(full,config)
pixels=[tuple(layer.getpixel((x,y)) for layer in [full,body,front]) for y in range(full.height) for x in range(full.width)]
print(json.dumps({"proof":proof,"sizes":[list(image.size) for image in [full,body,front]],"overlap":sum(b[3]>0 and f[3]>0 for o,b,f in pixels),"loss":sum(o[3]>0 and b[3]==0 and f[3]==0 for o,b,f in pixels),"badVisibleBytes":sum(o != (b if b[3] else f) for o,b,f in pixels if o[3])}))
`);
    expect(result.sizes).toEqual([[35, 35], [35, 35], [35, 35]]);
    expect(result.overlap).toBe(0);
    expect(result.loss).toBe(0);
    expect(result.badVisibleBytes).toBe(0);
    expect(result.proof.preparedRgbaSha256).toBe(result.proof.recombinedRgbaSha256);
  });

  it('packs a declared layer with its action and preserves normal-pose coverage counts', () => {
    const result = python(`
im=Image.new("RGBA",(20,20),(0,0,0,0))
for y in range(2,18):
    for x in range(2,18):im.putpixel((x,y),(x*10,y*10,73,255))
m.load_sources=lambda sources:{"fixture":im}
base={"source":"fixture","crop":[0,0,20,20],"root":[10,24],"sockets":{},"transparency":{"mode":"source-alpha"}}
layer={**base,"foregroundPolygon":[[10,0],[20,0],[20,20],[10,20]],"foregroundNote":"In-memory split fixture"}
config={"scale":1,"textureDensity":2,"maxTextureSize":128,"sources":{"fixture":{"sha256":"fixture-only"}},"frames":{"idle":base,"hold":layer},"anims":{"idle":{"frames":["idle"],"loop":True,"exposures":[{"frame":0,"ticks":6}]},"throw":{"frames":["hold","hold"],"loop":False,"exposures":[{"frame":0,"ticks":6},{"frame":1,"ticks":6}]}}}
outputs,report=m.build_character("fixture",config,"fixture-only")
assert outputs==m.build_character("fixture",config,"fixture-only")[0]
print(json.dumps({"runtime":json.loads(outputs["runtime.json"]),"report":report}))
`);
    expect(validateAnimeRuntimeManifest(result.runtime)).toEqual([]);
    expect(result.runtime.foregroundFrames).toEqual({ 'fixture/throw/0': 'fixture/throw/0/foreground', 'fixture/throw/1': 'fixture/throw/1/foreground' });
    expect(result.runtime.attachments['fixture/throw/0/foreground']).toEqual(result.runtime.attachments['fixture/throw/0']);
    expect(result.runtime.framePages['fixture/throw/0/foreground']).toBe(result.runtime.framePages['fixture/throw/0']);
    expect(result.runtime.anims.throw.frames).toBe(2);
    expect(result.report).toMatchObject({ uniqueCrops: 2, foregroundCrops: 1, mappedFrames: 3, mappedForegroundFrames: 2 });
  });

  it('rejects empty/all-body masks, missing notes and ambiguous transformed coordinates', () => {
    const result = python(`
im=Image.new("RGBA",(10,10),(0,0,0,0));im.paste((180,90,40,255),(3,3,7,7))
base={"crop":[0,0,10,10],"foregroundNote":"Inspected fixture","foregroundPolygon":[[0,0],[9,0],[9,9],[0,9]]}
invalid=[{**base,"foregroundNote":""},{**base,"transform":{"type":"rubber-straight"}}, {**base,"foregroundPolygon":[[0,0],[1,0],[1,1]]},base,{**base,"foregroundPolygon":[[-1,0],[4,0],[4,4]]}]
errors=[]
for config in invalid:
    try:m.split_foreground(im,config)
    except ValueError as error:errors.append(str(error))
print(json.dumps(errors))
`);
    expect(result).toHaveLength(5);
  });

  it('validates every auxiliary frame without letting it impersonate an unmade animation pose', () => {
    expect(validateAnimeRuntimeManifest(runtime(), akainuDef.moves)).toEqual([]);
    for (const change of [
      (value: AnimeRuntimeManifest) => { delete value.attachments[foregroundFrame]; },
      (value: AnimeRuntimeManifest) => { delete value.attachments[bodyFrame]; },
      (value: AnimeRuntimeManifest) => { delete value.framePages![foregroundFrame]; },
      (value: AnimeRuntimeManifest) => { value.attachments[foregroundFrame]!.root.x++; },
      (value: AnimeRuntimeManifest) => { value.foregroundFrames![bodyFrame] = 'akainu/throw_fwd/1'; },
      (value: AnimeRuntimeManifest) => { value.foregroundFrames!['akainu/unmade/0'] = 'akainu/unmade/0/foreground'; },
    ]) {
      const value = runtime(); change(value);
      expect(validateAnimeRuntimeManifest(value, akainuDef.moves).length).toBeGreaterThan(0);
    }
  });
});

class RecordedSprite {
  x = 0; y = 0; scaleX = 1; scaleY = 1; originX = 0; originY = 1;
  flipX = false; visible = false; depth = 0; alpha = 1; tint: number | null = null; name = '';
  frame = { customPivot: false, pivotX: 0.5, pivotY: 1 };
  constructor(public key: string, private readonly pages: Map<string, Set<string>>) {}
  get texture() { return { customData: { meta: { style: 'anime' } }, has: (name: string) => this.pages.get(this.key)?.has(name) ?? false, setFilter: vi.fn() }; }
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setDepth(value: number) { this.depth = value; return this; }
  setVisible(value: boolean) { this.visible = value; return this; }
  setFrame(value: string) { this.name = value; return this; }
  setTexture(value: string) { this.key = value; return this; }
  setScale(value: number) { this.scaleX = value; this.scaleY = value; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setFlipX(value: boolean) { this.flipX = value; return this; }
  setAlpha(value: number) { this.alpha = value; return this; }
  clearTint() { this.tint = null; return this; }
  setTint(value: number) { this.tint = value; return this; }
}

function rig(caster: 0 | 1, back = false, worldLayer?: Phaser.GameObjects.Container) {
  const sim = new FightSim({ p1: caster === 0 ? akainuDef : luffyDef, p2: caster === 1 ? akainuDef : luffyDef, seed: 4, introFrames: 0, roundTime: -1 });
  for (let tick = 0; tick < 120; tick++) sim.step({ p1: Btn.Right, p2: Btn.Left });
  sim.step({ p1: 0, p2: 0 }); sim.step({ p1: 0, p2: 0 });
  const direction = (caster === 0) !== back ? Btn.Right : Btn.Left;
  sim.step(caster === 0 ? { p1: direction | Btn.C, p2: 0 } : { p1: 0, p2: direction | Btn.C });
  const fighter = sim.state.fighters[caster], opponent = sim.state.fighters[caster === 0 ? 1 : 0];
  expect(fighter.state).toBe('throw'); expect(opponent.state).toBe('thrown');
  const art = runtime(), sprites: RecordedSprite[] = [];
  if (back) {
    art.anims.throw_back = structuredClone(art.anims.throw_fwd!);
    for (const [key, geometry] of Object.entries(art.attachments)) art.attachments[key.replace('/throw_fwd/', '/throw_back/')] = structuredClone(geometry);
    for (const map of [art.framePages!, art.frameTextures!]) for (const [key, value] of Object.entries(map)) map[key.replace('/throw_fwd/', '/throw_back/')] = value;
    for (const [key, value] of Object.entries(art.foregroundFrames!)) art.foregroundFrames![key.replace('/throw_fwd/', '/throw_back/')] = value.replace('/throw_fwd/', '/throw_back/');
  }
  const pages = new Map(['body', 'forearm'].map(page => [page, new Set(Object.entries(art.frameTextures!).filter(([, key]) => key === page).map(([frame]) => frame))]));
  const scene = { add: { sprite: (_x: number, _y: number, key: string) => { const sprite = new RecordedSprite(key, pages); sprites.push(sprite); return sprite; } } } as unknown as Phaser.Scene;
  const view = new FighterView(scene, 'body', 'akainu', art.anims, art, worldLayer);
  return { sim, fighter, opponent, art, sprites, pages, view };
}

describe('FighterView foreground lifecycle with real core throws', () => {
  it('keeps both pixel layers in one world transform and exposes transformed socket coordinates', () => {
    const layer = { x: 45, y: 60, scaleX: 0.85, scaleY: 0.85, add: vi.fn() };
    const { sim, fighter, sprites, view } = rig(0, false, layer as unknown as Phaser.GameObjects.Container);
    expect(view.update(sim, fighter, 200, 400, null, 1, undefined, 2)).toBe(true);
    expect(layer.add.mock.calls.map(call => call[0])).toEqual(sprites);
    expect(view.socket('palm')).toEqual({ x: 45 + 235 * 0.85, y: 60 + 270 * 0.85 });
    // Framing is measured before applying the parent transform, never counted twice.
    expect(view.cameraBounds()).toEqual({ left: 155, right: 255, top: 180, bottom: 380 });
  });

  it.each([[0, false], [1, false], [0, true], [1, true]] as const)('P%s back=%s places the victim between layers through actual hold/release and restores a normal recovery', (caster, back) => {
    const { sim, fighter, opponent, sprites, view } = rig(caster, back);
    const before = JSON.stringify(sim.state);
    expect(view.update(sim, fighter, 201.2, 399.8, 0x33aaee, 0.6, undefined, 2)).toBe(true);
    expect(JSON.stringify(sim.state)).toBe(before);
    const [body, foreground] = sprites;
    expect(body!.depth).toBe(9); expect(foreground!.depth).toBe(13);
    for (const key of ['x', 'y', 'scaleX', 'scaleY', 'originX', 'originY', 'flipX', 'alpha', 'tint'] as const) expect(foreground![key]).toBe(body![key]);
    expect(foreground!.key).toBe('forearm'); expect(foreground!.scaleX).toBe(1);
    expect(foreground!.flipX).toBe(caster === 1);
    for (let tick = 0; tick < 80 && opponent.state === 'thrown'; tick++) sim.step({ p1: 0, p2: 0 });
    expect(fighter.state).toBe('throw'); expect(opponent.state).toBe('hit_air');
    expect(view.update(sim, fighter, 201, 400, null, 1)).toBe(true);
    expect(body!.depth).toBe(9); expect(foreground!.visible).toBe(true);
    expect(foreground!.name).toBe(`akainu/throw_${back ? 'back' : 'fwd'}/1/foreground`);
    expect(foreground!.flipX).toBe(fighter.facing === -1);
    for (let tick = 0; tick < 6; tick++) sim.step({ p1: 0, p2: 0 });
    expect(view.update(sim, fighter, 201, 400, null, 1)).toBe(true);
    expect(body!.depth).toBe(12); expect(foreground!.visible).toBe(false);
  });

  it('hides both on a missing declared foreground and allows recovery after the texture returns', () => {
    const { sim, fighter, sprites, pages, view } = rig(0);
    pages.get('forearm')!.clear();
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(false);
    expect(sprites.every(sprite => !sprite.visible)).toBe(true);
    expect(view.missingFrames).toContain(foregroundFrame); expect(view.socket('palm')).toBeNull();
    pages.get('forearm')!.add(foregroundFrame);
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(true);
    pages.get('body')!.delete(bodyFrame);
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(false);
    expect(sprites.every(sprite => !sprite.visible)).toBe(true);
    pages.get('body')!.add(bodyFrame);
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(true);
    view.hide();
    expect(sprites.every(sprite => !sprite.visible)).toBe(true);
    expect(view.socket('palm')).toBeNull();
  });

  it('clears the foreground after a real throw tech and after switching to a valid single-layer hurt drawing', () => {
    const { sim, fighter, sprites, art, pages, view } = rig(0);
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(true);
    sim.step({ p1: 0, p2: Btn.C });
    expect(fighter.state).toBe('throw_tech');
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(false);
    expect(sprites.every(sprite => !sprite.visible)).toBe(true);
    art.anims.hit_stand = { frames: 1, fps: 60, loop: false, pixelArt: false, exposures: [{ frame: 0, ticks: 6 }] };
    art.attachments['akainu/hit_stand/0'] = structuredClone(art.attachments[bodyFrame]!);
    pages.get('body')!.add('akainu/hit_stand/0');
    fighter.state = 'hit_stand'; fighter.moveId = null;
    expect(view.update(sim, fighter, 200, 400, null, 1)).toBe(true);
    expect(sprites[0]!.visible).toBe(true); expect(sprites[0]!.depth).toBe(11);
    expect(sprites[1]!.visible).toBe(false);
  });
});
