import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// In-memory geometry exercises pixel guarantees; it is never candidate character artwork.
const run = (body: string) => JSON.parse(execFileSync('python', ['-c', `
import copy, importlib.util, json, sys
from collections import deque
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("anime_builder", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
from PIL import Image, ImageDraw
def fixture():
    im = Image.new("RGBA", (200,120), (0,0,0,0))
    d = ImageDraw.Draw(im)
    d.rectangle((15,35,44,109),fill=(200,40,40,255))
    d.rectangle((40,40,59,50),fill=(120,20,30,255))
    d.rectangle((60,40,139,50),fill=(220,90,10,255))
    d.rectangle((140,30,178,60),fill=(25,45,60,255))
    d.rectangle((155,34,161,40),fill=(255,220,80,255))
    d.rectangle((169,47,173,52),fill=(0,0,0,0))
    config = {"type":"magma-straight","anchor":[60,45],"wrist":[140,45],
        "region":[60,20,130,50],"extensionPixels":60,"protectedRects":[[0,0,60,120],[60,70,140,50]]}
    return im, config, (30,110), {"shoulder":(44,45),"wrist":(140,45),"fist_tip":(178,45),"foot":(30,109)}
${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' }));

describe('bounded offline magma-segment calibration', () => {
  it('preserves the whole source, body, sleeve and fist pixels while adding transparent canvas', () => {
    const result = run(`
im, config, root, sockets = fixture()
before, old_sockets = im.tobytes(), copy.deepcopy(sockets)
out, moved, stats = m.apply_frame_transform(im, config, root, sockets)
print(json.dumps({"sourceUnchanged":im.tobytes()==before,"inputSocketsUnchanged":sockets==old_sockets,
 "protectedUnchanged":out.crop((0,0,60,120)).tobytes()==im.crop((0,0,60,120)).tobytes(),
 "fistUnchanged":out.crop((200,20,250,70)).tobytes()==im.crop((140,20,190,70)).tobytes(),
 "size":list(out.size),"tip":moved["fist_tip"],"wrist":moved["wrist"],"foot":moved["foot"],
 "shoulder":moved["shoulder"],"hole":out.getpixel((231,49))[3],
 "margin":out.getchannel("A").crop((250,0,260,120)).getextrema(),"stats":stats}))
`);
    expect(result.sourceUnchanged).toBe(true);
    expect(result.inputSocketsUnchanged).toBe(true);
    expect(result.protectedUnchanged).toBe(true);
    expect(result.fistUnchanged).toBe(true);
    expect(result.size).toEqual([260, 120]);
    expect(result.tip).toEqual([238, 45]);
    expect(result.wrist).toEqual([200, 45]);
    expect(result.foot).toEqual([30, 109]);
    expect(result.shoulder).toEqual([44, 45]);
    expect(result.hole).toBe(0);
    expect(result.margin).toEqual([0, 0]);
    expect(result.stats.rootUnchanged).toEqual([30, 110]);
    expect(result.stats.protectedPixelsChanged).toBe(0);
    expect(result.stats.fistBeforeSha256).toBe(result.stats.fistAfterSha256);
  });

  it('keeps an opaque source-derived path from the fixed sleeve to the translated fist', () => {
    const result = run(`
im, config, root, sockets = fixture()
out, _, _ = m.apply_frame_transform(im, config, root, sockets)
a = out.getchannel("A"); seen={(59,45)}; queue=deque([(59,45)])
while queue:
    x,y=queue.popleft()
    for p in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
        if 0<=p[0]<out.width and 0<=p[1]<out.height and p not in seen and a.getpixel(p)>=128:
            seen.add(p);queue.append(p)
print(json.dumps({"connected":(225,45) in seen,"cuffUnchanged":out.getpixel((59,45))==im.getpixel((59,45)),
 "fistWidth":(238-200)==(178-140)}))
`);
    expect(result.connected).toBe(true);
    expect(result.cuffUnchanged).toBe(true);
    expect(result.fistWidth).toBe(true);
  });

  it('frame preparation uses the expanded canvas with the unchanged common scale and root', () => {
    const result = run(`
im, transform, root, sockets = fixture()
config = {"crop":[0,0,200,120],"root":list(root),"sockets":{k:list(v) for k,v in sockets.items()},
 "transparency":{"mode":"source-alpha"},"transform":transform}
out, geometry, _ = m.prepare_frame(im,config,.5)
print(json.dumps({"size":list(out.size),"geometry":geometry}))
`);
    expect(result.size).toEqual([130, 60]);
    expect(result.geometry.root).toEqual({ x: 15, y: 55 });
    expect(result.geometry.sockets.shoulder).toEqual({ x: 22, y: 22.5 });
    expect(result.geometry.sockets.fist_tip).toEqual({ x: 119, y: 22.5 });
  });

  it('rejects oversized, rotated, fractional, unprotected or overlapping extensions', () => {
    const result = run(`
im, valid, root, sockets = fixture()
cases = {"too-long":{"extensionPixels":81},"too-large":{"extensionPixels":257},
 "zero":{"extensionPixels":0},"negative":{"extensionPixels":-1},"fraction":{"extensionPixels":1.5},
 "boolean":{"extensionPixels":True},"infinite":{"extensionPixels":float('inf')},
 "rotation":{"rotationDegrees":1},"nonhorizontal":{"wrist":[140,46]},"fractional-wrist":{"wrist":[140.5,45]},
 "anchor-not-start":{"anchor":[61,45]},"empty-segment":{"wrist":[60,45]},
 "unprotected-root":{"protectedRects":[[0,0,60,100]]},"unprotected-shoulder":{"protectedRects":[[0,100,60,20]]},
 "missing-protection":{"protectedRects":[]},"overlap":{"protectedRects":[[0,0,61,120]]}}
accepted=[]
for label,changes in cases.items():
    try:m.apply_frame_transform(im,{**copy.deepcopy(valid),**changes},root,sockets);accepted.append(label)
    except ValueError:pass
im.putpixel((195,45),(255,255,255,255))
overlap_rejected=False
try:m.apply_frame_transform(im,valid,root,sockets)
except ValueError as error:overlap_rejected='unmoved' in str(error)
print(json.dumps({"accepted":accepted,"count":len(cases),"unmovedOverlapRejected":overlap_rejected}))
`);
    expect(result.accepted).toEqual([]);
    expect(result.count).toBe(16);
    expect(result.unmovedOverlapRejected).toBe(true);
  });

  it('does not permit stretching through the independent rubber type', () => {
    const result = run(`
im, _, root, sockets = fixture()
config={"type":"rubber-straight","anchor":[60,45],"wrist":[140,45],"region":[60,20,130,50],
 "compression":1.01,"rotationDegrees":0,"transitionLength":16,"protectedRects":[[0,0,60,120]]}
rejected=False
try:m.apply_frame_transform(im,config,root,sockets)
except ValueError as error:rejected='compression' in str(error)
print(json.dumps({"rejected":rejected}))
`);
    expect(result.rejected).toBe(true);
  });
});
