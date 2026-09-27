import type { FrameAttachments } from './animations';

export interface FightBounds { left: number; top: number; right: number; bottom: number }
export interface FightFraming { zoom: number; centerX: number; offsetX: number; offsetY: number }
export interface FramingViewport { width: number; groundY: number; top: number; sideMargin: number }

/** Bounds in the unscaled fight display. Mirroring uses the same explicit foot root as the sprite. */
export function frameFramingBounds(frame: FrameAttachments, x: number, y: number, facing: 1 | -1, scale: number): FightBounds {
  const firstX = -frame.root.x * scale * facing;
  const lastX = (frame.size.width - frame.root.x) * scale * facing;
  return {
    left: x + Math.min(firstX, lastX), right: x + Math.max(firstX, lastX),
    top: y - frame.root.y * scale, bottom: y + (frame.size.height - frame.root.y) * scale,
  };
}

export function unionFightBounds(bounds: readonly FightBounds[]): FightBounds | null {
  if (!bounds.length) return null;
  return {
    left: Math.min(...bounds.map(box => box.left)), right: Math.max(...bounds.map(box => box.right)),
    top: Math.min(...bounds.map(box => box.top)), bottom: Math.max(...bounds.map(box => box.bottom)),
  };
}

/** Fits artwork, not collision boxes. Pulling out is immediate enough to preserve edges; returning is gradual. */
export function fitFightFraming(bounds: FightBounds | null, view: FramingViewport, previous?: FightFraming, elapsedFrames = 1): FightFraming {
  const center = view.width / 2;
  if (!bounds) return { zoom: 1, centerX: center, offsetX: 0, offsetY: 0 };
  const usableWidth = Math.max(1, view.width - view.sideMargin * 2);
  const upperHeight = Math.max(1, view.groundY - view.top);
  const required = Math.min(1, usableWidth / Math.max(1, bounds.right - bounds.left), upperHeight / Math.max(1, view.groundY - bounds.top));
  const blend = 1 - Math.exp(-Math.max(0, Math.min(6, elapsedFrames)) / 12);
  const zoom = previous ? Math.min(required, previous.zoom + (1 - previous.zoom) * blend) : required;
  const halfWidth = usableWidth / (2 * zoom);
  const lowerCenter = bounds.right - halfWidth;
  const upperCenter = bounds.left + halfWidth;
  const preferredCenter = previous ? previous.centerX + (center - previous.centerX) * blend : center;
  const centerX = Math.max(lowerCenter, Math.min(upperCenter, preferredCenter));
  return { zoom, centerX, offsetX: center - centerX * zoom, offsetY: view.groundY * (1 - zoom) };
}
