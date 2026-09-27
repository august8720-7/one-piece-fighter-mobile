"""Inventory first, then copy original PNGs to unique project source paths."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
AUDIT = Path('D:/one-piece-fighter-crossover-0922/acceptance/imports')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pair', action='append', nargs=2, required=True, metavar=('DOWNLOADED_PNG', 'REPOSITORY_TARGET'))
    args = parser.parse_args()
    entries = []
    for original, relative in args.pair:
        source = Path(original).resolve()
        target = (ROOT / relative).resolve()
        if not target.is_relative_to(ROOT / 'public/assets/generated/source') or target.suffix != '.png':
            raise ValueError('Target must be an explicit generated/source PNG')
        if target.exists() or source.is_symlink() or not source.is_file():
            raise ValueError('Source missing/linked, or target already exists')
        with Image.open(source) as image:
            if image.format != 'PNG':
                raise ValueError('Keep the actual original PNG')
            size = list(image.size)
            image.verify()
        entries.append({'source': str(source), 'target': relative, 'bytes': source.stat().st_size,
                        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'size': size})
    if len({e['target'] for e in entries}) != len(entries):
        raise ValueError('Duplicate targets')
    if not (AUDIT / 'README.md').is_file():
        raise ValueError('Audit directory rules are required first')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    report = {'recordedAt': stamp, 'files': entries}
    (AUDIT / (stamp + '-before.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for entry in entries:
        target = ROOT / entry['target']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(entry['source'], target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('Original byte copy failed verification')
    report['verified'] = True
    verified = AUDIT / (stamp + '-verified.json')
    verified.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'copied': len(entries), 'verified': True, 'report': str(verified)}))


if __name__ == '__main__':
    main()
