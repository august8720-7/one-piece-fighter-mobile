"""Deterministic processing only: existing recordings, no generated voice or music."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True)
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'scripts/daily_audio_manifest.json').read_text(encoding='utf-8'))
    credits = ROOT / 'public/assets/audio/music/CREDITS.txt'
    credits.parent.mkdir(parents=True, exist_ok=True)
    credits.write_bytes((ROOT / 'docs/assets/声音素材署名0914.txt').read_bytes())
    report = []
    for item in manifest['assets']:
        source, output = ROOT / item['source'], ROOT / item['output']
        raw = source.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item['sourceSha256']:
            raise ValueError(f'Source changed: {source}')
        output.parent.mkdir(parents=True, exist_ok=True)
        command = [args.ffmpeg, '-v', 'error', '-y']
        payload = None
        if 'archiveMember' in item:
            with zipfile.ZipFile(source) as archive:
                payload = archive.read(item['archiveMember'])
            command += ['-i', 'pipe:0']
        else:
            if 'start' in item:
                command += ['-ss', str(item['start']), '-t', str(item['duration'])]
            command += ['-i', str(source)]
        command += ['-af', item['filter'], '-ar', '44100', '-ac', '2' if output.suffix == '.ogg' else '1']
        if output.suffix == '.ogg':
            command += ['-c:a', 'libvorbis', '-q:a', '4']
        command += [str(output)]
        subprocess.run(command, input=payload, check=True)
        report.append({**item, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size,
                       'qa': 'Source hash and decoding checked; listening is tracked separately, not inferred from processing.'})
    out = ROOT / 'public/assets/audio/sources/daily-audio-processing-0914.json'
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    catalog = json.loads((ROOT / 'src/audio/sampleManifest.json').read_text(encoding='utf-8'))
    catalog['cues'].update(manifest['cues'])
    (ROOT / 'src/audio/sampleManifest.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'processed': len(report)}))


if __name__ == '__main__':
    main()
