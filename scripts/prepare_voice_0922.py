"""Build an auditable audition, never promote unreviewed ASR to runtime voices."""
import argparse
import hashlib
import json
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True)
    args = parser.parse_args()
    folder = ROOT / 'public/assets/audio/sources/voice-0922'
    folder.mkdir(parents=True, exist_ok=True)
    sources = {
        'luffy': ('public/assets/audio/sources/luffy_pw4_QwK-FAA-VRU.webm', 'QwK-FAA-VRU'),
        'akainu': ('public/assets/audio/sources/akainu_pw4_LelknEdihUw.webm', 'LelknEdihUw'),
    }
    # All Japanese wording below is a candidate to verify, never a runtime translation.
    candidates = [
        ('luffy', '口头禅', 106.04, 108.97, '海賊王になるのはこのオレだ！', '成为海贼王的是我！', 'existing ASR, not heard'),
        ('luffy', '选人短回应', 70.5, 72.05, 'よし、やるか！', '好，开打吧！', 'existing ASR; voice accepted 0914, words not certified'),
        ('luffy', '胜利', 86.755, 88.245, 'ぶっ飛ばしてやった。', '把你打飞了。', 'existing ASR; voice identity accepted, words not certified'),
        ('luffy', '机关枪', 189.0, 193.8, None, '机关枪（字幕索引，待听辨）', 'publisher English subtitles 189.272–193.568: ...Gatling!'),
        ('luffy', '火拳铳', 1536.8, 1540.8, None, '火拳铳（字幕索引，待听辨）', 'publisher English subtitles 1537.369–1540.413: ...Red Hawk!'),
        ('akainu', '口头禅', 35.62, 38.52, None, '彻底的正义（ASR主题线索，待听辨）', 'ASR 徹底的正義を思考する contains likely error; no certified wording'),
        ('akainu', '选人短回应', 24.15, 25.75, None, None, 'existing accepted waiting voice; exact words unknown'),
        ('akainu', '胜利', 106.875, 107.975, '敗北者が', '败北者（待核实）', 'existing ASR; voice identity accepted, words not certified'),
        ('akainu', '大喷火', 41.875, 43.415, None, '大喷火（疑似，待听辨）', 'existing ASR 大分か is not reliable transcription'),
    ]
    ledger, joined = [], bytearray()
    def add_number(number):
        with wave.open(str(folder / 'announcer' / f'number-{number:02d}.wav'), 'rb') as audio:
            if audio.getframerate() != 44100 or audio.getnchannels() != 1:
                raise ValueError('Audition identifier must be mono 44100Hz')
            joined.extend(audio.readframes(audio.getnframes()))
        joined.extend(bytes(int(0.2 * 88200)))
    for number, (character, purpose, start, end, original, translation, evidence) in enumerate(candidates, 1):
        source_name, video = sources[character]
        seek = start
        if number in (4, 5):
            source_name = f'public/assets/audio/sources/voice-0922/luffy-exact-{start:g}.webm'
            video, seek = 'u5KFh-Ox41I', 0
        source = ROOT / source_name
        if not source.exists():
            ledger.append({'number': number, 'character': character, 'purpose': purpose, 'status': 'MISSING_SOURCE'})
            continue
        output = folder / f'candidate-{number:02d}-{character}-cut-0922.wav'
        if not output.exists():
            subprocess.run([args.ffmpeg, '-nostdin', '-v', 'error', '-ss', str(seek), '-t', str(end-start), '-i', str(source),
                            '-af', 'highpass=f=80,loudnorm=I=-20:TP=-2:LRA=7,afade=t=in:d=0.008,areverse,afade=t=in:d=0.025,areverse',
                            '-ar', '44100', '-ac', '1', str(output)], check=True)
        with wave.open(str(output), 'rb') as audio:
            pcm = audio.readframes(audio.getnframes())
            duration = audio.getnframes() / audio.getframerate()
        add_number(number)
        offset = len(joined) / 88200
        joined += pcm + bytes(int(0.8 * 88200))
        ledger.append({'number': number, 'character': character, 'purpose': purpose, 'source': source_name,
                       'sourceUrl': f'https://www.youtube.com/watch?v={video}', 'sourceStart': start, 'sourceEnd': end,
                       'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'file': str(output.relative_to(ROOT)).replace('\\','/'),
                       'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'auditionStart': offset, 'duration': duration,
                       'candidateOriginal': original, 'candidateTranslation': translation, 'evidence': evidence,
                       'status': 'NEEDS_LISTENING_NOT_ADOPTED', 'transcriptVerified': False})
    # Preserve the original fourteen-item audition when new runtime lines are added.
    announcers = [record for record in json.loads((ROOT / 'scripts/announcer_manifest_0922.json').read_text(encoding='utf-8-sig'))
                  if record['id'] in ('round1', 'round2', 'round3', 'fight', 'ko')]
    for number, record in enumerate(announcers, 10):
        source = ROOT / 'public' / record['file']
        with wave.open(str(source), 'rb') as audio:
            pcm = audio.readframes(audio.getnframes())
            duration = audio.getnframes()/audio.getframerate()
        add_number(number)
        ledger.append({**record, 'number': number, 'purpose': '合成播报候选', 'auditionStart': len(joined)/88200, 'duration': duration})
        joined += pcm + bytes(int(0.8 * 88200))
    audition = folder / '集中试听编号0922.wav'
    if audition.exists():
        raise FileExistsError('Keep the old audition; choose a new output name before rebuilding.')
    with wave.open(str(audition), 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(44100); audio.writeframes(joined)
    report = {'status': 'CANDIDATES_ONLY', 'missing': ['akainu:犬噛红莲，未定位可信原声片段'],
              'auditionFile': str(audition.relative_to(ROOT)).replace('\\','/'), 'auditionSeconds': len(joined)/88200,
              'auditionSha256': hashlib.sha256(audition.read_bytes()).hexdigest(), 'clips': ledger}
    (ROOT / 'scripts/voice_candidates_0922.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'clips': len(ledger), 'duration': report['auditionSeconds'], 'file': str(audition)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
