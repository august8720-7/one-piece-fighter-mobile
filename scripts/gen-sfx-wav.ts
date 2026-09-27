/**
 * 生成可提交的短 WAV（程序合成，无版权采样）。
 * 运行：npx vite-node scripts/gen-sfx-wav.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 22050;
const OUT = path.resolve(process.cwd(), 'public/assets/audio');

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function writeWav(file: string, samples: number[]): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(clamp(samples[i]!, -1, 1) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, file), buf);
}

function alloc(sec: number): number[] {
  return new Array(Math.max(1, Math.floor(RATE * sec))).fill(0);
}

function addTone(out: number[], start: number, dur: number, f0: number, f1: number, gain: number): void {
  const n = Math.floor(RATE * dur);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const p = i / Math.max(1, n - 1);
    const f = f0 + (f1 - f0) * p;
    const env = (1 - p) * (1 - p);
    const idx = start + i;
    if (idx >= out.length) break;
    out[idx]! += Math.sin(2 * Math.PI * f * t) * gain * env;
  }
}

function addNoise(out: number[], start: number, dur: number, gain: number): void {
  const n = Math.floor(RATE * dur);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = i / Math.max(1, n - 1);
    acc = acc * 0.6 + (Math.random() * 2 - 1) * 0.4;
    const idx = start + i;
    if (idx >= out.length) break;
    out[idx]! += acc * gain * (1 - p);
  }
}

function render(sec: number, fn: (out: number[]) => void): number[] {
  const out = alloc(sec);
  fn(out);
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0 ? 0.86 / peak : 1;
  return out.map((s) => s * scale);
}

const specs: Record<string, (out: number[]) => void> = {
  'hit_light.wav': (o) => {
    addNoise(o, 0, 0.08, 0.7);
    addTone(o, 0, 0.1, 180, 70, 0.55);
    addTone(o, 0, 0.04, 1400, 700, 0.22);
  },
  'hit_heavy.wav': (o) => {
    addNoise(o, 0, 0.16, 0.9);
    addTone(o, 0, 0.18, 90, 38, 0.7);
    addTone(o, 0, 0.07, 320, 90, 0.3);
  },
  'block.wav': (o) => {
    addNoise(o, 0, 0.06, 0.45);
    addTone(o, 0, 0.07, 1400, 900, 0.35);
  },
  'throw.wav': (o) => {
    addNoise(o, 0, 0.18, 0.55);
    addTone(o, 0, 0.22, 120, 40, 0.5);
  },
  'special.wav': (o) => {
    addTone(o, 0, 0.2, 240, 720, 0.4);
    addNoise(o, 0, 0.16, 0.3);
  },
  'ko.wav': (o) => {
    addNoise(o, 0, 0.4, 0.8);
    addTone(o, 0, 0.55, 200, 30, 0.6);
    addTone(o, Math.floor(RATE * 0.05), 0.5, 100, 25, 0.45);
  },
  'menu_move.wav': (o) => {
    addTone(o, 0, 0.05, 700, 700, 0.28);
  },
  'menu_confirm.wav': (o) => {
    addTone(o, 0, 0.08, 600, 1200, 0.32);
  },
  'round_start.wav': (o) => {
    addTone(o, 0, 0.12, 440, 440, 0.35);
    addTone(o, Math.floor(RATE * 0.14), 0.2, 660, 660, 0.35);
  },
  'counter.wav': (o) => {
    addNoise(o, 0, 0.12, 0.7);
    addTone(o, 0, 0.16, 880, 220, 0.45);
  },
  'whoosh.wav': (o) => {
    addNoise(o, 0, 0.14, 0.4);
    addTone(o, 0, 0.12, 420, 180, 0.22);
  },
  'magma.wav': (o) => {
    addNoise(o, 0, 0.26, 0.55);
    addTone(o, 0, 0.28, 70, 40, 0.4);
    addTone(o, Math.floor(RATE * 0.04), 0.18, 180, 90, 0.2);
  },
  'meteor_fall.wav': (o) => {
    addTone(o, 0, 0.2, 520, 160, 0.3);
    addNoise(o, 0, 0.18, 0.28);
  },
  'meteor_land.wav': (o) => {
    addNoise(o, 0, 0.2, 0.85);
    addTone(o, 0, 0.16, 70, 30, 0.55);
  },
};

fs.mkdirSync(OUT, { recursive: true });
for (const [file, fn] of Object.entries(specs)) {
  const sec = file === 'ko.wav' ? 0.7 : file === 'round_start.wav' ? 0.4 : file === 'magma.wav' ? 0.36 : 0.28;
  writeWav(file, render(sec, fn));
}
console.log(`wrote ${Object.keys(specs).length} wav files to ${OUT}`);
