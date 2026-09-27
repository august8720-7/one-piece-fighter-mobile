"""Merge explicitly selected, hash-checked local voice clips; never infer move names."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def validate_content_review(root: Path, entry: dict, selection: dict) -> None:
    """A user-approved voice identity does not certify newly generated wording."""
    review = entry.get('contentReview', {})
    identity = review.get('identityReference', {})
    accepted_identity = any(
        other['character'] == entry['character'] and other['event'] == 'select'
        and other.get('approval', {}).get('kind') == 'user_audition_exact_clip'
        and any(clip['path'] == identity.get('path') and clip['sha256'] == identity.get('sha256')
                for clip in other['clips']) for other in selection['cues'])
    if review.get('voiceIdentityUserApproved') is not True or not accepted_identity:
        raise ValueError('New dialogue requires its own approved character identity reference')
    actual = review.get('actualContentReview', {})
    if (actual.get('kind') != 'agent_audio_model' or actual.get('userAuditioned') is not False
            or actual.get('status') != 'accepted' or actual.get('inputAudioAttached') is not True):
        raise ValueError('New dialogue requires explicit internal content review, separate from user audition')
    response_text = None
    evidence = actual.get('evidence', [])
    if not evidence:
        raise ValueError('Content review evidence is missing')
    for record in evidence:
        data = (root / record['path']).read_bytes()
        if hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError('Content review evidence changed')
        if record['role'] == 'response':
            if response_text is not None:
                raise ValueError('Ambiguous content review response')
            response_text = data.decode('utf-8-sig')
    for clip in entry['clips']:
        if (actual.get('audioSha256') != clip['sha256'] or not clip.get('transcript')
                or actual.get('transcript') != clip['transcript']
                or response_text is None or clip['transcript'] not in response_text):
            raise ValueError('Content review is not bound to the adopted audio and transcript')


def apply_voices(root: Path, catalog: dict) -> dict:
    selection = json.loads((root / 'scripts/voice_manifest.json').read_text(encoding='utf-8-sig'))
    subtitle_path = root / 'src/audio/voiceLines0922.json'
    subtitles = json.loads(subtitle_path.read_text(encoding='utf-8-sig'))['lines'] if subtitle_path.exists() else []
    result = {key: value for key, value in catalog.items() if not key.startswith('voice.')}
    for entry in selection['cues']:
        character, event = entry['character'], entry['event']
        if character not in ('luffy', 'akainu', 'labubu', 'twinkle') or event not in ('attack', 'hurt', 'ko', 'win', 'effort', 'move', 'idle', 'select'):
            raise ValueError('Only reviewed characters and generic event uses are allowed')
        if character in ('labubu', 'twinkle') or event == 'select':
            if entry.get('reviewStatus') != 'accepted' or not entry.get('evidence'):
                raise ValueError('New voice cues require explicit content review evidence')
        if character in ('labubu', 'twinkle') and event != 'select':
            validate_content_review(root, entry, selection)
        cue_id = f'voice.{character}.{event}'
        if cue_id in result:
            raise ValueError(f'Duplicate voice cue: {cue_id}')
        files = []
        for clip in entry['clips']:
            relative = Path(clip['path'])
            allowed = (root / 'public/assets/audio/voice' / character).resolve()
            path = (root / relative).resolve()
            if not path.is_relative_to(allowed) or path.suffix.lower() not in ('.wav', '.mp3'):
                raise ValueError(f'Invalid voice path: {relative}')
            if hashlib.sha256(path.read_bytes()).hexdigest() != clip['sha256']:
                raise ValueError(f'Voice content changed: {relative}')
            file = path.relative_to((root / 'public').resolve()).as_posix()
            if event == 'select' or 'transcript' in clip:
                matches = [line for line in subtitles if line['file'] == file]
                if (len(matches) != 1 or not clip.get('transcript')
                        or not matches[0].get('transcriptVerified')
                        or matches[0].get('sha256') != clip['sha256']
                        or matches[0].get('original') != clip['transcript']
                        or matches[0].get('translation') != clip.get('translation', clip['transcript'])):
                    raise ValueError(f'Voice subtitle is not bound to the reviewed file: {relative}')
            files.append(file)
        if not files:
            raise ValueError(f'Empty voice cue: {cue_id}')
        result[cue_id] = {
            'files': files, 'group': 'voice', 'characterId': character,
            'gain': 0.85 if event != 'hurt' else 0.65,
            'source': entry.get('evidence', selection['evidence']),
            'note': entry.get('note', 'User confirmed character voice in audition; generic game-event placement is an implementation choice. Exact words and named moves are not certified.'),
        }
        if event in ('idle', 'move', 'effort'):
            if event == 'idle' and entry.get('reviewStatus') != 'accepted':
                raise ValueError('Idle lines require explicit semantic listening evidence')
            result[cue_id].update(priority=10 if event == 'idle' else 9 if event == 'move' else 50,
                                  gain=0.7 if event == 'idle' else 0.62,
                                  cooldownMs=0 if event in ('idle', 'move') else 450,
                                  maxInstances=1)
        elif event == 'select':
            result[cue_id].update(priority=60, gain=0.7, cooldownMs=0, maxInstances=1)
        playback = entry.get('playback', {})
        if set(playback) - {'gain', 'cooldownMs'}:
            raise ValueError('Unsupported voice playback setting')
        if 'gain' in playback and (type(playback['gain']) not in (int, float) or not 0 <= playback['gain'] <= 1):
            raise ValueError('Invalid voice gain')
        if 'cooldownMs' in playback:
            cooldown = playback['cooldownMs']
            if type(cooldown) is not int or cooldown < 0:
                raise ValueError('Invalid voice cooldown')
            if event == 'attack' and any(cooldown < 1000 * (clip['source_end_seconds'] - clip['source_start_seconds']) for clip in entry['clips']):
                raise ValueError('Attack voice cooldown must cover the complete adopted clip')
        result[cue_id].update(playback)
    return result


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    path = root / 'src/audio/sampleManifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8-sig'))
    manifest['cues'] = apply_voices(root, manifest['cues'])
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'voice_cues': sum(key.startswith('voice.') for key in manifest['cues'])}))
