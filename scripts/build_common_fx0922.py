"""Split adopted common effects without painting or resampling any pixels."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def build():
    config = json.loads((ROOT / 'scripts/common_fx_manifest0922.json').read_text(encoding='utf-8'))
    crops = []
    for name, row in config['frames'].items():
        source = (ROOT / row['source']).resolve()
        if not source.is_relative_to(ROOT / 'public/assets/fx'):
            raise ValueError('FX source outside explicit asset directory')
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != row['sha256']:
            raise ValueError(f'Adopted source changed: {name}')
        image = Image.open(source).convert('RGBA')
        x, y, w, h = row['rect']
        if min(x, y) < 0 or min(w, h) <= 0 or x + w > image.width or y + h > image.height:
            raise ValueError(f'Invalid crop: {name}')
        crops.append((name, image.crop((x, y, x + w, y + h))))
    canvas = Image.new('RGBA', (sum(im.width + 4 for _, im in crops) + 4, max(im.height for _, im in crops) + 8))
    frames, evidence, cursor = {}, [], 4
    for name, im in crops:
        canvas.paste(im, (cursor, 4))
        check = canvas.crop((cursor, 4, cursor + im.width, 4 + im.height))
        if check.tobytes() != im.tobytes():
            raise ValueError(f'Pixel protection failed: {name}')
        frames[name] = {'frame': {'x': cursor, 'y': 4, 'w': im.width, 'h': im.height}, 'rotated': False, 'trimmed': False,
                        'spriteSourceSize': {'x': 0, 'y': 0, 'w': im.width, 'h': im.height}, 'sourceSize': {'w': im.width, 'h': im.height}}
        evidence.append({'name': name, **config['frames'][name], 'rgbaSha256': hashlib.sha256(im.tobytes()).hexdigest(), 'pixelsEqual': True})
        cursor += im.width + 4
    output = ROOT / 'public/assets/fx/common'
    output.mkdir(parents=True, exist_ok=True)
    image_path, atlas_path = output / 'atlas.png', output / 'atlas.json'
    if image_path.exists() or atlas_path.exists():
        raise FileExistsError('Keep prior common FX output; use an explicit new version for revisions')
    canvas.save(image_path)
    atlas_path.write_text(json.dumps({'frames': frames, 'meta': {'image': 'atlas.png', 'size': {'w': canvas.width, 'h': canvas.height}, 'scale': '1'}}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = {'kind': 'pixel-preserving-adopted-atlas-split', 'frames': evidence,
              'outputs': [{'file': str(p.relative_to(ROOT)).replace('\\', '/'), 'bytes': p.stat().st_size,
                           'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in (image_path, atlas_path)]}
    (ROOT / 'docs/assets/通用特效拆分0922.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    build()
