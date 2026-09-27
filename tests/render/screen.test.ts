import { describe, expect, it } from 'vitest';
import { renderScaleFor } from '../../src/render/screen';

describe('canvas quality selection', () => {
  it('anime full menus and training use 1080p independently of game mode', () => {
    for (const mode of ['', '&mode=training', '&mode=cpu', '&mode=versus']) {
      expect(renderScaleFor('?art=anime' + mode)).toBe(4);
    }
  });
  it('performance retains anime artwork on a 540p backing and legacy keeps its baseline', () => {
    expect(renderScaleFor('?art=anime&quality=performance')).toBe(2);
    expect(renderScaleFor('')).toBe(2);
  });
});
