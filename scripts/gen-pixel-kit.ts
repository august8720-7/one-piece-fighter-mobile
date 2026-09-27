/**
 * 未采用的像素动作试验：仅输出到系统临时目录，不属于正式角色素材。
 * 跑：npx vite-node scripts/gen-pixel-kit.ts。不得将产物接入 gen:atlas。
 */
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC_H = 40;
const SRC_W = 72;
const SCALE = 4;
const OUT_H = SRC_H * SCALE;

type Rgba = { r: number; g: number; b: number; a: number };

class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }
  p(x: number, y: number, c: Rgba): void {
    const xx = Math.floor(x);
    const yy = Math.floor(y);
    if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return;
    const i = (yy * this.w + xx) * 4;
    this.data[i] = c.r;
    this.data[i + 1] = c.g;
    this.data[i + 2] = c.b;
    this.data[i + 3] = c.a;
  }
  rect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.p(xx, yy, c);
  }
}

const SKIN: Rgba = { r: 255, g: 214, b: 170, a: 255 };
const HAT: Rgba = { r: 232, g: 196, b: 74, a: 255 };
const HATBAND: Rgba = { r: 40, g: 28, b: 16, a: 255 };
const HAIR: Rgba = { r: 28, g: 20, b: 16, a: 255 };
const VEST: Rgba = { r: 196, g: 48, b: 48, a: 255 };
const VESTD: Rgba = { r: 140, g: 28, b: 28, a: 255 };
const SHORTS: Rgba = { r: 48, g: 86, b: 176, a: 255 };
const OUT: Rgba = { r: 20, g: 16, b: 16, a: 255 };
const WHITE: Rgba = { r: 250, g: 248, b: 240, a: 255 };

function encodePng(c: Canvas): Buffer {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    raw.set(c.data.subarray(y * c.w * 4, (y + 1) * c.w * 4), y * (c.w * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function scale4(src: Canvas): Canvas {
  const out = new Canvas(src.w * SCALE, src.h * SCALE);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.data[i + 3] === 0) continue;
      const c = { r: src.data[i]!, g: src.data[i + 1]!, b: src.data[i + 2]!, a: src.data[i + 3]! };
      out.rect(x * SCALE, y * SCALE, SCALE, SCALE, c);
    }
  }
  return out;
}

function fig(
  pose:
    | 'idle'
    | 'walk'
    | 'crouch'
    | 'aerial'
    | 'punch'
    | 'stretch'
    | 'block'
    | 'hit'
    | 'lying',
  frame = 0,
): Canvas {
  const c = new Canvas(SRC_W, SRC_H);
  const g = SRC_H;
  const bob = pose === 'idle' ? frame % 2 : 0;
  const cx = pose === 'stretch' ? 18 : 28;
  let bodyTop = g - 26 - bob;
  let bodyH = 14;
  if (pose === 'crouch') {
    bodyTop = g - 20;
    bodyH = 10;
  }
  if (pose === 'aerial') bodyTop = g - 28;

  if (pose === 'lying') {
    c.rect(10, g - 8, 28, 6, SHORTS);
    c.rect(36, g - 8, 12, 6, VEST);
    c.rect(46, g - 10, 8, 8, SKIN);
    c.rect(48, g - 12, 8, 4, HAT);
    return c;
  }

  const lean = pose === 'hit' ? -3 : pose === 'punch' || pose === 'stretch' ? 2 : pose === 'walk' ? (frame % 2 === 0 ? 1 : 0) : 0;
  const x = cx + lean;

  // legs
  if (pose === 'walk') {
    const phase = frame % 6;
    const fwd = [4, 2, 0, -3, -1, 2][phase]!;
    c.rect(x - 3 - fwd, g - 10, 4, 10, SHORTS);
    c.rect(x + 2 + fwd, g - 10, 4, 10, SHORTS);
    c.rect(x - 3 - fwd, g - 2, 5, 2, OUT);
    c.rect(x + 2 + fwd, g - 2, 5, 2, OUT);
  } else if (pose === 'crouch') {
    c.rect(x - 5, g - 8, 5, 8, SHORTS);
    c.rect(x + 2, g - 8, 5, 8, SHORTS);
  } else if (pose === 'aerial') {
    c.rect(x - 6, g - 12, 4, 7, SHORTS);
    c.rect(x + 4, g - 10, 4, 6, SHORTS);
  } else {
    c.rect(x - 3, g - 10, 4, 10, SHORTS);
    c.rect(x + 2, g - 10, 4, 10, SHORTS);
    c.rect(x - 3, g - 2, 5, 2, OUT);
    c.rect(x + 2, g - 2, 5, 2, OUT);
  }

  c.rect(x - 5, bodyTop, 13, bodyH, VEST);
  c.rect(x - 5, bodyTop + bodyH - 2, 13, 2, VESTD);
  if (pose !== 'crouch') c.rect(x - 1, bodyTop + 4, 5, 3, WHITE);

  const hx = x - 3;
  const hy = bodyTop - 8;
  c.rect(hx, hy, 9, 8, SKIN);
  c.rect(hx + 1, hy - 4, 9, 5, HAT);
  c.rect(hx + 1, hy, 9, 2, HATBAND);
  c.rect(hx - 1, hy + 1, 2, 4, HAIR);
  c.p(hx + 6, hy + 3, OUT);

  const armY = pose === 'block' ? bodyTop + 2 : bodyTop + 4;
  if (pose === 'block') {
    c.rect(x + 7, armY, 8, 3, SKIN);
    c.rect(x + 7, armY + 3, 3, 5, SKIN);
  } else if (pose === 'punch') {
    c.rect(x + 8, armY, 10, 3, SKIN);
    c.rect(x + 16, armY - 1, 4, 5, SKIN);
  } else if (pose === 'stretch') {
    c.rect(x + 8, armY, 40, 3, SKIN);
    c.rect(x + 46, armY - 2, 6, 7, SKIN);
  } else if (pose === 'hit') {
    c.rect(x - 8, armY + 2, 4, 3, SKIN);
  } else if (pose === 'walk') {
    const swing = [3, 1, -2, -3, -1, 2][frame % 6]!;
    c.rect(x + 7, armY + Math.max(0, -swing), 3, 6, SKIN);
    c.rect(x - 7, armY + Math.max(0, swing), 3, 6, SKIN);
  } else {
    c.rect(x + 7, armY, 3, 7, SKIN);
    c.rect(x - 7, armY + 1, 3, 6, SKIN);
  }
  return c;
}

const POSES: Record<string, () => Canvas> = {
  idle: () => fig('idle', 0),
  idle_0: () => fig('idle', 0),
  idle_1: () => fig('idle', 1),
  idle_2: () => fig('idle', 2),
  idle_3: () => fig('idle', 3),
  walk_0: () => fig('walk', 0),
  walk_1: () => fig('walk', 1),
  walk_2: () => fig('walk', 2),
  walk_3: () => fig('walk', 3),
  walk_4: () => fig('walk', 4),
  walk_5: () => fig('walk', 5),
  crouch: () => fig('crouch'),
  aerial: () => fig('aerial'),
  jump_start: () => fig('crouch'),
  punch_start: () => fig('idle', 0),
  punch_short: () => fig('punch'),
  punch_stretch: () => fig('stretch'),
  gatling_start: () => fig('punch'),
  gatling: () => fig('stretch'),
  stamp_smash: () => fig('punch'),
  jump_kick: () => fig('aerial'),
  redhawk_charge: () => fig('crouch'),
  redhawk_lunge: () => fig('stretch'),
  block: () => fig('block'),
  hit: () => fig('hit'),
  lying: () => fig('lying'),
  hero: () => fig('idle', 1),
};

const COAT: Rgba = { r: 176, g: 28, b: 32, a: 255 };
const COATD: Rgba = { r: 112, g: 16, b: 20, a: 255 };
const SHIRT: Rgba = { r: 248, g: 244, b: 236, a: 255 };
const PANTS: Rgba = { r: 28, g: 28, b: 32, a: 255 };
const MAGMA: Rgba = { r: 255, g: 92, b: 24, a: 255 };
const MAGMAH: Rgba = { r: 255, g: 196, b: 64, a: 255 };
const WHATE: Rgba = { r: 236, g: 232, b: 224, a: 255 };

function figAkainu(
  pose: 'idle' | 'walk' | 'crouch' | 'aerial' | 'punch' | 'stretch' | 'block' | 'hit' | 'lying' | 'cast',
  frame = 0,
): Canvas {
  const c = new Canvas(SRC_W, SRC_H);
  const g = SRC_H;
  const bob = pose === 'idle' ? frame % 2 : 0;
  const cx = pose === 'stretch' ? 16 : 26;
  let bodyTop = g - 28 - bob;
  let bodyH = 16;
  if (pose === 'crouch' || pose === 'cast') {
    bodyTop = g - 22;
    bodyH = 12;
  }
  if (pose === 'aerial') bodyTop = g - 30;
  if (pose === 'lying') {
    c.rect(8, g - 9, 30, 7, PANTS);
    c.rect(36, g - 10, 16, 8, COAT);
    c.rect(50, g - 12, 8, 8, SKIN);
    c.rect(50, g - 16, 10, 5, WHATE);
    return c;
  }
  const lean = pose === 'hit' ? -3 : pose === 'punch' || pose === 'stretch' ? 2 : pose === 'walk' ? (frame % 2 === 0 ? 1 : 0) : 0;
  const x = cx + lean;
  if (pose === 'walk') {
    const phase = frame % 6;
    const fwd = [4, 2, 0, -3, -1, 2][phase]!;
    c.rect(x - 4 - fwd, g - 12, 5, 12, PANTS);
    c.rect(x + 2 + fwd, g - 12, 5, 12, PANTS);
    c.rect(x - 4 - fwd, g - 2, 6, 2, OUT);
    c.rect(x + 2 + fwd, g - 2, 6, 2, OUT);
  } else if (pose === 'crouch' || pose === 'cast') {
    c.rect(x - 6, g - 10, 6, 10, PANTS);
    c.rect(x + 2, g - 10, 6, 10, PANTS);
  } else if (pose === 'aerial') {
    c.rect(x - 7, g - 14, 5, 8, PANTS);
    c.rect(x + 4, g - 12, 5, 7, PANTS);
  } else {
    c.rect(x - 4, g - 12, 5, 12, PANTS);
    c.rect(x + 2, g - 12, 5, 12, PANTS);
    c.rect(x - 4, g - 2, 6, 2, OUT);
    c.rect(x + 2, g - 2, 6, 2, OUT);
  }
  c.rect(x - 7, bodyTop, 16, bodyH, COAT);
  c.rect(x - 7, bodyTop + bodyH - 2, 16, 2, COATD);
  c.rect(x - 2, bodyTop + 3, 7, 5, SHIRT);
  const hx = x - 3;
  const hy = bodyTop - 8;
  c.rect(hx, hy, 9, 8, SKIN);
  c.rect(hx, hy - 4, 10, 5, WHATE);
  c.rect(hx - 1, hy + 1, 2, 4, HAIR);
  c.p(hx + 6, hy + 3, OUT);
  const armY = pose === 'block' ? bodyTop + 2 : bodyTop + 5;
  if (pose === 'block') {
    c.rect(x + 8, armY, 8, 3, SKIN);
    c.rect(x + 8, armY + 3, 4, 6, MAGMA);
  } else if (pose === 'punch') {
    c.rect(x + 8, armY, 10, 3, SKIN);
    c.rect(x + 16, armY - 2, 6, 7, MAGMA);
    c.rect(x + 17, armY - 1, 3, 3, MAGMAH);
  } else if (pose === 'stretch') {
    c.rect(x + 8, armY, 38, 4, MAGMA);
    c.rect(x + 44, armY - 3, 8, 9, MAGMA);
    c.rect(x + 46, armY - 1, 4, 4, MAGMAH);
  } else if (pose === 'hit') {
    c.rect(x - 9, armY + 2, 5, 3, SKIN);
  } else if (pose === 'cast') {
    c.rect(x + 8, armY - 6, 4, 10, SKIN);
    c.rect(x + 8, armY - 8, 5, 4, MAGMA);
  } else if (pose === 'walk') {
    const swing = [3, 1, -2, -3, -1, 2][frame % 6]!;
    c.rect(x + 8, armY + Math.max(0, -swing), 3, 7, SKIN);
    c.rect(x - 8, armY + Math.max(0, swing), 3, 7, SKIN);
  } else {
    c.rect(x + 8, armY, 3, 8, SKIN);
    c.rect(x - 8, armY + 1, 3, 7, SKIN);
  }
  return c;
}

const AKAINU_POSES: Record<string, () => Canvas> = {
  idle: () => figAkainu('idle', 0),
  idle_0: () => figAkainu('idle', 0),
  idle_1: () => figAkainu('idle', 1),
  idle_2: () => figAkainu('idle', 2),
  idle_3: () => figAkainu('idle', 3),
  walk_0: () => figAkainu('walk', 0),
  walk_1: () => figAkainu('walk', 1),
  walk_2: () => figAkainu('walk', 2),
  walk_3: () => figAkainu('walk', 3),
  walk_4: () => figAkainu('walk', 4),
  walk_5: () => figAkainu('walk', 5),
  crouch: () => figAkainu('crouch'),
  aerial: () => figAkainu('aerial'),
  jump_start: () => figAkainu('crouch'),
  punch_start: () => figAkainu('idle', 0),
  punch_short: () => figAkainu('punch'),
  punch_stretch: () => figAkainu('stretch'),
  windup: () => figAkainu('crouch'),
  forward_attack: () => figAkainu('punch'),
  intimidation: () => figAkainu('block'),
  big_thrust: () => figAkainu('stretch'),
  uppercut: () => figAkainu('punch'),
  ground_burst: () => figAkainu('cast'),
  cast: () => figAkainu('cast'),
  summon: () => figAkainu('stretch'),
  block: () => figAkainu('block'),
  hit: () => figAkainu('hit'),
  lying: () => figAkainu('lying'),
  hero: () => figAkainu('block'),
};

function writeKit(id: string, poses: Record<string, () => Canvas>): void {
  const dir = join(tmpdir(), 'one-piece-fighter-pixel-study', id);
  mkdirSync(dir, { recursive: true });
  for (const [name, draw] of Object.entries(poses)) {
    writeFileSync(join(dir, `${name}.png`), encodePng(scale4(draw())));
  }
  console.log(`Unapproved study: ${id}, ${Object.keys(poses).length} poses, ${OUT_H}px → ${dir}`);
}

function main(): void {
  writeKit('luffy', POSES);
  writeKit('akainu', AKAINU_POSES);
}

main();
