import { describe, expect, it } from 'vitest';
import { characterSelectLayout } from '../../src/render/ui/characterSelectLayout';

describe('character select layout', () => {
  it('keeps the four-fighter crossover roster inside the 960x540 canvas', () => {
    const layout = characterSelectLayout(4);
    expect(layout.rosterTiles).toHaveLength(4);
    for (const rect of [...layout.playerPanels, ...layout.rosterTiles]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(960);
      expect(rect.y + rect.height).toBeLessThanOrEqual(540);
    }
    for (let i = 1; i < layout.rosterTiles.length; i++) {
      expect(layout.rosterTiles[i]!.x).toBeGreaterThanOrEqual(
        layout.rosterTiles[i - 1]!.x + layout.rosterTiles[i - 1]!.width,
      );
    }
    expect(layout.rosterTiles[0]!.y).toBeGreaterThan(
      layout.playerPanels[0].y + layout.playerPanels[0].height,
    );
    expect(layout.controlsY).toBeLessThan(520);
  });

  it('rejects unsupported roster sizes instead of silently overflowing', () => {
    expect(() => characterSelectLayout(0)).toThrow(RangeError);
    expect(() => characterSelectLayout(7)).toThrow(RangeError);
  });
});
