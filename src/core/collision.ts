import { SUBPIXEL } from './constants';
import type { Box, BoxPx, Facing } from './types';

/** 把数据文件中的像素判定框放到世界坐标（子像素），处理镜像。 */
export function toWorldBox(b: BoxPx, ox: number, oy: number, facing: Facing): Box {
  const [x, y, w, h] = b;
  const wx = facing === 1 ? x : -x - w;
  return {
    x: ox + wx * SUBPIXEL,
    y: oy + y * SUBPIXEL,
    w: w * SUBPIXEL,
    h: h * SUBPIXEL,
  };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 水平重叠量（>0 表示重叠）。 */
export function overlapX(a: Box, b: Box): number {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}
