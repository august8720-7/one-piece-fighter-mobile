"""Crop only the inspected Image 2.5 master; leave old character UI intact."""
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image
from build_anime_atlas import load_sources

ROOT = Path(__file__).resolve().parents[1]


def build():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('characters', nargs='*')
    args = parser.parse_args()
    specs = json.loads((ROOT / 'scripts/crossover_ui_manifest0922.json').read_text(encoding='utf-8'))['characters']
    sources = json.loads((ROOT / 'scripts/crossover_sources0922.json').read_text(encoding='utf-8'))['sources']
    selected = args.characters or list(specs)
    inputs = {}
    for character in selected:
        spec = specs[character]
        source = sources[spec['source']]
        if source.get('adoptionStatus') != 'shape_reviewed_candidate':
            raise ValueError(f'Character shape is not reviewed: {character}')
        inputs[spec['source']] = source
    images = load_sources(inputs)
    manifest_file = ROOT / 'src/render/anime/uiArtManifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    receipts = []
    for character in selected:
        spec = specs[character]
        source = sources[spec['source']]
        image = images[spec['source']]
        x, y, w, h = spec['crop']
        if min(x, y) < 0 or min(w, h) <= 0 or x + w > image.width or y + h > image.height:
            raise ValueError('UI crop outside inspected source')
        cropped = image.crop((x, y, x + w, y + h))
        dest = (ROOT / 'public' / spec['output']).resolve()
        if not dest.is_relative_to(ROOT / f'public/assets/characters/{character}/anime'):
            raise ValueError('UI output outside character namespace')
        if dest.exists():
            raise FileExistsError(f'Preserve existing UI master: {dest}')
        dest.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(dest)
        if Image.open(dest).convert('RGBA').tobytes() != cropped.tobytes():
            raise ValueError('UI crop pixel verification failed')
        px, py, pw, ph = spec['portrait']
        if min(px, py) < 0 or min(pw, ph) <= 0 or px + pw > w or py + ph > h:
            raise ValueError('Portrait crop outside body')
        record = {'image': str(dest.relative_to(ROOT / 'public')).replace('\\', '/'),
                  'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'width': w, 'height': h,
                  'frames': {'body': {'x': 0, 'y': 0, 'w': w, 'h': h}, 'portrait': {'x': px, 'y': py, 'w': pw, 'h': ph}},
                  'source': {'file': source['file'], 'sha256': source['sha256'], 'crop': spec['crop']},
                  'enabled': True, 'reviewStatus': 'corrected-static-shape-reviewed-candidate',
                  'processing': {'scale': 1, 'method': 'explicit crop; original RGBA preserved', 'pixelsEqual': True}}
        manifest['characters'][character] = record
        receipts.append({'character': character, **record})
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (ROOT / 'docs/assets/联动纠正界面裁切0922.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'characters': [r['character'] for r in receipts], 'pixelsVerified': True}))


if __name__ == '__main__':
    build()
