"""Deterministic post-processing of GPT Image 2.5 website originals (no drawing).

Inputs remain unchanged in public/assets/generated/source. Crops, alpha extraction,
feathering, resizing and packing only. Run after checking the original images.
"""
from pathlib import Path
import argparse
import json
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets'
SOURCE = ASSETS / 'generated/source'

def stage():
    original = SOURCE / 'marineford-main-0911.png'
    if not original.exists():
        return
    im = Image.open(original).convert('RGB')
    dest = ASSETS / 'stages/marineford'
    dest.mkdir(parents=True, exist_ok=True)
    # Matched horizontal bands from the same original preserve lighting/perspective.
    im.save(dest / 'backdrop.webp', quality=91)
    floor = im.crop((0, 675, im.width, im.height)).convert('RGBA')
    alpha = Image.new('L', floor.size, 255)
    for y in range(36):
        alpha.paste(round(255*y/35), (0, y, floor.width, y+1))
    floor.putalpha(alpha)
    floor.save(dest / 'floor.webp', lossless=True)

def effects(character, names):
    original = SOURCE / f'{character}-effects-0911.png'
    if not original.exists():
        return
    im = Image.open(original).convert('RGB')
    atlas = Image.new('RGBA', (1024, 1024))
    frames = {}
    for index, name in enumerate(names):
        col, row = index % 3, index // 3
        tile = im.crop((round(col*im.width/3), round(row*im.height/3), round((col+1)*im.width/3), round((row+1)*im.height/3)))
        # Black matte extraction with unpremultiplied colors retains soft smoke/fire edges.
        rgba = tile.convert('RGBA')
        pixels = []
        for r,g,b in tile.getdata():
            peak = max(r,g,b)
            a = max(0, min(255, round((peak-9)*255/60)))
            pixels.append((min(255,round(r*255/a)),min(255,round(g*255/a)),min(255,round(b*255/a)),a) if a else (0,0,0,0))
        rgba.putdata(pixels)
        if character == 'akainu' and name == 'meteor':
            # The verified original's flame crosses its top border. Fade only that
            # cropped tail edge; retain the original molten fist and lower trail.
            alpha = rgba.getchannel('A')
            fade_rows = max(2, round(rgba.height * 0.14))
            for y in range(fade_rows):
                weight = y / (fade_rows - 1)
                weight = weight * weight * (3 - 2 * weight)
                alpha_row = alpha.crop((0, y, rgba.width, y + 1))
                alpha_row = alpha_row.point(lambda value: round(value * weight))
                alpha.paste(alpha_row, (0, y))
            rgba.putalpha(alpha)
        bbox = rgba.getbbox()
        if not bbox:
            raise ValueError(f'Empty effect {name}')
        rgba = rgba.crop(bbox)
        rgba.thumbnail((320,320), Image.Resampling.LANCZOS)
        x,y = col*340+(320-rgba.width)//2+10,row*340+(320-rgba.height)//2+10
        atlas.alpha_composite(rgba,(x,y))
        frames[name]={'frame':{'x':x,'y':y,'w':rgba.width,'h':rgba.height},'rotated':False,'trimmed':False,'spriteSourceSize':{'x':0,'y':0,'w':rgba.width,'h':rgba.height},'sourceSize':{'w':rgba.width,'h':rgba.height}}
    dest=ASSETS/'fx'
    dest.mkdir(parents=True,exist_ok=True)
    atlas.save(dest/f'{character}.png',optimize=True)
    (dest/f'{character}.json').write_text(json.dumps({'frames':frames,'meta':{'image':f'{character}.png','size':{'w':1024,'h':1024},'scale':'1'}},indent=2),encoding='utf-8')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=['all', 'stage', 'akainu', 'luffy'], default='all')
    scope = parser.parse_args().only
    if scope in ('all', 'stage'):
        stage()
    if scope in ('all', 'akainu'):
        effects('akainu',['dog','meteor','magma_fist','eruption','fissure','pierce','flame','smoke','melt'])
    if scope in ('all', 'luffy'):
        effects('luffy',['rubber_fist','gatling','giant_fist','red_hawk','shockwave','steam','rebound','wind','impact'])
