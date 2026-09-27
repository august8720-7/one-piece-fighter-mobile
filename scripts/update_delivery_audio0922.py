"""Add approved runtime clips to the existing delivery manifest without re-encoding art/music."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def main(ffmpeg, repack_presentation=False):
    path = ROOT / 'src/render/deliveryManifest.json'
    original = path.read_bytes()
    manifest = json.loads(original)
    records = manifest['records']
    cues = json.loads((ROOT / 'src/audio/sampleManifest.json').read_text(encoding='utf-8'))['cues']
    sources = sorted({file for cue in cues.values() for file in cue['files']})
    presentation = {file for cue_id, cue in cues.items()
                    if cue_id.startswith('announcer.') or cue_id.endswith('.select') or cue_id in ('menu_move', 'menu_confirm')
                    for file in cue['files']} if repack_presentation else set()
    changed = [source for source in sources if source in presentation or source not in records or records[source]['sourceSha256'] != digest((PUBLIC / source).read_bytes())]
    if not changed:
        print(json.dumps({'changed': 0, 'version': manifest['version']}))
        return
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    report_dir = ROOT / '.local-releases/操作演出-0922/acceptance' / ('audio-delivery-' + stamp)
    report_dir.mkdir(parents=True, exist_ok=False)
    (report_dir / 'manifest-before.json').write_bytes(original)
    chunks = bytearray()
    slices = []
    temporary = Path(tempfile.mkdtemp(prefix='opf-audio-delivery-0922-'))
    for index, source in enumerate(changed):
        target = temporary / f'{index}.ogg'
        subprocess.run([str(ffmpeg), '-nostdin', '-v', 'error', '-i', str(PUBLIC / source),
                        '-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on', '-application', 'audio',
                        '-frame_duration', '10', '-fflags', '+bitexact', '-flags:a', '+bitexact',
                        '-map_metadata', '-1', str(target)], check=True)
        clip = target.read_bytes()
        slices.append((source, len(chunks), len(clip)))
        chunks.extend(clip)
    data = bytes(chunks)
    output = 'assets/delivery/audio-extra-0922-' + digest(data)[:20] + '.bin'
    target = PUBLIC / output
    if target.exists() and target.read_bytes() != data:
        raise ValueError('Content hash collision')
    if not target.exists():
        target.write_bytes(data)
    for source, offset, length in slices:
        records[source] = {'file': output, 'sha256': digest(data), 'bytes': len(data), 'contentType': 'audio/ogg',
                           'source': source, 'sourceSha256': digest((PUBLIC / source).read_bytes()),
                           'slice': {'offset': offset, 'length': length}}
    old_records = json.loads(original)['records']
    for logical, record in old_records.items():
        if logical not in changed and records[logical] != record:
            raise ValueError('Unrelated delivery record changed: ' + logical)
    manifest['version'] = digest(encode(records))
    path.write_bytes(encode(manifest))
    report = {'version': manifest['version'], 'changed': changed, 'newBytes': len(data), 'file': output,
              'artAndMusicUnchanged': True, 'originalManifestSha256': digest(original), 'codec': 'opus-96k',
              'presentationBank': repack_presentation,
              'audioAcceptance': 'pending separate runtime/listening checks'}
    (report_dir / 'report.json').write_bytes(encode(report))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--repack-presentation', action='store_true', help='Pack menu feedback, replies and announcer together instead of loading entire battle banks before the title.')
    args = parser.parse_args()
    main(args.ffmpeg, args.repack_presentation)
