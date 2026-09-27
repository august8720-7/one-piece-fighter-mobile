/**
 * 导出每个角色图集需要的帧清单 → assets-src/frames.json，供切图脚本（Python）铺满所有帧。
 * 运行：npx vite-node scripts/export-frames.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { characterAnims, characters, moveFrameCounts } from '@characters/index';
import { DEFAULT_ANIMS } from '@render/animations';

interface MoveInfo {
  frames: number;
  type: string;
  /** 带攻击框的 sprite 索引（active 帧） */
  active: number[];
  button: number;
  stance: string;
}

const out: Record<string, { anims: Record<string, number>; moves: Record<string, MoveInfo> }> = {};
for (const [id, def] of Object.entries(characters)) {
  const anims: Record<string, number> = {};
  for (const [k, v] of Object.entries({ ...DEFAULT_ANIMS, ...characterAnims[id] })) {
    if (!def.moves.some((move) => move.id === k)) anims[k] = v.frames;
  }
  const counts = moveFrameCounts(def);
  const moves: Record<string, MoveInfo> = {};
  for (const m of def.moves) {
    const active = new Set<number>();
    let max = 0;
    for (const f of m.frames) {
      max = Math.max(max, f.sprite);
      if (f.hitboxes) active.add(f.sprite);
    }
    moves[m.id] = { frames: Math.max(max + 1, counts[m.id] ?? 0), type: m.type, active: [...active].sort((a, b) => a - b), button: m.input.button, stance: m.input.stance };
  }
  out[id] = { anims, moves };
}
const dir = join(process.cwd(), 'assets-src');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'frames.json'), JSON.stringify(out, null, 2));
console.log('frames.json written:', Object.keys(out).join(', '));
