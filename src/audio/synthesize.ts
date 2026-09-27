import type { SfxKind } from './audioTypes';

/** Last-resort effects only. Recorded voices/ambience are never synthesized. */
export function synthesize(context: AudioContext, kind: SfxKind): AudioBuffer {
  const settings: Record<SfxKind, [number, number, number, number]> = {
    hit_light: [0.12, 180, 70, 0.6], hit_heavy: [0.22, 90, 38, 0.8],
    block: [0.09, 1400, 900, 0.4], throw: [0.25, 120, 40, 0.7],
    special: [0.24, 240, 720, 0.3], ko: [0.7, 200, 30, 0.8],
    menu_move: [0.05, 700, 700, 0], menu_confirm: [0.09, 600, 1200, 0],
    round_start: [0.4, 440, 660, 0], counter: [0.18, 880, 220, 0.65],
    whoosh: [0.16, 420, 180, 0.5], magma: [0.32, 70, 40, 0.75],
    meteor_fall: [0.22, 520, 160, 0.5], meteor_land: [0.24, 70, 30, 0.9],
  };
  const [duration, from, to, noiseGain] = settings[kind];
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;
  let noise = 0;
  for (let i = 0; i < data.length; i++) {
    const progress = i / data.length;
    phase += 2 * Math.PI * (from + (to - from) * progress) / context.sampleRate;
    noise = noise * 0.55 + (Math.random() * 2 - 1) * 0.45;
    const envelope = (1 - progress) ** 2;
    data[i] = Math.max(-0.9, Math.min(0.9, (Math.sin(phase) * 0.38 + noise * noiseGain) * envelope));
  }
  return buffer;
}
