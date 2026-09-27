/**
 * 生成占位精灵图集：public/assets/characters/<id>/placeholder.{png,json}
 * 运行：npx vite-node scripts/gen-placeholder-atlas.ts
 *
 * 目的：在没有正式素材时，让图集加载、帧名映射、动画帧推导、镜像与对齐整条链路跑起来。
 * 每帧是一个带条纹的色块人形，按状态 / 招式阶段变化姿势，肉眼能分辨"当前用的是精灵而不是矢量色块"。
 */
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { characterAnims, characters, moveFrameCounts } from '@characters/index';
import { DEFAULT_ANIMS, requiredFrames } from '@render/animations';
import type { FighterDef } from '@core/index';

const COLS = 12;
const PAD = 2;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
  }
  rect(x: number, y: number, w: number, h: number, c: Rgba): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w));
    const y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 4;
        this.data[i] = c.r;
        this.data[i + 1] = c.g;
        this.data[i + 2] = c.b;
        this.data[i + 3] = c.a;
      }
    }
  }
  circle(cx: number, cy: number, r: number, c: Rgba): void {
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++) {
      for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) {
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) this.rect(xx, yy, 1, 1, c);
      }
    }
  }
  blit(src: Canvas, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const si = (y * src.w + x) * 4;
        if (src.data[si + 3] === 0) continue;
        const di = ((dy + y) * this.w + (dx + x)) * 4;
        this.data.set(src.data.subarray(si, si + 4), di);
      }
    }
  }
}

function hex(color: number, a = 255): Rgba {
  return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255, a };
}
function darken(c: Rgba, f: number): Rgba {
  return { r: Math.floor(c.r * f), g: Math.floor(c.g * f), b: Math.floor(c.b * f), a: c.a };
}

/** 画一帧：脚底中心在 (w/2, h)，面朝右。 */
function drawFrame(def: FighterDef, anim: string, index: number, w: number, h: number): Canvas {
  const c = new Canvas(w, h);
  const body = hex(def.color);
  const dark = darken(body, 0.6);
  const skin = hex(0xffe8d6);
  const [, , bw, bh] = def.pushboxStand;
  const cx = w / 2;
  const ground = h;
  const isMove = !(anim in DEFAULT_ANIMS);

  // 姿势参数
  let bodyH = bh;
  let bodyW = bw;
  let lean = 0; // 正向前倾
  let armLen = 0;
  let armY = 0.3;
  let legSpread = 0;
  let lying = false;
  let ball = false;
  let bob = 0;

  switch (anim) {
    case 'idle':
      bob = index % 2;
      break;
    case 'walk_fwd':
    case 'walk_back':
      legSpread = (index % 2) * 8 - 4;
      break;
    case 'crouch':
    case 'block_crouch':
    case 'hit_crouch':
      bodyH = def.pushboxCrouch[3];
      bodyW = def.pushboxCrouch[2];
      break;
    case 'prejump':
    case 'landing':
      bodyH = bh * 0.85;
      break;
    case 'jump_neutral':
    case 'jump_fwd':
    case 'jump_back':
      bodyH = bh * 0.8;
      legSpread = 6;
      break;
    case 'dash':
      lean = 8;
      legSpread = (index % 2) * 10 - 5;
      break;
    case 'backdash':
      lean = -8;
      break;
    case 'roll_fwd':
    case 'roll_back':
      ball = true;
      break;
    case 'block_stand':
      armLen = 6;
      armY = 0.35;
      break;
    case 'hit_stand':
    case 'hit_air':
      lean = -10;
      break;
    case 'knockdown':
    case 'ko':
      lying = true;
      break;
    case 'getup':
      bodyH = bh * (0.5 + 0.4 * index);
      break;
    case 'throw':
      armLen = 20;
      armY = 0.25;
      break;
    case 'thrown':
      lean = -14;
      bodyH = bh * 0.9;
      break;
    case 'throw_tech':
      lean = -4;
      break;
    case 'win':
    case 'portrait':
      armLen = 14;
      armY = 0.1;
      break;
    default:
      break;
  }

  if (isMove) {
    const move = def.moves.find((m) => m.id === anim);
    // 招式：sprite 索引偶数 = 启动 / 收招（短臂），奇数 = active（长臂）
    const active = index % 2 === 1;
    armLen = active ? 34 : 12;
    armY = 0.25 + ((index >> 1) % 3) * 0.15;
    lean = active ? 4 : 0;
    if (anim.startsWith('cr_')) {
      bodyH = def.pushboxCrouch[3];
      bodyW = def.pushboxCrouch[2];
    }
    if (anim.startsWith('j_')) {
      bodyH = bh * 0.8;
      legSpread = 6;
    }
    if (move?.reflect) {
      // 橡胶气球：鼓成球
      ball = true;
      if (index === 1) bodyW = bw * 1.6;
    }
    if (move?.dodge || move?.install) {
      // 熔岩化 / 二档：双臂下垂蓄力，不出拳
      armLen = 0;
      lean = 0;
      legSpread = 4;
    }
    if (move?.throwData && move.type !== 'throw') {
      // 指令投：抓取姿势，手张开
      armLen = active ? 26 : 10;
      armY = 0.3;
    }
  }

  if (ball) {
    const r = bodyW * 0.55;
    c.circle(cx, ground - r, r, body);
    c.circle(cx, ground - r, r - 3, dark);
    c.circle(cx, ground - r, r - 6, body);
    return c;
  }
  if (lying) {
    const lw = bh * 0.9;
    c.rect(cx - lw / 2 + 10, ground - 14, lw, 14, body);
    c.rect(cx + lw / 2 - 2, ground - 14, 12, 14, skin);
    return c;
  }

  const top = ground - bodyH - bob;
  const x0 = cx - bodyW / 2 + lean * 0.5;
  // 腿
  c.rect(x0 + 2 - legSpread, ground - bodyH * 0.45, bodyW / 2 - 3, bodyH * 0.45, dark);
  c.rect(x0 + bodyW / 2 + 1 + legSpread, ground - bodyH * 0.45, bodyW / 2 - 3, bodyH * 0.45, dark);
  // 躯干（带横条纹，标记"精灵图"）
  c.rect(x0 + lean, top, bodyW, bodyH * 0.6, body);
  for (let y = top + 4; y < top + bodyH * 0.6; y += 8) c.rect(x0 + lean, y, bodyW, 3, dark);
  // 头
  const headW = bodyW * 0.6;
  c.rect(cx - headW / 2 + lean, top - 10, headW, 10, skin);
  c.rect(cx + headW * 0.15 + lean, top - 7, 2, 2, hex(0x000000));
  // 手臂
  if (armLen > 0) {
    c.rect(x0 + bodyW + lean, top + bodyH * armY, armLen, 7, body);
    c.rect(x0 + bodyW + lean + armLen - 6, top + bodyH * armY - 1, 6, 9, skin);
  }
  return c;
}

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function generate(charId: string): void {
  const def = characters[charId]!;
  const anims = { ...DEFAULT_ANIMS, ...characterAnims[charId] };
  const counts = moveFrameCounts(def);
  const fw = def.pushboxStand[2] + 60;
  const fh = def.pushboxStand[3] + 24;

  const entries: { name: string; canvas: Canvas }[] = [];
  for (const name of requiredFrames(charId, anims, counts)) {
    const [, anim, index] = name.split('/');
    entries.push({ name, canvas: drawFrame(def, anim!, Number(index), fw, fh) });
  }

  const rows = Math.ceil(entries.length / COLS);
  const atlas = new Canvas(COLS * (fw + PAD), rows * (fh + PAD));
  const frames: Record<string, unknown> = {};
  entries.forEach((e, i) => {
    const x = (i % COLS) * (fw + PAD);
    const y = Math.floor(i / COLS) * (fh + PAD);
    atlas.blit(e.canvas, x, y);
    frames[e.name] = {
      frame: { x, y, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
    };
  });

  const dir = join(process.cwd(), 'public', 'assets', 'characters', charId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'placeholder.png'), encodePng(atlas));
  writeFileSync(
    join(dir, 'placeholder.json'),
    JSON.stringify(
      {
        frames,
        meta: {
          app: 'one-piece-fighter/scripts/gen-placeholder-atlas.ts',
          version: '1.0',
          image: 'placeholder.png',
          format: 'RGBA8888',
          size: { w: atlas.w, h: atlas.h },
          scale: '1',
        },
      },
      null,
      0,
    ),
  );
  console.log(`${charId}: ${entries.length} frames, ${atlas.w}x${atlas.h} -> ${dir}`);
}

for (const id of Object.keys(characters)) generate(id);
