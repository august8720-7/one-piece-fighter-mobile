"""Validate provenance before reapplying presentation cues after older audio rebuilds."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
lines = json.loads((ROOT / 'src/audio/voiceLines0922.json').read_text(encoding='utf-8'))['lines']
for line in lines:
    path = ROOT / 'public' / line['file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != line['sha256']:
        raise ValueError(f'Voice source changed: {line["file"]}')
path = ROOT / 'src/audio/sampleManifest.json'
catalog = json.loads(path.read_text(encoding='utf-8'))
for character in ('luffy', 'akainu'):
    cue = dict(catalog['cues'][f'voice.{character}.idle'])
    cue.update(files=cue['files'][:1], priority=60, cooldownMs=0,
               note='Existing accepted short response; selection placement, no certified transcript.')
    catalog['cues'][f'voice.{character}.select'] = cue
for line in json.loads((ROOT / 'scripts/announcer_manifest_0922.json').read_text(encoding='utf-8-sig')):
    if not any(record['file'] == line['file'] and record['sha256'] == line['sha256'] for record in lines):
        raise ValueError('Announcer subtitle record differs from its verified sample')
    catalog['cues']['announcer.' + line['id']] = {
        'files': [line['file']], 'group': 'voice', 'gain': 0.72, 'priority': 95,
        'cooldownMs': 0, 'maxInstances': 1, 'source': 'docs/assets/人物台词与播报0922.md',
        'note': 'Original system-synthesized announcer, not KOF or character voice. Human audition pending.'}
path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'verifiedRuntimeFiles': len(lines), 'addedPresentationCues': 2 + sum(key.startswith('announcer.') for key in catalog['cues'])}))
