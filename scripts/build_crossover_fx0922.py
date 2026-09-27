"""Pack inspected official-web effect crops, preserving their original RGBA bytes."""
from pathlib import Path
import argparse
import hashlib
import io
import json
from PIL import Image
from build_anime_atlas import load_sources, rectangle

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'scripts/crossover_fx_manifest0922.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    spec_raw = SPEC.read_bytes()
    spec = json.loads(spec_raw)
    catalog = json.loads((ROOT / 'scripts/crossover_sources0922.json').read_text(encoding='utf-8'))['sources']
    source = catalog[spec['source']]
    if source.get('adoptionStatus') != 'shape_reviewed_candidate':
        raise ValueError('FX source has not been visually reviewed')
    sheet = load_sources({spec['source']: source})[spec['source']]
    expected = {'labubu': {'wind', 'impact', 'charge'}, 'twinkle': {'star', 'wave', 'impact', 'spark', 'shield'}}
    if set(spec['characters']) != set(expected):
        raise ValueError('Explicit crossover FX characters are required')
    outputs, receipts = {}, []
    for character, configured in spec['characters'].items():
        if set(configured) != expected[character]:
            raise ValueError(f'Incomplete FX frame set: {character}')
        cropped = []
        for name, raw_rect in configured.items():
            x, y, w, h = rectangle(raw_rect, sheet.width, sheet.height, f'{character}/{name}')
            crop = sheet.crop((x, y, x + w, y + h))
            if crop.getchannel('A').getbbox() is None:
                raise ValueError(f'Empty FX frame: {character}/{name}')
            # The inspected rectangle only trims effectively invisible outer noise.
            # No alpha threshold is applied to any retained pixel.
            edges = [crop.crop((0, 0, w, 1)), crop.crop((0, h - 1, w, h)),
                     crop.crop((0, 0, 1, h)), crop.crop((w - 1, 0, w, h))]
            edge_alpha = max(edge.getchannel('A').getextrema()[1] for edge in edges)
            if edge_alpha > spec['maxCropEdgeAlpha']:
                raise ValueError(f'FX crop cuts a visible glow: {character}/{name}')
            cropped.append((name, raw_rect, crop, edge_alpha))
        canvas = Image.new('RGBA', (sum(c.width + 8 for _, _, c, _ in cropped) + 8,
                                    max(c.height for _, _, c, _ in cropped) + 16))
        if max(canvas.size) > 4096:
            raise ValueError('FX page exceeds texture limit')
        frames, records, cursor = {}, [], 8
        for name, rect, crop, edge_alpha in cropped:
            canvas.paste(crop, (cursor, 8))
            actual = canvas.crop((cursor, 8, cursor + crop.width, 8 + crop.height))
            if actual.tobytes() != crop.tobytes():
                raise ValueError('FX RGBA protection failed')
            frames[name] = {'frame': {'x': cursor, 'y': 8, 'w': crop.width, 'h': crop.height},
                            'rotated': False, 'trimmed': False,
                            'spriteSourceSize': {'x': 0, 'y': 0, 'w': crop.width, 'h': crop.height},
                            'sourceSize': {'w': crop.width, 'h': crop.height}}
            records.append({'name': name, 'crop': rect, 'rgbaSha256': digest(crop.tobytes()),
                            'pixelsEqual': True, 'maxCropEdgeAlpha': edge_alpha})
            cursor += crop.width + 8
        png = io.BytesIO()
        canvas.save(png, format='PNG')
        atlas = {'frames': frames, 'meta': {'image': 'atlas.png', 'size': {'w': canvas.width, 'h': canvas.height},
                 'scale': '1', 'manifestSha256': digest(spec_raw), 'sourceSha256': source['sha256']}}
        folder = ROOT / 'public/assets/fx' / character
        outputs[folder / 'atlas.png'] = png.getvalue()
        outputs[folder / 'atlas.json'] = (json.dumps(atlas, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        receipts.append({'character': character, 'frames': records, 'size': canvas.size})
    # Validate every output before writing any file. Existing differing art is never overwritten.
    for path, data in outputs.items():
        if path.exists() and path.read_bytes() != data:
            raise FileExistsError(f'Preserve prior FX output: {path}')
    report = {'source': {key: source[key] for key in ('file', 'sha256', 'model', 'provider', 'sessionUrl', 'prompt', 'modelEvidence')},
              'manifestSha256': digest(spec_raw), 'processing': 'explicit crop and byte-preserving packing only; no generated pixels, alpha filtering, rescale or color change',
              'characters': receipts, 'outputs': [{'file': p.relative_to(ROOT).as_posix(), 'bytes': len(data), 'sha256': digest(data)} for p, data in outputs.items()]}
    if not args.check:
        for path, data in outputs.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                path.write_bytes(data)
        (ROOT / 'docs/assets/联动技能特效裁切0922.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'checkOnly': args.check, 'characters': [r['character'] for r in receipts], 'frames': sum(len(r['frames']) for r in receipts), 'pixelsVerified': True}))


if __name__ == '__main__':
    build()
