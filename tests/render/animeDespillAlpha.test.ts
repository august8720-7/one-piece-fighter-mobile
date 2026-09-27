import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const python = (body: string) => JSON.parse(execFileSync('python', ['-c', `
import importlib.util,json,sys,copy
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location("builder",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from PIL import Image
${body}
`, resolve('scripts/build_anime_atlas.py')], { encoding: 'utf8' }));

describe('explicit original-green alpha feathering', () => {
  it('uses pre-despill pixels, preserves RGB and white/red art, and applies overlapping regions once', () => {
    const result = python(`
im=Image.new("RGBA",(20,12),(0,255,0,255))
im.paste((12,12,12,255),(2,2,18,10))
for x,p in enumerate([(120,160,40,255),(100,164,40,255),(120,160,40,128),(239,241,239,255),(255,255,255,255),(220,80,15,255),(120,160,40,255)],4):im.putpixel((x,5),p)
base={"color":[0,255,0],"tolerance":16,"despill":True,"despillConnected":True,"despillRegions":[[4,5,7,1]],"despillSourceSha256":"0"*64,"despillNote":"Synthetic enclosed source pixels; no files generated."}
plain,_=m.remove_border_key(im,base)
feather={"regions":[[4,5,6,1],[4,5,3,1]],"minGreenExcess":16,"fullGreenExcess":64}
original=im.tobytes();out,stats=m.remove_border_key(im,{**base,"despillAlphaFeather":feather})
changes=[(x,y)for y in range(12)for x in range(20)if out.getpixel((x,y))!=plain.getpixel((x,y))]
print(json.dumps({"plain":[plain.getpixel((x,5))for x in range(4,11)],"out":[out.getpixel((x,5))for x in range(4,11)],"changed":changes,"originalUnchanged":im.tobytes()==original,"stats":stats}))
`);
    expect(result.changed).toEqual([[4, 5], [5, 5], [6, 5]]);
    expect(result.originalUnchanged).toBe(true);
    expect(result.out[0]).toEqual([...result.plain[0].slice(0, 3), 108]);
    expect(result.out[1]).toEqual([...result.plain[1].slice(0, 3), 0]);
    expect(result.out[2]).toEqual([...result.plain[2].slice(0, 3), 54]);
    expect(result.out.slice(3)).toEqual(result.plain.slice(3));
    expect(result.out[4]).toEqual([255, 255, 255, 255]);
    expect(result.out[5]).toEqual([220, 80, 15, 255]);
    expect(result.stats.despillAlphaFeather.changedPixels).toBe(3);
  });

  it('rejects unbound or invalid local transparency configuration and changed source hashes', () => {
    const result = python(`
im=Image.new("RGBA",(8,8),(0,255,0,255));im.paste((120,160,40,255),(2,2,6,6))
base={"color":[0,255,0],"tolerance":16,"despill":True,"despillSourceSha256":"0"*64,"despillNote":"Synthetic source-bound local region."}
feather={"regions":[[2,2,2,2]],"minGreenExcess":16,"fullGreenExcess":64}
cases=[{**base,"despill":False},{**base,"despillNote":""},{**base,"despillSourceSha256":"bad"}]
patches=[{"regions":[]},{"regions":[[7,7,2,2]]},{"minGreenExcess":True},{"minGreenExcess":64},{"fullGreenExcess":256},{"minGreenExcess":-1},{"mode":"erase"}]
cases += [{**base,"despillAlphaFeather":{**feather,**patch}}for patch in patches]
errors=[]
for config in cases:
    config.setdefault("despillAlphaFeather",feather)
    try:m.remove_border_key(im,config)
    except ValueError as e:errors.append(str(e))
try:m.prepare_frame(im,{"crop":[0,0,8,8],"root":[0,8],"sockets":{},"transparency":{"mode":"source-alpha","despillAlphaFeather":feather}},1)
except ValueError as e:errors.append(str(e))
# Source-loader integrity is independently tested. This isolates the builder's binding gate.
m.load_sources=lambda _: {"body":im}
try:m.build_character("fixture",{"scale":1,"sources":{"body":{"sha256":"1"*64}},"frames":{"active":{"source":"body","transparency":{**base,"despillAlphaFeather":feather}}}},"2"*64)
except ValueError as e:errors.append(str(e))
print(json.dumps(errors))
`);
    expect(result).toHaveLength(12);
    expect(result.at(-2)).toContain('requires border-key transparency');
    expect(result.at(-1)).toContain('local despill source SHA256 mismatch');
  });
});
