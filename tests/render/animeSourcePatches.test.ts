import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const python = (body: string) => JSON.parse(execFileSync('python', ['-c', `
import importlib.util,json,sys,hashlib,copy
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location("builder",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from PIL import Image
${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' }));

describe('same-coordinate original PNG source patches', () => {
  it('replaces exact RGBA before cropping, keeps alpha bytes and protects both source images', () => {
    const result = python(`
original=Image.new("RGBA",(8,6),(91,71,51,0));original.paste((180,60,40,255),(2,1,8,5))
repair=Image.new("RGBA",(8,6),(230,170,20,255))
repair.putpixel((4,1),(15,30,200,128));repair.putpixel((5,2),(51,66,77,0))
before=original.tobytes();repair_before=repair.tobytes()
patches=[{"source":"repair","rect":[4,1,2,2]},{"source":"repair","rect":[6,1,2,2]}]
sources={"repair":repair}
merged,proof=m.apply_source_patches(original,patches,sources)
config={"source":"body","sourcePatches":patches,"crop":[2,0,6,6],"root":[1,7],"sockets":{"head":[3,2]},"transparency":{"mode":"source-alpha"}}
frame,geometry,stats=m.prepare_frame(original,config,1,sources)
untouched=bytearray();outside_changed=0
for y in range(original.height):
    for x in range(original.width):
        inside=4<=x<8 and 1<=y<3
        if not inside:
            untouched.extend(original.getpixel((x,y)))
            outside_changed+=original.getpixel((x,y))!=merged.getpixel((x,y))
assert merged.tobytes()==m.apply_source_patches(original,patches,sources)[0].tobytes()
print(json.dumps({"proof":proof,"expectedProtectedHash":hashlib.sha256(untouched).hexdigest(),"outsideChanged":outside_changed,"originalUnchanged":before==original.tobytes(),"repairUnchanged":repair_before==repair.tobytes(),"partialAlpha":frame.getpixel((2,1)),"hiddenRgb":frame.getpixel((3,2)),"bodyPixel":frame.getpixel((0,1)),"geometry":geometry,"reportedBeforeCrop":stats["sourcePatches"]["canvas"]}))
`);
    expect(result.originalUnchanged).toBe(true);
    expect(result.repairUnchanged).toBe(true);
    expect(result.outsideChanged).toBe(0);
    expect(result.partialAlpha).toEqual([15, 30, 200, 128]);
    expect(result.hiddenRgb).toEqual([51, 66, 77, 0]);
    expect(result.bodyPixel).toEqual([180, 60, 40, 255]);
    expect(result.proof).toMatchObject({ patchedPixels: 8, protectedPixels: 40, protectedPixelsChanged: 0, protectedBeforeRgbaSha256: result.expectedProtectedHash, protectedAfterRgbaSha256: result.expectedProtectedHash });
    for (const patch of result.proof.patches) expect(patch.patchRgbaSha256).toBe(patch.afterRgbaSha256);
    expect(result.reportedBeforeCrop).toEqual([8, 6]);
    expect(result.geometry).toEqual({ size: { width: 6, height: 6 }, root: { x: 1, y: 7 }, sockets: { head: { x: 3, y: 2 } } });
  });

  it('rejects invalid dimensions, coordinates, overlaps and undeclared transformations without mutating sources', () => {
    const result = python(`
image=Image.new("RGBA",(8,8),(0,0,0,0));image.putpixel((3,3),(180,40,10,255));before=image.tobytes()
sources={"repair":image.copy(),"other":image.copy(),"wrong_size":Image.new("RGBA",(8,9))}
valid={"source":"repair","rect":[2,2,3,3]}
cases={"empty":[],"not_list":valid,"unknown":[{**valid,"source":"missing"}],"different_size":[{**valid,"source":"wrong_size"}],"extra_destination":[{**valid,"destination":[1,1]}],"not_object":["repair"]}
for name,rect in {"negative":[-1,2,3,3],"bool":[True,2,3,3],"fraction":[2,2,3.5,3],"empty_rect":[2,2,0,3],"overflow":[6,2,3,3],"missing_dimension":[2,2,3]}.items():cases[name]=[{**valid,"rect":rect}]
cases["duplicate"]=[valid,valid];cases["overlap"]=[valid,{"source":"other","rect":[4,4,2,2]}]
errors={}
for name,patches in cases.items():
    try:m.apply_source_patches(image,patches,sources)
    except ValueError as error:errors[name]=str(error)
config={"crop":[0,0,8,8],"root":[4,8],"sockets":{},"sourcePatches":[valid],"transparency":{"mode":"source-alpha"}}
for name,args in [("missing_loaded_sources",(image,config,1)),("local_transform",(image,{**config,"transform":{"type":"magma-straight"}},1,sources))]:
    try:m.prepare_frame(*args)
    except ValueError as error:errors[name]=str(error)
print(json.dumps({"errors":errors,"allRejected":len(errors)==len(cases)+2,"sourceUnchanged":image.tobytes()==before}))
`);
    expect(result.allRejected).toBe(true);
    expect(result.sourceUnchanged).toBe(true);
    expect(result.errors.unknown).toContain('unknown source');
    expect(result.errors.different_size).toContain('dimensions must match');
    expect(result.errors.duplicate).toContain('duplicate or overlapping');
    expect(result.errors.overlap).toContain('duplicate or overlapping');
    expect(result.errors.missing_loaded_sources).toContain('loaded sources map');
    expect(result.errors.local_transform).toContain('local geometry transform');
  });

  it('uses the normal provenance and PNG hash loader for both sources and reports the patch in the built atlas', () => {
    const result = python(`
from pathlib import Path
from tempfile import TemporaryDirectory
with TemporaryDirectory(prefix="opf-source-patch-test-") as directory:
    # Synthetic test fixtures only, confined to the temporary test root; never production evidence.
    m.ROOT=Path(directory);images=m.ROOT/"public/assets/generated/source";evidence=m.ROOT/"docs/assets"
    images.mkdir(parents=True);evidence.mkdir(parents=True)
    model=evidence/"model.txt";prompt=evidence/"prompt.txt"
    model.write_text("SYNTHETIC TEST FIXTURE - not actual model evidence",encoding="utf-8");prompt.write_text("SYNTHETIC TEST FIXTURE - no art generation",encoding="utf-8")
    record=lambda path:{"file":path.relative_to(m.ROOT).as_posix(),"sha256":m.digest(path.read_bytes())}
    original=Image.new("RGBA",(8,8),(0,255,0,255));original.paste((180,40,20,255),(1,1,7,7));original.save(images/"body.png")
    repair=original.copy();repair.putpixel((2,2),(0,255,0,255));repair.putpixel((3,2),(20,60,200,255));repair.save(images/"repair.png")
    base={"model":"GPT Image 2.5","provider":"chatgpt-web","sessionUrl":"https://chatgpt.com/c/synthetic-test","generatedAt":"2026-09-14","modelEvidence":record(model),"prompt":record(prompt)}
    sources={key:{**base,**record(images/(key+".png"))} for key in ["body","repair"]}
    # A donor's unrelated unit scale must never scale the pasted region or original body.
    sources["repair"].update({"unitScale":2,"scaleBasis":"Synthetic loader/packing fixture, not an art calibration"})
    frame={"source":"body","sourcePatches":[{"source":"repair","rect":[2,2,2,1]}],"crop":[1,1,6,6],"root":[2,8],"sockets":{"head":[3,2]},"transparency":{"mode":"border-key","color":[0,255,0],"tolerance":0,"seeds":[[1,1]]}}
    config={"scale":1,"maxTextureSize":64,"sources":sources,"frames":{"pose":frame},"anims":{"idle":{"frames":["pose"],"loop":True,"exposures":[{"frame":0,"ticks":8}]}}}
    outputs,report=m.build_character("fixture",config,"synthetic-test")
    assert outputs==m.build_character("fixture",config,"synthetic-test")[0]
    atlas=json.loads(outputs["atlas.json"]);where=atlas["frames"]["fixture/idle/0"]["frame"]
    import io
    png=Image.open(io.BytesIO(outputs["atlas.png"])).convert("RGBA");ox,oy=where["x"],where["y"]
    proof=report["transparency"]["pose"]["sourcePatches"]
    errors={}
    for key in ["body","repair"]:
        broken=copy.deepcopy(config);broken["sources"][key]["sha256"]="0"*64
        try:m.build_character("fixture",broken,"synthetic-test")
        except ValueError as error:errors[key]=str(error)
    broken=copy.deepcopy(config);broken["sources"]["repair"]["model"]="unverified"
    try:m.build_character("fixture",broken,"synthetic-test")
    except ValueError as error:errors["model"]=str(error)
    print(json.dumps({"proof":proof,"sourceHashes":report["sourceHashes"],"geometry":json.loads(outputs["runtime.json"])["attachments"]["fixture/idle/0"],"patchedKeyPixel":png.getpixel((ox+1,oy+1)),"patchedArtPixel":png.getpixel((ox+2,oy+1)),"errors":errors}))
`);
    expect(result.proof.originalSource).toBe('body');
    expect(result.proof.originalSourceSha256).toBe(result.sourceHashes.body);
    expect(result.proof.patches[0].sourceSha256).toBe(result.sourceHashes.repair);
    expect(result.proof.protectedBeforeRgbaSha256).toBe(result.proof.protectedAfterRgbaSha256);
    expect(result.geometry.size).toEqual({ width: 6, height: 6 });
    expect(result.geometry.root).toEqual({ x: 2, y: 8 });
    expect(result.patchedKeyPixel[3]).toBe(0);
    expect(result.patchedArtPixel).toEqual([20, 60, 200, 255]);
    expect(result.errors.body).toContain('body: SHA256 mismatch');
    expect(result.errors.repair).toContain('repair: SHA256 mismatch');
    expect(result.errors.model).toContain('only recorded GPT Image 2.5');
  });
});
