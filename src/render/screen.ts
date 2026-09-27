import { VIEW_H, VIEW_W } from '@core/index';

/** Layout pixels are based on the original 960×540 design, independently of texture density. */
export function renderScaleFor(search: string): 2 | 4 {
  const params = new URLSearchParams(search);
  return params.get('art') === 'anime' && params.get('quality') !== 'performance' ? 4 : 2;
}

export const RENDER_SCALE = renderScaleFor(typeof window === 'undefined' ? '' : window.location.search);
export const UI_SCALE = RENDER_SCALE / 2;
export const SCREEN_W = VIEW_W * RENDER_SCALE;
export const SCREEN_H = VIEW_H * RENDER_SCALE;
export const LAYOUT_W = VIEW_W * 2;
export const LAYOUT_H = VIEW_H * 2;
export const ui = (pixels: number): number => pixels * UI_SCALE;
export const font = (pixels: string | number): string => `${Number.parseFloat(String(pixels)) * UI_SCALE}px`;
