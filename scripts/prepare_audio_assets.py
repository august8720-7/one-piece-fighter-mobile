"""Deterministic recording-based Foley and voice-candidate preparation.

Requires numpy + soundfile. Optional --deps prepends a local dependency directory.
No speech synthesis, download, source deletion, or global installation occurs.
Recorded effects are presentation candidates; signal checks are not listening QA.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import wave
from apply_voice_manifest import apply_voices


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deps', type=Path)
    parser.add_argument('--ffmpeg', required=True, type=Path)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    if args.deps:
        sys.path.insert(0, str(args.deps))
    import numpy as np
    import soundfile as sf

    root = args.root.resolve()
    audio = root / 'public/assets/audio'
    sources = audio / 'sources'
    out = audio / 'sfx'
    out.mkdir(parents=True, exist_ok=True)
    rate = 44100
    cache: dict = {}
    sources_used: dict = {}
    products: list = []
    catalog: dict = {}
    rendered: dict = {}
    source_groups = {
        'hits': ('https://opengameart.org/content/37-hitspunches', 'Independent.nu; submitted by qubodup', 'CC0'),
        'swish': ('https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes', 'qubodup / Iwan Gabovitch', 'CC0'),
        'fire-1.wav': ('https://opengameart.org/content/fire-crackling', 'AntumDeluge', 'CC0'),
        'cannon_fire.ogg': ('https://opengameart.org/content/cannon-fire', 'Thimras', 'CC0'),
        'wind_background_noise_2.wav': ('https://opengameart.org/content/mild-wind-background-noise', 'Bashar3A / Bashar from Skirmish.io', 'CC0'),
        'akainu_pw4_LelknEdihUw.webm': ('https://www.youtube.com/watch?v=LelknEdihUw', 'Dude! Rude!; One Piece Pirate Warriors 4 original game voice', 'Copyrighted game audio; local private candidate only; redistribution permission not established'),
        'luffy_pw4_QwK-FAA-VRU.webm': ('https://www.youtube.com/watch?v=QwK-FAA-VRU', 'Dude! Rude!; One Piece Pirate Warriors 4 original game voice', 'Copyrighted game audio; local private candidate only; redistribution permission not established'),
    }

    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def load(name):
        if name not in cache:
            path = sources / name
            if path.suffix == '.webm':
                raw = subprocess.check_output([str(args.ffmpeg), '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(rate), '-f', 'f32le', 'pipe:1'])
                data = np.frombuffer(raw, dtype='<f4').astype(float)
                original_rate = rate
            else:
                data, original_rate = sf.read(path, dtype='float64')
                if data.ndim > 1:
                    data = data.mean(axis=1)
                if original_rate != rate:
                    data = np.interp(np.arange(round(len(data) * rate / original_rate)) * original_rate / rate, np.arange(len(data)), data)
            data = data - np.mean(data)
            cache[name] = data
            url, author, license_text = source_groups[name.split('/')[0]]
            sources_used[name] = {'path': path.relative_to(root).as_posix(), 'sha256': sha(path), 'duration_seconds': round(len(data) / rate, 6), 'original_sample_rate': original_rate, 'url': url, 'author': author, 'license': license_text}
        return cache[name]

    def part(name, start=0.0, duration=None, speed=1.0, gain=1.0, reverse=False, lowpass=None, highpass=None, trim=False, offset=0.0):
        return dict(file=name, start=start, duration=duration, speed=speed, gain=gain, reverse=reverse, lowpass=lowpass, highpass=highpass, trim=trim, offset=offset)

    def render_part(spec):
        data = load(spec['file'])
        start = spec['start']
        end = len(data) / rate if spec['duration'] is None else min(len(data) / rate, start + spec['duration'])
        selected = data[round(start * rate):round(end * rate)].copy()
        if spec['trim']:
            # Only remove recorded silence; leave a short onset and decay margin.
            nz = np.flatnonzero(np.abs(selected) > max(0.0015, float(np.max(np.abs(selected))) * 0.018))
            if len(nz):
                lo, hi = max(0, int(nz[0]) - 441), min(len(selected), int(nz[-1]) + 2205)
                start += lo / rate
                end = start + (hi - lo) / rate
                selected = selected[lo:hi]
        if spec['reverse']:
            selected = selected[::-1]
        if spec['speed'] != 1:
            selected = np.interp(np.arange(max(1, round(len(selected) / spec['speed']))) * spec['speed'], np.arange(len(selected)), selected)
        if spec['lowpass'] or spec['highpass']:
            # Smooth FFT roll-off avoids adding any generated oscillator/noise.
            frequencies = np.fft.rfftfreq(len(selected), 1 / rate)
            spectrum = np.fft.rfft(selected)
            if spec['lowpass']:
                spectrum *= 1 / np.sqrt(1 + (frequencies / spec['lowpass']) ** 8)
            if spec['highpass']:
                spectrum *= 1 / np.sqrt(1 + (spec['highpass'] / np.maximum(frequencies, 1)) ** 8)
            selected = np.fft.irfft(spectrum, n=len(selected))
        peak = max(float(np.max(np.abs(selected))), 0.00001)
        selected = selected / peak * spec['gain']
        return selected, {**spec, 'actual_source_start': round(start, 6), 'actual_source_end': round(end, 6), 'source_sha256': sources_used[spec['file']]['sha256']}

    def write_wav(path, samples):
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes((np.clip(samples, -0.9999, 0.9999) * 32767).round().astype('<i2').tobytes())

    def make(name, recipe, max_seconds=0.8, peak=0.78, fade_in=0.004, fade_out=0.055, group='sfx'):
        parts = [render_part(spec) for spec in recipe]
        length = min(round(max_seconds * rate), max(round(spec['offset'] * rate) + len(data) for data, spec in parts))
        mixed = np.zeros(length)
        for data, spec in parts:
            offset = round(spec['offset'] * rate)
            n = min(len(data), length - offset)
            if n > 0:
                mixed[offset:offset + n] += data[:n]
        mixed -= np.mean(mixed)
        mixed *= peak / max(float(np.max(np.abs(mixed))), 0.00001)
        fi, fo = min(round(fade_in * rate), length // 2), min(round(fade_out * rate), length // 2)
        if fi:
            mixed[:fi] *= np.linspace(0, 1, fi)
        if fo:
            mixed[-fo:] *= np.linspace(1, 0, fo)
        path = out / f'{name}-0912.wav'
        write_wav(path, mixed)
        rendered[name] = mixed
        products.append({'id': name, 'path': path.relative_to(root).as_posix(), 'sha256': sha(path), 'duration_seconds': round(length / rate, 6), 'peak_dbfs': round(20 * math.log10(max(float(np.max(np.abs(mixed))), 1e-9)), 2), 'rms_dbfs': round(20 * math.log10(max(float(np.sqrt(np.mean(mixed * mixed))), 1e-9)), 2), 'clipped_samples': int(np.sum(np.abs(mixed) >= 1)), 'sample_rate': rate, 'channels': 1, 'recipe': [spec for _, spec in parts], 'fade_in_seconds': fade_in, 'fade_out_seconds': fade_out, 'max_seconds': max_seconds, 'target_peak': peak, 'qa': 'Decoded and signal-checked; listening acceptance pending'})
        return f'assets/audio/sfx/{path.name}'

    def cue(cue_id, names, group='sfx', **options):
        catalog[cue_id] = {'files': [f'assets/audio/sfx/{name}-0912.wav' for name in names], 'group': group, 'source': 'docs/assets/音频来源0912.md', 'note': 'Recording-derived Foley candidate; not an original One Piece game SFX; listening acceptance pending.', **options}

    hit = lambda n, **kw: part(f'hits/hit{n:02}.mp3.flac', trim=True, **kw)
    swish = lambda n, **kw: part(f'swish/swosh-{n:02}.flac', trim=True, **kw)
    fire = lambda start=0.0, duration=0.5, **kw: part('fire-1.wav', start, duration, **kw)
    wind = lambda start=2.0, duration=0.6, **kw: part('wind_background_noise_2.wav', start, duration, **kw)
    cannon = lambda start=0.0, duration=0.6, **kw: part('cannon_fire.ogg', start, duration, **kw)

    # Dry transient variants are intentionally short for real multi-hit events.
    for i, source in enumerate([1, 4, 12], 1):
        make(f'hit-light-{i}', [hit(source, speed=1.13, highpass=100)], 0.28, fade_out=0.065)
    for i, source in enumerate([9, 19], 1):
        make(f'hit-heavy-{i}', [hit(source, speed=0.84, lowpass=5500), hit(7, speed=0.65, lowpass=950, gain=0.44, offset=0.015)], 0.44, fade_out=0.11)
    make('guard', [hit(3, speed=1.6, highpass=700, gain=0.7), hit(10, speed=1.2, lowpass=1600, gain=0.25)], 0.2)
    make('body-land', [hit(19, speed=0.7, lowpass=1700), hit(2, speed=0.9, lowpass=700, gain=0.3, offset=0.025)], 0.48, fade_out=0.14)
    make('counter', [hit(9, speed=1.15), hit(19, speed=0.72, lowpass=2000, gain=0.35, offset=0.015)], 0.38, fade_out=0.09)
    for i, source in enumerate([2, 4, 7], 1):
        make(f'whoosh-{i}', [swish(source, speed=1.08)], 0.24, peak=0.65, fade_out=0.045)
    make('throw', [swish(3, speed=0.82, gain=0.3), hit(19, speed=0.78, lowpass=2200, offset=0.055)], 0.5, fade_out=0.13)
    make('ko', [hit(19, speed=0.64, lowpass=2400), cannon(duration=0.5, speed=0.8, lowpass=1600, gain=0.28)], 0.65, fade_out=0.2)
    cue('hit_light', ['hit-light-1', 'hit-light-2', 'hit-light-3'], gain=0.58)
    cue('hit_heavy', ['hit-heavy-1', 'hit-heavy-2'], gain=0.7)
    cue('block', ['guard'], gain=0.52)
    cue('body_land', ['body-land'], gain=0.56)
    cue('throw', ['throw'], gain=0.64)
    cue('counter', ['counter'], gain=0.75)
    cue('whoosh', ['whoosh-1', 'whoosh-2', 'whoosh-3'], gain=0.32)
    cue('ko', ['ko'], gain=0.8, priority=90)

    # Three-part designed Foley. Elasticity is bamboo resampling/reversal, not
    # a claim that bamboo recordings are rubber or that these are official SFX.
    family_recipes = {
        ('luffy', 'stretch'): ([swish(3, speed=0.76, reverse=True, lowpass=3200)], [swish(2, speed=1.25), swish(7, speed=1.6, gain=0.24)], [swish(4, speed=1.32, reverse=True, lowpass=2300)]),
        ('luffy', 'gatling'): ([swish(5, speed=0.87, reverse=True)], [swish(9, speed=1.3), swish(4, speed=1.5, gain=0.25, offset=0.04)], [swish(2, speed=1.4, reverse=True)]),
        ('luffy', 'gigant'): ([wind(duration=0.48, highpass=550, gain=0.55), swish(3, speed=0.65, reverse=True, lowpass=1400)], [swish(5, speed=0.6, lowpass=2400), swish(3, speed=0.78, gain=0.3)], [wind(3, 0.38, highpass=950), swish(4, speed=0.85, reverse=True, gain=0.25)]),
        ('luffy', 'red_hawk'): ([swish(3, speed=0.8, reverse=True), fire(0.3, 0.32, gain=0.32)], [swish(6, speed=0.9), fire(0.4, 0.52, speed=1.3, gain=0.5)], [fire(1.1, 0.3, lowpass=5200)]),
        ('luffy', 'gear2'): ([wind(3, 0.55, highpass=650)], [wind(4, 0.5, speed=1.3, highpass=1700), swish(3, speed=1.7, gain=0.16)], [wind(5, 0.4, highpass=2200)]),
        ('luffy', 'balloon'): ([wind(2, 0.45, highpass=500), swish(3, speed=0.7, reverse=True, gain=0.25)], [swish(5, speed=0.68, lowpass=2300), wind(5, 0.3, highpass=400, gain=0.28)], [wind(6, 0.4, speed=1.15, highpass=1700)]),
        ('akainu', 'daifunka'): ([fire(0.2, 0.5, speed=0.68, lowpass=1800), wind(6, 0.45, lowpass=750, gain=0.15)], [cannon(duration=0.5, speed=0.82, lowpass=4300), fire(0.7, 0.6, gain=0.5), swish(5, speed=0.7, gain=0.25)], [fire(1.1, 0.55, speed=0.85, lowpass=4500)]),
        ('akainu', 'ground_split'): ([fire(0.4, 0.38, speed=0.6, lowpass=1000)], [hit(19, speed=0.7, lowpass=2800), fire(0.4, 0.5, speed=0.62, gain=0.45), cannon(0.05, 0.4, lowpass=1100, gain=0.4)], [fire(0.4, 0.35, speed=0.85, highpass=700)]),
        ('akainu', 'meigou'): ([fire(0.2, 0.28, speed=1.1, highpass=220)], [swish(9, speed=1.15), fire(0.7, 0.27, speed=1.4, gain=0.5), cannon(0, 0.2, speed=1.2, highpass=850, gain=0.26)], [fire(1.2, 0.25, speed=1.25)]),
        ('akainu', 'meteor'): ([fire(0.2, 0.4, speed=0.8, lowpass=1900)], [swish(3, speed=1.15), wind(7, 0.27, speed=1.2, highpass=700, gain=0.22), fire(0.6, 0.27, gain=0.24)], [cannon(duration=0.55, speed=0.8, lowpass=4600), fire(0.7, 0.5, gain=0.4), hit(19, speed=0.65, lowpass=1800, gain=0.38)]),
        ('akainu', 'inugami'): ([fire(0.3, 0.45, speed=0.9), swish(5, speed=0.8, reverse=True, gain=0.38)], [swish(3, speed=0.8), fire(0.8, 0.46, speed=0.85, gain=0.55)], [fire(1.2, 0.35, speed=1.2, highpass=500)]),
        ('akainu', 'magma_body'): ([fire(0.2, 0.4, speed=0.7, lowpass=1900)], [fire(0.5, 0.6, speed=0.85, lowpass=3700)], [fire(1.3, 0.3, speed=0.6, lowpass=1300), hit(4, speed=0.6, lowpass=600, gain=0.16)]),
    }
    for (character, family), recipes in family_recipes.items():
        for phase, recipe in zip(['start', 'release', 'end'], recipes):
            name = f'{character}-{family}-{phase}'
            duration = 0.19 if family == 'gatling' and phase == 'release' else 0.3 if family == 'meteor' and phase == 'release' else 0.62 if phase == 'release' else 0.42
            make(name, recipe, duration, peak=0.68 if phase != 'release' else 0.78, fade_in=0.006 if phase == 'release' else 0.012, fade_out=0.06)
            cue(f'sfx.{character}.{family}.{phase}', [name], characterId=character, gain=0.47 if phase == 'release' else 0.29, priority=55 if phase == 'release' else 30, cooldownMs=50 if family == 'meteor' and phase == 'release' else 60, maxInstances=3 if phase == 'release' else 2)
    cue('magma', ['akainu-daifunka-start'], gain=0.35)
    make('magma-hit', [hit(19, speed=0.77, lowpass=3600), fire(0.6, 0.3, speed=0.9, gain=0.4), cannon(0, 0.3, speed=0.9, lowpass=1400, gain=0.2)], 0.42, fade_out=0.1)
    cue('magma_hit', ['magma-hit'], gain=0.67)
    cue('meteor_fall', ['akainu-meteor-release'], gain=0.4, cooldownMs=50, maxInstances=3)
    cue('meteor_land', ['akainu-meteor-end'], gain=0.65, cooldownMs=40, maxInstances=3)
    # Keep original synthetic UI sounds as the intentional menu fallback.

    ambient_recipe = [wind(1, 20, lowpass=2600, gain=0.6)]
    for offset in [2.5, 5.2, 7.9, 10.6, 13.3, 16.0, 18.0]:
        ambient_recipe.append(fire(0, 2.4, lowpass=3900, gain=0.018, offset=offset))
    ambient_recipe += [cannon(0, 2, speed=0.8, lowpass=650, gain=0.12, offset=6.4), cannon(0, 2, speed=0.88, lowpass=700, gain=0.09, offset=15.2)]
    make('marineford-ambient', ambient_recipe, 20, peak=0.5, fade_in=0.45, fade_out=0.45, group='ambient')
    cue('marineford_ambient', ['marineford-ambient'], group='ambient', gain=0.24, loop=True, priority=5, maxInstances=1)

    # Short nonverbal voice candidates selected only by silence segmentation.
    # Context/role/words require human listening before formal voice.* mapping.
    voice_candidates = []
    for character, filename in [('luffy', 'luffy_pw4_QwK-FAA-VRU.webm'), ('akainu', 'akainu_pw4_LelknEdihUw.webm')]:
        data = load(filename)
        hop = 441
        frames = np.array([np.sqrt(np.mean(data[i:i + hop] ** 2)) for i in range(0, len(data), hop)])
        active = frames > max(0.004, np.max(frames) * 0.045)
        spans = []
        start = None
        last = 0
        for i, value in enumerate(active):
            if value:
                if start is None:
                    start = i
                last = i
            elif start is not None and i - last > 14:
                spans.append((max(0, start * .01 - .025), min(len(data) / rate, (last + 1) * .01 + .065)))
                start = None
        if start is not None:
            spans.append((max(0, start * .01 - .025), min(len(data) / rate, (last + 1) * .01 + .065)))
        folder = audio / 'voice' / character
        folder.mkdir(parents=True, exist_ok=True)
        # First short vocalizations plus later short phrases cover review options;
        # numerical selection does not certify attack/hurt/win semantics.
        selected = [span for span in spans if .13 < span[1] - span[0] < 1.8][:12]
        for i, (start, end) in enumerate(selected, 1):
            clip = data[round(start * rate):round(end * rate)].copy()
            clip *= .78 / max(np.max(np.abs(clip)), .00001)
            fade = min(221, len(clip) // 4)
            clip[:fade] *= np.linspace(0, 1, fade)
            clip[-fade:] *= np.linspace(1, 0, fade)
            path = folder / f'candidate-{i:02}-0912.wav'
            write_wav(path, clip)
            voice_candidates.append({'id': f'{character}-candidate-{i:02}', 'character': character, 'path': path.relative_to(root).as_posix(), 'source_file': filename, 'source_url': sources_used[filename]['url'], 'source_start_seconds': round(start, 3), 'source_end_seconds': round(end, 3), 'sha256': sha(path), 'transcript': None, 'event_mapping': None, 'status': 'candidate-not-mapped', 'character_evidence': 'Source video title; independent listening pending', 'background_music': 'Not verified by listening', 'note': 'Silence-selected clip; do not infer attack/hurt/win from ordinal position'})
        # Full interval inventory lets the reviewer find victory/skills later.
        (sources / f'{character}-speech-intervals-0912.json').write_text(json.dumps({'source': filename, 'method': '10ms RMS gate; silence gap 150ms; role unknown', 'intervals': [{'start': round(a, 3), 'end': round(b, 3)} for a, b in spans]}, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    # Explicit review cuts combine silence boundaries with the coarse ASR index.
    # The suggested event is a review question, never a formal cue assignment.
    review_cuts = {
        'luffy': [
            ('attack', 3.115, 3.665, 'この', 'Short exertion/attack candidate; ASR uncertain'),
            ('attack-2', 3.915, 4.675, 'まだまだ', 'Attack phrase candidate; ASR only'),
            ('hurt', 40.375, 40.705, None, 'Short nonverbal sound; role unverified'),
            ('ko', 44.405, 45.465, None, 'Longer nonverbal sound; role unverified'),
            ('win', 86.755, 88.245, 'ぶっ飛ばしてやった', 'Possible victory phrase; ASR only'),
        ],
        'akainu': [
            ('attack', 3.175, 3.505, None, 'Short nonverbal sound; role unverified'),
            ('hurt', 70.685, 71.065, None, 'Short nonverbal sound; role unverified'),
            ('ko', 78.175, 79.425, None, 'Longer nonverbal sound; role unverified'),
            ('win', 106.875, 107.975, 'ハイボクシャが', 'Possible victory taunt; ASR only'),
            ('daifunka', 41.875, 43.415, '大分か', 'Possible 大噴火; ASR misspells it; not a confirmed move call'),
            ('meteor', 47.895, 49.355, '流星火山', 'Possible named move; ASR only'),
            ('meigou', 49.985, 51.255, '名号', 'Possible 冥狗; ASR misspells it; not a confirmed move call'),
        ],
    }
    for character, cuts in review_cuts.items():
        filename = 'luffy_pw4_QwK-FAA-VRU.webm' if character == 'luffy' else 'akainu_pw4_LelknEdihUw.webm'
        data = load(filename)
        review_audio = []
        review_timeline = []
        review_elapsed = 0.0
        for event, start, end, transcript, note in cuts:
            clip = data[round(start * rate):round(end * rate)].copy()
            clip *= .78 / max(np.max(np.abs(clip)), .00001)
            fade = min(221, len(clip) // 4)
            clip[:fade] *= np.linspace(0, 1, fade)
            clip[-fade:] *= np.linspace(1, 0, fade)
            path = audio / 'voice' / character / f'candidate-review-{event}-0912.wav'
            write_wav(path, clip)
            review_timeline.append({'start_seconds': round(review_elapsed, 3), 'candidate_event_question': event, 'source_start': start, 'source_end': end})
            review_audio.extend([clip * .7, np.zeros(round(rate * .5))])
            review_elapsed += len(clip) / rate + .5
            voice_candidates.append({'id': f'{character}-review-{event}', 'character': character, 'path': path.relative_to(root).as_posix(), 'source_file': filename, 'source_url': sources_used[filename]['url'], 'source_start_seconds': start, 'source_end_seconds': end, 'sha256': sha(path), 'transcript': None, 'transcript_asr_only': transcript, 'suggested_event_for_review_only': event, 'event_mapping': None, 'status': 'candidate-not-mapped', 'character_evidence': 'Source video title; independent listening pending', 'background_music': 'Not verified by listening', 'note': note})
        write_wav(audio / 'voice' / character / 'audition-review-0912.wav', np.concatenate(review_audio))
        (sources / f'{character}-audition-review-timeline-0912.json').write_text(json.dumps(review_timeline, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    ledger = {'version': 1, 'prepared_date': '2026-09-12', 'script': 'scripts/prepare_audio_assets.py', 'script_sha256': sha(Path(__file__)), 'sample_rate': rate, 'sources': sources_used, 'products': products, 'voice_candidates': voice_candidates, 'listening_status': 'Pending user/qualified listener review; no audio-understanding tool available in this execution', 'manifest_voice_policy': 'Unheard/ASR-only voice candidates are excluded from cues'}
    (sources / 'audio-preparation-ledger-0912.json').write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    catalog = apply_voices(root, catalog)
    daily = root / 'scripts/daily_audio_manifest.json'
    if daily.exists():
        catalog.update(json.loads(daily.read_text(encoding='utf-8'))['cues'])
    (root / 'src/audio/sampleManifest.json').write_text(json.dumps({'version': 1, 'cues': catalog}, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    audition_order = ['hit-light-1', 'hit-heavy-1', 'guard', 'whoosh-1', 'luffy-stretch-start', 'luffy-stretch-release', 'luffy-stretch-end', 'akainu-daifunka-start', 'akainu-daifunka-release', 'akainu-daifunka-end', 'akainu-meteor-release', 'akainu-meteor-end']
    audition = []
    timeline = []
    elapsed = 0.0
    for name in audition_order:
        clip = rendered[name]
        timeline.append({'start_seconds': round(elapsed, 3), 'id': name})
        audition += [clip * 0.65, np.zeros(round(rate * .55))]
        elapsed += len(clip) / rate + .55
    audition += [rendered['marineford-ambient'][:5 * rate] * .45]
    timeline.append({'start_seconds': round(elapsed, 3), 'id': 'marineford-ambient-first-5s'})
    path = out / 'audition-first-batch-0912.wav'
    write_wav(path, np.concatenate(audition))
    (sources / 'audition-timeline-0912.json').write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    for character in ['luffy', 'akainu']:
        clips = []
        for candidate in voice_candidates:
            if candidate['character'] == character:
                clip, _ = sf.read(root / candidate['path'])
                clips += [clip * .7, np.zeros(round(rate * .45))]
        write_wav(audio / 'voice' / character / 'audition-candidates-0912.wav', np.concatenate(clips))
    print(json.dumps({'cues': len(catalog), 'recorded_products': len(products), 'voice_candidates': len(voice_candidates), 'formal_voice_cues': sum(key.startswith('voice.') for key in catalog), 'audition': str(path), 'ledger': str(sources / 'audio-preparation-ledger-0912.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
