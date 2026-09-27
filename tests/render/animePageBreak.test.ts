import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Synthetic pixels stay in process memory. No candidate art, manifests or runtime files are written.
const run = (body: string) => JSON.parse(execFileSync(process.env.OPF_PYTHON ?? 'python', ['-c', `
import importlib.util, io, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("anime_page_break", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from PIL import Image

def old_fixture():
    images = {name: Image.new("RGBA", size, color) for name, size, color in [
        ("old_a", (40,40), (255,0,0,255)), ("old_body", (24,24), (0,0,255,255)),
        ("old_front", (24,24), (0,255,0,128)), ("old_walk", (20,20), (100,50,30,255))]}
    anims = {"idle":{"frames":["old_a"]}, "throw":{"frames":["old_body"]},
             "reuse":{"frames":["old_a","old_body"]}, "walk":{"frames":["old_walk"]}}
    return images, anims, {"old_body":"old_front"}

def encode_png(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()

def character_fixture():
    sheet = Image.new("RGBA", (44,44), (0,0,0,0))
    for y in range(2,42):
        for x in range(2,42): sheet.putpixel((x,y), (x*5,y*5,80,255))
    m.load_sources = lambda sources: {"fixture":sheet}
    def pose(size, foreground=False):
        result = {"source":"fixture", "crop":[0,0,size,size], "root":[size/2,size],
                  "sockets":{}, "transparency":{"mode":"source-alpha"}}
        if foreground:
            result.update(foregroundPolygon=[[size/2,0],[size,0],[size,size],[size/2,size]],
                          foregroundNote="In-memory partition fixture, not production provenance")
        return result
    def anim(frames):
        return {"frames":frames,"loop":False,"exposures":[{"frame":n,"ticks":3} for n in range(len(frames))]}
    config = {"scale":1,"maxTextureSize":64,"sources":{"fixture":{"sha256":"fixture-only"}},
              "frames":{"old_a":pose(40),"old_body":pose(24,True),"old_walk":pose(20)},
              "anims":{"idle":anim(["old_a"]),"throw":anim(["old_body"]),
                       "reuse":anim(["old_a","old_body"]),"walk":anim(["old_walk"])}}
    return config, pose, anim

${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' }));

describe('explicit anime action page boundaries', () => {
  it('keeps the old default layout and makes omitted/empty breaks byte-identical', () => {
    const result = run(`
images, anims, fronts = old_fixture()
pages, frame_pages = m.pack_action_pages(images, anims, 64, fronts)
empty, empty_mapping = m.pack_action_pages(images, anims, 64, fronts, [])
config, _, _ = character_fixture()
default_outputs, _ = m.build_character("fixture", config, "same-input-hash")
config["pageBreakBefore"] = []
empty_outputs, _ = m.build_character("fixture", config, "same-input-hash")
print(json.dumps({"pages":[{"size":list(page.size),"positions":positions,"rgba":m.digest(page.tobytes())} for page,positions in pages],
                  "mapping":frame_pages,"sameDefaultPngs":all(encode_png(a[0])==encode_png(b[0]) and a[1]==b[1] for a,b in zip(pages,empty)) and len(pages)==len(empty) and frame_pages==empty_mapping,
                  "sameCharacterOutputs":default_outputs==empty_outputs}))
`);
    // Captured from the pre-change packer: default action ordering, positions and pixel output.
    expect(result.pages).toEqual([
      { size: [64, 64], positions: { old_a: [2, 2] }, rgba: 'd5f693f5dff655b27cc9f4f27b6c481f301ec559339b1bc1e2fc59cf9ff679d8' },
      { size: [64, 64], positions: { old_body: [2, 2], old_front: [30, 2], old_walk: [2, 30] }, rgba: 'b65a8d73ed9634eda83e9cb5b220fced833300badf4cdbba0245724a8f7b0f30' },
    ]);
    expect(result.mapping).toEqual({ old_a: 0, old_body: 1, old_front: 1, old_walk: 1 });
    expect(result.sameDefaultPngs).toBe(true);
    expect(result.sameCharacterOutputs).toBe(true);
  });

  it('appends a held action on a new page while retaining every old PNG byte, position and pixel', () => {
    const result = run(`
config, pose, anim = character_fixture()
baseline, _ = m.build_character("fixture", config, "old-author-manifest")
old_runtime = json.loads(baseline["runtime.json"])
config["frames"]["held_pose"] = pose(12, True)
config["anims"]["held_labubu_throw"] = anim(["held_pose","old_body","held_pose"])
without_break, _ = m.build_character("fixture", config, "new-author-manifest")
config["pageBreakBefore"] = ["held_labubu_throw"]
extended, report = m.build_character("fixture", config, "new-author-manifest")
runtime = json.loads(extended["runtime.json"])
positions_same, pixels_same = [], []
for page in old_runtime["pages"]:
    before, after = json.loads(baseline[page["data"]]), json.loads(extended[page["data"]])
    positions_same.append(all(after["frames"][key]==value for key,value in before["frames"].items()))
    pixels_same.append(Image.open(io.BytesIO(baseline[page["image"]])).tobytes()==Image.open(io.BytesIO(extended[page["image"]])).tobytes())
old_pages = [page["image"] for page in old_runtime["pages"]]
new_atlas = json.loads(extended["atlas-p2.json"])
print(json.dumps({"oldPages":old_pages,"newPageCount":len(runtime["pages"]),
                  "oldPngBytesSame":all(baseline[name]==extended[name] for name in old_pages),
                  "oldPngPixelsSame":all(pixels_same),"oldFramePositionsSame":all(positions_same),
                  "controlWithoutBreakChangesOldPng":any(baseline[name]!=without_break[name] for name in old_pages),
                  "newBodyPage":runtime["framePages"]["fixture/held_labubu_throw/0"],
                  "newFrontPage":runtime["framePages"]["fixture/held_labubu_throw/0/foreground"],
                  "sharedOldBodyPage":runtime["framePages"]["fixture/held_labubu_throw/1"],
                  "originalOldBodyPage":runtime["framePages"]["fixture/throw/0"],
                  "repeatedNewBodySameRect":new_atlas["frames"]["fixture/held_labubu_throw/0"]==new_atlas["frames"]["fixture/held_labubu_throw/2"],
                  "uniqueCrops":report["uniqueCrops"],"foregroundCrops":report["foregroundCrops"],
                  "withinLimit":all(page["width"]<=64 and page["height"]<=64 for page in runtime["pages"])}))
`);
    expect(result).toMatchObject({
      oldPages: ['atlas.png', 'atlas-p1.png'], newPageCount: 3,
      oldPngBytesSame: true, oldPngPixelsSame: true, oldFramePositionsSame: true,
      controlWithoutBreakChangesOldPng: true, newBodyPage: 'p2', newFrontPage: 'p2',
      sharedOldBodyPage: 'p1', originalOldBodyPage: 'p1', repeatedNewBodySameRect: true,
      uniqueCrops: 4, foregroundCrops: 2, withinLimit: true,
    });
  });

  it('flushes each named action in author order without empty pages or pixel-based deduplication', () => {
    const result = run(`
same_pixels = Image.new("RGBA", (8,8), (70,30,10,255))
images = {"a":same_pixels,"b":same_pixels,"c":same_pixels}
anims = {"idle":{"frames":["a"]},"held_one":{"frames":["b","a"]},"held_two":{"frames":["c","b"]}}
pages, mapping = m.pack_action_pages(images, anims, 64, page_break_before=["held_two","idle","held_one"])
print(json.dumps({"pages":len(pages),"mapping":mapping,"storedNames":[name for _,positions in pages for name in positions]}))
`);
    expect(result).toEqual({ pages: 3, mapping: { a: 0, b: 1, c: 2 }, storedNames: ['a', 'b', 'c'] });
  });

  it.each([
    ['string', 'held', 'must be a list'],
    ['object', { held: true }, 'must be a list'],
    ['non-string item', [1], 'valid action names'],
    ['empty name', [''], 'valid action names'],
    ['invalid name', ['held invalid'], 'valid action names'],
    ['duplicate action', ['held', 'held'], 'must be unique'],
    ['unknown action', ['missing'], 'unknown action'],
  ])('rejects %s pageBreakBefore', (_label, value, message) => {
    const result = run(`
images={"a":Image.new("RGBA",(8,8)),"b":Image.new("RGBA",(8,8))}
anims={"idle":{"frames":["a"]},"held":{"frames":["b"]}}
error=None
try:m.pack_action_pages(images,anims,64,page_break_before=json.loads(${JSON.stringify(JSON.stringify(value))}))
except ValueError as exc:error=str(exc)
print(json.dumps({"error":error}))
`);
    expect(result.error).toContain(message);
  });

  it('rejects an explicit null author field and breaks on aliases without new crops', () => {
    const result = run(`
errors=[]
config, _, _=character_fixture()
config["pageBreakBefore"]=None
try:m.build_character("fixture",config,"fixture-only")
except ValueError as exc:errors.append(str(exc))
for flushed in [False,True]:
    images={"a":Image.new("RGBA",(40,40))}
    anims={"idle":{"frames":["a"]}}
    if flushed:
        images["b"]=Image.new("RGBA",(40,40))
        anims["other"]={"frames":["b"]}
    anims["reuse"]={"frames":["a"]}
    try:m.pack_action_pages(images,anims,64,page_break_before=["reuse"])
    except ValueError as exc:errors.append(str(exc))
print(json.dumps(errors))
`);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('pageBreakBefore must be a list');
    expect(result[1]).toContain('reuse: pageBreakBefore requires at least one newly encountered crop');
    expect(result[2]).toContain('reuse: pageBreakBefore requires at least one newly encountered crop');
  });

  it('does not split an oversized new action or relax the 4096 texture ceiling', () => {
    const result = run(`
errors=[]
images={"old":Image.new("RGBA",(8,8)),"held":Image.new("RGBA",(40,40)),"front":Image.new("RGBA",(40,40))}
try:m.pack_action_pages(images,{"idle":{"frames":["old"]},"held_throw":{"frames":["held"]}},64,{"held":"front"},["held_throw"])
except ValueError as exc:errors.append(str(exc))
try:m.pack_action_pages({"a":Image.new("RGBA",(8,8))},{"idle":{"frames":["a"]}},8192,page_break_before=["idle"])
except ValueError as exc:errors.append(str(exc.__cause__ or exc))
pages,_=m.pack_action_pages({"wide":Image.new("RGBA",(4092,4))},{"held_wide":{"frames":["wide"]}},4096,page_break_before=["held_wide"])
print(json.dumps({"errors":errors,"unchangedSizes":[list(images[name].size) for name in ["held","front"]],"maximumWidth":pages[0][0].width}))
`);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('held_throw: action group exceeds maxTextureSize');
    expect(result.errors[1]).toContain('between 64 and 4096');
    expect(result.unchangedSizes).toEqual([[40, 40], [40, 40]]);
    expect(result.maximumWidth).toBe(4096);
  });
});
