import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Colored geometry is an in-memory test fixture, never generated character art.
const run = (body: string) => JSON.parse(execFileSync('python', ['-c', `
import copy, importlib.util, json, math, sys
from collections import deque
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("anime_builder", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from PIL import Image, ImageDraw

def fixture():
    im = Image.new("RGBA", (200,120), (0,0,0,0))
    draw = ImageDraw.Draw(im)
    draw.rectangle((15,35,44,109), fill=(200,40,40,255))
    draw.rectangle((40,40,59,50), fill=(130,20,30,255))
    draw.rectangle((60,40,139,50), fill=(220,170,110,255))
    draw.rectangle((140,35,175,54), fill=(30,70,210,255))
    draw.rectangle((155,37,159,41), fill=(255,220,30,255))
    draw.rectangle((168,47,173,51), fill=(80,220,190,255))
    # An internal hole detects any unauthorized opaque gap filling.
    draw.rectangle((162,43,164,46), fill=(0,0,0,0))
    config = {"type":"rubber-straight", "anchor":[60,45], "wrist":[140,45],
        "region":[60,20,125,50], "compression":0.5, "rotationDegrees":0,
        "transitionLength":16, "protectedRects":[[0,0,60,120]]}
    root = (30,110)
    sockets = {"shoulder":(44,45), "wrist":(140,45), "fist_tip":(175,45),
        "fist_marker":(165,42), "foot":(30,108)}
    return im, config, root, sockets

def xy(p):
    return [p["x"], p["y"]] if isinstance(p, dict) else list(p)

${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' }));

describe('explicit offline rubber-segment calibration', () => {
  it('preserves every protected pixel and leaves source, root and fixed sockets unchanged', () => {
    const result = run(`
im, config, root, sockets = fixture()
original = im.tobytes()
old_sockets = copy.deepcopy(sockets)
config["rotationDegrees"] = -10
out, moved, stats = m.apply_frame_transform(im, config, root, sockets)
print(json.dumps({"size":list(out.size), "sourceUnchanged":im.tobytes()==original,
    "protectedUnchanged":out.crop((0,0,60,120)).tobytes()==im.crop((0,0,60,120)).tobytes(),
    "root":root, "inputSocketsUnchanged":sockets==old_sockets,
    "shoulder":xy(moved["shoulder"]), "foot":xy(moved["foot"]),
    "protectedPixelsChanged":stats["protectedPixelsChanged"]}))
`);
    expect(result.size).toEqual([200, 120]);
    expect(result.sourceUnchanged).toBe(true);
    expect(result.protectedUnchanged).toBe(true);
    expect(result.inputSocketsUnchanged).toBe(true);
    expect(result.root).toEqual([30, 110]);
    expect(result.shoulder).toEqual([44, 45]);
    expect(result.foot).toEqual([30, 108]);
    expect(result.protectedPixelsChanged).toBe(0);
  });

  it('shortens only the straight section while translating the unscaled fist pixels and its hole', () => {
    const result = run(`
im, config, root, sockets = fixture()
out, moved, _ = m.apply_frame_transform(im, config, root, sockets)
print(json.dumps({"wrist":xy(moved["wrist"]), "tip":xy(moved["fist_tip"]),
    "fistPixelsUnchanged":out.crop((100,32,140,58)).tobytes()==im.crop((140,32,180,58)).tobytes(),
    "hole":out.getpixel((123,44)), "oldFistAlpha":out.getchannel("A").crop((145,20,185,70)).getextrema()}))
`);
    expect(result.wrist).toEqual([100, 45]);
    expect(result.tip).toEqual([135, 45]);
    expect(result.fistPixelsUnchanged).toBe(true);
    expect(result.hole[3]).toBe(0);
    expect(result.oldFistAlpha).toEqual([0, 0]);
  });

  it('rotates wrist and fist landmarks rigidly after compression without scaling their distances', () => {
    const result = run(`
im, config, root, sockets = fixture()
config["rotationDegrees"] = -10
out, moved, _ = m.apply_frame_transform(im, config, root, sockets)
print(json.dumps({name:xy(moved[name]) for name in ("wrist","fist_tip","fist_marker")}))
`);
    const angle = -10 * Math.PI / 180;
    expect(result.wrist[0]).toBeCloseTo(60 + 40 * Math.cos(angle), 6);
    expect(result.wrist[1]).toBeCloseTo(45 + 40 * Math.sin(angle), 6);
    expect(result.fist_tip[0]).toBeCloseTo(60 + 75 * Math.cos(angle), 6);
    expect(result.fist_tip[1]).toBeCloseTo(45 + 75 * Math.sin(angle), 6);
    expect(Math.hypot(result.fist_tip[0] - result.wrist[0], result.fist_tip[1] - result.wrist[1])).toBeCloseTo(35, 6);
    expect(Math.hypot(result.fist_marker[0] - result.wrist[0], result.fist_marker[1] - result.wrist[1])).toBeCloseTo(Math.hypot(25, -3), 6);
  });

  it('preserves the actual rotated fist alpha area rather than merely reporting unscaled sockets', () => {
    const result = run(`
im, config, root, sockets = fixture()
config["rotationDegrees"] = -10
out, _, _ = m.apply_frame_transform(im, config, root, sockets)
angle = math.radians(-10)
source_area = sum(im.getpixel((x,y))[3]/255 for y in range(im.height) for x in range(140,185))
output_area = 0
for y in range(out.height):
    for x in range(out.width):
        # Wrist plane after a 40px straight segment; everything beyond is rigid fist.
        u = (x+.5-60)*math.cos(angle)+(y+.5-45)*math.sin(angle)
        if u>=40:
            output_area += out.getpixel((x,y))[3]/255
print(json.dumps({"sourceArea":source_area, "outputArea":output_area}))
`);
    expect(result.sourceArea).toBe(708);
    // Pixel-grid resampling may shift the wrist boundary by less than one column.
    expect(Math.abs(result.outputArea / result.sourceArea - 1)).toBeLessThan(0.02);
  });

  it('keeps an opaque path from unchanged cuff to rotated fist without synthetic gap filling', () => {
    const result = run(`
im, config, root, sockets = fixture()
config["rotationDegrees"] = -10
out, _, _ = m.apply_frame_transform(im, config, root, sockets)
alpha = out.getchannel("A")
# Derive the target independently from fixture geometry, not reported sockets.
angle = math.radians(-10)
target = (round(60+57*math.cos(angle)), round(45+57*math.sin(angle)))
seen, queue = {(59,45)}, deque([(59,45)])
while queue:
    x,y = queue.popleft()
    for point in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
        nx,ny = point
        if 0<=nx<out.width and 0<=ny<out.height and point not in seen and alpha.getpixel(point)>=128:
            seen.add(point)
            queue.append(point)
print(json.dumps({"connected":target in seen, "targetAlpha":alpha.getpixel(target),
    "cuffUnchanged":out.getpixel((59,45))==im.getpixel((59,45))}))
`);
    expect(result.connected).toBe(true);
    expect(result.targetAlpha).toBeGreaterThanOrEqual(128);
    expect(result.cuffUnchanged).toBe(true);
  });

  it('preserves crop-relative root through frame preparation and applies only the shared output scale', () => {
    const result = run(`
im, transform, root, sockets = fixture()
source = Image.new("RGBA",(210,134),(0,0,0,0))
source.alpha_composite(im,(5,7))
config = {"crop":[5,7,200,120], "root":list(root),
    "sockets":{name:list(value) for name,value in sockets.items()},
    "transparency":{"mode":"source-alpha"}, "transform":transform}
out, geometry, _ = m.prepare_frame(source, config, 0.5)
print(json.dumps({"size":list(out.size), "geometry":geometry}))
`);
    expect(result.size).toEqual([100, 60]);
    expect(result.geometry.root).toEqual({ x: 15, y: 55 });
    expect(result.geometry.sockets.shoulder).toEqual({ x: 22, y: 22.5 });
    expect(result.geometry.sockets.wrist).toEqual({ x: 50, y: 22.5 });
    expect(result.geometry.sockets.fist_tip).toEqual({ x: 67.5, y: 22.5 });
  });

  it('rejects invalid geometry, oversized corrections and unprotected body anchors', () => {
    const result = run(`
im, valid, root, sockets = fixture()
cases = {
    "unknown-transform":{"type":"whole-body"},
    "compression-too-small":{"compression":0.249},
    "stretching":{"compression":1.001},
    "boolean-compression":{"compression":True},
    "nonfinite-compression":{"compression":float("nan")},
    "rotation-too-large":{"rotationDegrees":15.01},
    "rotation-too-small":{"rotationDegrees":-15.01},
    "nonfinite-rotation":{"rotationDegrees":float("inf")},
    "empty-transition":{"transitionLength":0},
    "transition-beyond-wrist":{"transitionLength":81},
    "nonfinite-anchor":{"anchor":[60,float("nan")]},
    "anchor-not-region-start":{"anchor":[61,45]},
    "wrist-before-anchor":{"wrist":[59,45]},
    "zero-straight-length":{"wrist":[60,45]},
    "wrist-outside-region":{"wrist":[190,45]},
    "region-outside-source":{"region":[60,20,141,50]},
    "zero-region-width":{"region":[60,20,0,50]},
    "protected-overlap":{"protectedRects":[[0,0,61,120]]},
    "missing-protection":{"protectedRects":[]},
    "unprotected-root":{"protectedRects":[[0,0,60,100]]},
    "unprotected-shoulder":{"protectedRects":[[0,100,60,20]]},
}
rejected, accepted = [], []
for label, changes in cases.items():
    config = {**copy.deepcopy(valid), **changes}
    try:
        m.apply_frame_transform(im, config, root, sockets)
        accepted.append(label)
    except ValueError:
        rejected.append(label)
print(json.dumps({"rejected":rejected, "accepted":accepted, "total":len(cases)}))
`);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(result.total);
    expect(result.total).toBe(21);
  });

  it('accepts a ground root exactly on the protected rectangle bottom edge and is deterministic', () => {
    const result = run(`
im, config, _, sockets = fixture()
root = (30,120)
config["rotationDegrees"] = -10
first, first_sockets, first_stats = m.apply_frame_transform(im, config, root, sockets)
second, second_sockets, second_stats = m.apply_frame_transform(im, config, root, sockets)
print(json.dumps({"pixelsEqual":first.tobytes()==second.tobytes(),
    "socketsEqual":first_sockets==second_sockets, "statsEqual":first_stats==second_stats,
    "protectedPixelsChanged":first_stats["protectedPixelsChanged"]}))
`);
    expect(result.pixelsEqual).toBe(true);
    expect(result.socketsEqual).toBe(true);
    expect(result.statsEqual).toBe(true);
    expect(result.protectedPixelsChanged).toBe(0);
  });

  it('rejects a correction whose rotated fist would be clipped by the output canvas', () => {
    const result = run(`
im, config, _, sockets = fixture()
im = im.crop((0,30,200,120))
config.update({"anchor":[60,15], "wrist":[140,15], "region":[60,0,125,40],
    "compression":1, "rotationDegrees":-15, "protectedRects":[[0,0,60,90]]})
sockets = {name:(p[0],p[1]-30) for name,p in sockets.items()}
rejected = False
try:
    m.apply_frame_transform(im, config, (30,80), sockets)
except ValueError as error:
    rejected = "clip" in str(error)
print(json.dumps({"rejectedForClipping":rejected}))
`);
    expect(result.rejectedForClipping).toBe(true);
  });
});
