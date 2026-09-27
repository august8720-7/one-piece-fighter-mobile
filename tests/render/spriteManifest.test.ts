import { describe, expect, it } from 'vitest';
import manifest from '../../scripts/sprite_manifest.json';
import { characters, characterAnims, moveFrameCounts } from '../../src/characters';
import { DEFAULT_ANIMS, requiredFrames } from '../../src/render/animations';

describe('连续精灵显式来源与映射', () => {
  for (const [id, config] of Object.entries(manifest.characters)) {
    it(`${id} 来源、裁切范围与脚底锚点都可核查`, () => {
      expect(config.source.path).toBe(`public/assets/characters/${id}/source-sheet.png`);
      expect(config.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(config.scale).toBe(3);
      const sourceSizes: Record<string, number[]> = { original: config.source.size };
      for (const [sourceId, source] of Object.entries('extraSources' in config ? config.extraSources as Record<string, { path: string; sha256: string; size: number[] }> : {})) {
        expect(source.path.startsWith(`public/assets/characters/${id}/`)).toBe(true);
        expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
        sourceSizes[sourceId] = source.size;
      }
      for (const clip of Object.values(config.clips) as { rects: number[][]; anchors: number[][]; sources?: string[]; rotateDegrees?: number | number[] }[]) {
        expect(clip.anchors.length).toBe(clip.rects.length);
        const rotations = Array.isArray(clip.rotateDegrees) ? clip.rotateDegrees : clip.rects.map(() => clip.rotateDegrees ?? 0);
        expect(rotations.length).toBe(clip.rects.length);
        for (const [index, rect] of clip.rects.entries()) {
          const [x0, y0, x1, y1] = rect as [number, number, number, number];
          const [ax, ay] = clip.anchors[index]! as [number, number];
          const size = sourceSizes[clip.sources?.[index] ?? 'original']!;
          expect(size).toBeDefined();
          expect(x0).toBeGreaterThanOrEqual(0); expect(y0).toBeGreaterThanOrEqual(0);
          expect(x1).toBeLessThanOrEqual(size[0]!); expect(y1).toBeLessThanOrEqual(size[1]!);
          const degrees = rotations[index]! as number;
          expect(Number.isFinite(degrees)).toBe(true); expect(Math.abs(degrees)).toBeLessThanOrEqual(180);
          // Pillow expands the rotated source about its center and rounds both
          // bounds outwards; exact final bounds are checked by the generator.
          const radians = degrees * Math.PI / 180;
          const width = degrees ? Math.ceil(Math.abs(Math.cos(radians)) * (x1 - x0) + Math.abs(Math.sin(radians)) * (y1 - y0)) + 1 : x1 - x0;
          const height = degrees ? Math.ceil(Math.abs(Math.sin(radians)) * (x1 - x0) + Math.abs(Math.cos(radians)) * (y1 - y0)) + 1 : y1 - y0;
          expect(ax).toBeGreaterThanOrEqual(0); expect(ax).toBeLessThanOrEqual(width);
          expect(ay).toBeGreaterThanOrEqual(0); expect(ay).toBeLessThanOrEqual(height);
        }
      }
    });

    it(`${id} 所有状态和招式均有显式映射，视觉与占位帧完整覆盖`, () => {
      const def = characters[id]!;
      expect(Object.keys(config.states).sort()).toEqual(Object.keys(DEFAULT_ANIMS).sort());
      expect(Object.keys(config.moves).sort()).toEqual(def.moves.map((move) => move.id).sort());
      const required = new Set(requiredFrames(id, characterAnims[id]!, moveFrameCounts(def)));
      for (const [move, spec] of Object.entries(config.moves)) {
        for (const phase of [spec.startup, spec.active, spec.recovery]) {
          expect(phase.length).toBeGreaterThan(0);
          for (const index of phase) {
            expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(spec.frames.length);
            expect(required.has(`${id}/${move}/${index}`)).toBe(true);
          }
        }
      }
    });
  }
});
