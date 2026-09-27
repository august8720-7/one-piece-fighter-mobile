import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAnimeRuntimeManifest } from '../../src/render/animations';

// Synthetic pixels exist only in a child process's memory: no character files or provenance records are manufactured.
const run = (body: string) => execFileSync('python', ['-c', `
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("anime_builder", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from PIL import Image
${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' });

describe('anime atlas deterministic post-processing', () => {
  it('preserves dark/white art while removing only connected green background', () => {
    const result = JSON.parse(run(`
im = Image.new("RGBA", (8,8), (0,255,0,255))
for y in range(2,6):
    for x in range(2,6): im.putpixel((x,y),(8,8,8,255))
im.putpixel((3,3),(255,255,255,255))
im.putpixel((4,4),(0,255,0,255))
out, stats = m.remove_border_key(im,{"color":[0,255,0],"tolerance":16,"despill":True})
seeded, _ = m.remove_border_key(im,{"color":[0,255,0],"tolerance":16,"despill":False,"seeds":[[4,4]]})
print(json.dumps({"background":out.getpixel((0,0)),"outline":out.getpixel((2,2)),"white":out.getpixel((3,3)),"enclosed":out.getpixel((4,4)),"seeded":seeded.getpixel((4,4)),"source":im.getpixel((0,0)),"stats":stats}))
`));
    expect(result.background[3]).toBe(0);
    expect(result.outline).toEqual([8, 8, 8, 255]);
    expect(result.white).toEqual([255, 255, 255, 255]);
    expect(result.enclosed).toEqual([0, 255, 0, 255]);
    expect(result.seeded[3]).toBe(0);
    expect(result.source).toEqual([0, 255, 0, 255]);
  });

  it('one uniform scale transforms crop geometry and permits an outside root', () => {
    const result = JSON.parse(run(`
im = Image.new("RGBA",(10,10),(0,0,0,0))
im.putpixel((5,5),(255,0,0,255))
out, geometry, stats = m.prepare_frame(im,{"crop":[2,2,6,6],"root":[3,9],"sockets":{"wrist":[8,2]},"transparency":{"mode":"source-alpha"}},2)
print(json.dumps({"size":list(out.size),"geometry":geometry}))
`));
    expect(result.size).toEqual([12, 12]);
    expect(result.geometry.root).toEqual({ x: 6, y: 18 });
    expect(result.geometry.sockets.wrist).toEqual({ x: 16, y: 4 });
  });

  it('cleans inspected enclosed key pockets without crossing neutral character pixels', () => {
    const result = JSON.parse(run(`
im=Image.new("RGBA",(12,12),(0,255,0,255))
for y in range(2,10):
    for x in range(2,10):im.putpixel((x,y),(12,12,12,255))
im.putpixel((6,6),(12,190,12,255))
im.putpixel((7,7),(0,210,0,255))
base={"color":[0,255,0],"tolerance":16,"despill":True,"despillConnected":True,"despillRadius":3}
without,_=m.remove_border_key(im,base)
config={**base,"despillRegions":[[6,6,1,1]],"despillSourceSha256":"0"*64,"despillNote":"Synthetic isolated key pocket, in-memory test only"}
with_region,stats=m.remove_border_key(im,config)
changed=[(x,y) for y in range(12) for x in range(12) if without.getpixel((x,y))!=with_region.getpixel((x,y))]
error=None
try:m.remove_border_key(im,{**config,"despillSourceSha256":"bad"})
except ValueError as e:error=str(e)
print(json.dumps({"unlisted":list(with_region.getpixel((7,7))),"before":list(without.getpixel((6,6))),"after":list(with_region.getpixel((6,6))),"changed":changed,"stats":stats,"error":error}))
`));
    expect(result.before).toEqual([12, 190, 12, 255]);
    expect(result.after[1]).toBe(result.after[0]);
    expect(result.after[3]).toBeLessThan(255);
    expect(result.unlisted).toEqual([0, 210, 0, 255]);
    expect(result.changed).toEqual([[6, 6]]);
    expect(result.stats.despilledRegionPixels).toBe(1);
    expect(result.error).toContain('source SHA256');
  });

  it('refuses unverified sources, hash/path mismatches and texture overflow', () => {
    const errors = JSON.parse(run(`
errors=[]
def reject(fn):
    try: fn()
    except ValueError as e: errors.append(str(e))
reject(lambda:m.load_sources({"fake":{"model":"other-model","provider":"chatgpt-web"}}))
reject(lambda:m.load_sources({"fake":{"model":"GPT Image 2.5","provider":"chatgpt-web","unitScale":2}}))
reject(lambda:m.verified_file({"file":"scripts/anime_manifest.json","sha256":"0"*64},m.ROOT/"scripts","fixture"))
reject(lambda:m.verified_file({"file":"AGENTS.md","sha256":"0"*64},m.ROOT/"docs/assets","fixture"))
reject(lambda:m.pack_frames({"oversized":Image.new("RGBA",(65,1))},64))
reject(lambda:m.prepare_frame(Image.new("RGBA",(8,8),(255,255,255,255)),{"crop":[0,0,8,8],"root":[0,8],"sockets":{},"transparency":{"mode":"source-alpha"}},1))
print(json.dumps(errors))
`));
    expect(errors).toHaveLength(6);
    expect(errors[0]).toContain('only recorded GPT Image 2.5');
    expect(errors[1]).toContain('scaleBasis');
    expect(errors[2]).toContain('SHA256 mismatch');
    expect(errors[3]).toContain('outside');
    expect(errors[4]).toContain('maxTextureSize');
    expect(errors[5]).toContain('transparent');
  });

  it('Python output matches the TypeScript runtime contract without writing fixture art', () => {
    const result = JSON.parse(run(`
# Packing/schema fixture only. Production entrypoint still requires real verified originals.
im=Image.new("RGBA",(12,12),(0,0,0,0))
im.putpixel((6,6),(255,0,0,255))
m.load_sources=lambda sources:{"fixture":im}
config={"scale":0.5,"maxTextureSize":64,"sources":{"fixture":{"sha256":"fixture-not-provenance","unitScale":2}},"frames":{"pose":{"source":"fixture","crop":[0,0,12,12],"root":[6,16],"sockets":{"wrist":[10,6]},"transparency":{"mode":"source-alpha"}}},"anims":{"idle":{"frames":["pose"],"loop":True,"exposures":[{"frame":0,"ticks":6}]}}}
outputs,report=m.build_character("fixture",config,"in-memory-only")
repeat,_=m.build_character("fixture",config,"in-memory-only")
assert outputs == repeat
print(json.dumps({"runtime":json.loads(outputs["runtime.json"]),"atlas":json.loads(outputs["atlas.json"]),"report":report}))
`));
    expect(validateAnimeRuntimeManifest(result.runtime)).toEqual([]);
    expect(result.runtime.attachments['fixture/idle/0'].size).toEqual({ width: 12, height: 12 });
    expect(result.runtime.attachments['fixture/idle/0'].root).toEqual({ x: 6, y: 16 });
    expect(result.atlas.meta.capabilities).toEqual({ continuous: true });
    expect(result.report.status).toBe('validated-candidate-not-art-acceptance');
  });

  it('density doubles original texels and geometry while action groups page without duplicating crops', () => {
    const result = JSON.parse(run(`
im=Image.new("RGBA",(26,26),(0,0,0,0))
for y in range(4,22):
    for x in range(4,22): im.putpixel((x,y),(x*9,y*9,128,255))
m.load_sources=lambda sources:{"fixture":im}
pose={"source":"fixture","crop":[0,0,26,26],"root":[13,30],"sockets":{"wrist":[22,12]},"transparency":{"mode":"source-alpha"}}
config={"scale":1,"textureDensity":2,"maxTextureSize":64,"sources":{"fixture":{"sha256":"fixture-not-provenance"}},"frames":{"idle":pose,"hit":pose},"anims":{"idle":{"frames":["idle"],"loop":True,"exposures":[{"frame":0,"ticks":6}]},"hit_stand":{"frames":["hit","idle"],"loop":False,"exposures":[{"frame":0,"ticks":3},{"frame":1,"ticks":3}]}}}
outputs,report=m.build_character("fixture",config,"in-memory-only")
repeat,_=m.build_character("fixture",config,"in-memory-only")
assert outputs==repeat
config["textureDensity"]=1
baseline,_=m.build_character("fixture",config,"in-memory-only")
print(json.dumps({"runtime":json.loads(outputs["runtime.json"]),"baseline":json.loads(baseline["runtime.json"]),"report":report,"files":list(outputs)}))
`));
    expect(validateAnimeRuntimeManifest(result.runtime)).toEqual([]);
    expect(result.runtime.schemaVersion).toBe(2);
    expect(result.runtime.textureDensity).toBe(2);
    expect(result.runtime.pages).toHaveLength(2);
    expect(result.files).toContain('atlas-p1.png');
    expect(result.runtime.framePages).toEqual({ 'fixture/idle/0': 'p0', 'fixture/hit_stand/0': 'p1', 'fixture/hit_stand/1': 'p0' });
    expect(result.runtime.attachments['fixture/idle/0'].size).toEqual({ width: 52, height: 52 });
    expect(result.runtime.attachments['fixture/idle/0'].root).toEqual({ x: 26, y: 60 });
    expect(result.runtime.attachments['fixture/idle/0'].sockets.wrist).toEqual({ x: 44, y: 24 });
    expect(result.baseline.attachments['fixture/idle/0'].root).toEqual({ x: 13, y: 30 });
    expect(result.report.uniqueCrops).toBe(2);
    expect(result.report.mappedFrames).toBe(3);
    expect(result.report.uncompressedRgbaBytes).toBe(2 * 64 * 64 * 4);
  });

  it('refuses an oversized page limit or action without changing the artwork size', () => {
    const errors = JSON.parse(run(`
errors=[]
for fn in [lambda:m.pack_frames({"a":Image.new("RGBA",(8,8))},8192),lambda:m.pack_action_pages({"a":Image.new("RGBA",(40,40)),"b":Image.new("RGBA",(40,40))},{"attack":{"frames":["a","b"]}},64)]:
    try:fn()
    except ValueError as e:errors.append(str(e))
print(json.dumps(errors))
`));
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('between 64 and 4096');
    expect(errors[1]).toContain('attack: action group exceeds');
  });

  it('validates explicit jump phases without retiming exposures or authoring poses', () => {
    const result = JSON.parse(run(`
im=Image.new("RGBA",(16,16),(0,0,0,0))
im.putpixel((8,8),(200,100,40,255))
m.load_sources=lambda sources:{"fixture":im}
pose={"source":"fixture","crop":[0,0,16,16],"root":[8,20],"sockets":{},"transparency":{"mode":"source-alpha"}}
config={"scale":1,"maxTextureSize":64,"sources":{"fixture":{"sha256":"fixture-not-provenance"}},"frames":{"up":pose,"top":pose,"down":pose},"anims":{"jump_neutral":{"frames":["up","top","down"],"loop":False,"exposures":[{"frame":0,"ticks":8},{"frame":1,"ticks":4},{"frame":2,"ticks":8}],"airbornePhases":{"rising":0,"apex":{"frame":1,"maxSpeed":1},"falling":2}}}}
outputs,_=m.build_character("fixture",config,"in-memory-only")
errors=[]
for name,phases in [("st_a",{"rising":0,"falling":1}),("jump_neutral",{"rising":0,"falling":3}),("jump_neutral",{"rising":0,"falling":2,"apex":{"frame":1,"maxSpeed":-1}})]:
    try:m.airborne_phases(phases,3,name)
    except ValueError as error:errors.append(str(error))
print(json.dumps({"runtime":json.loads(outputs["runtime.json"]),"errors":errors}))
`));
    expect(validateAnimeRuntimeManifest(result.runtime)).toEqual([]);
    expect(result.runtime.anims.jump_neutral.airbornePhases).toEqual({ rising: 0, apex: { frame: 1, maxSpeed: 1 }, falling: 2 });
    expect(result.runtime.anims.jump_neutral.exposures).toEqual([{ frame: 0, ticks: 8 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 8 }]);
    expect(result.errors).toHaveLength(3);
  });
});
