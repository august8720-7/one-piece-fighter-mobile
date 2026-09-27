export interface UiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterSelectLayout {
  playerPanels: readonly [UiRect, UiRect];
  rosterTiles: readonly UiRect[];
  statusY: number;
  controlsY: number;
}

/**
 * Pure 960x540 layout used by CharacterSelectScene. Keeping this calculation
 * outside Phaser makes roster growth and small-screen overflow testable.
 */
export function characterSelectLayout(rosterSize: number): CharacterSelectLayout {
  if (!Number.isInteger(rosterSize) || rosterSize < 1 || rosterSize > 6) {
    throw new RangeError('character select supports 1 to 6 fighters');
  }

  const margin = 38;
  const panelGap = 142;
  const panelWidth = (960 - margin * 2 - panelGap) / 2;
  const playerPanels: [UiRect, UiRect] = [
    { x: margin, y: 106, width: panelWidth, height: 198 },
    { x: 960 - margin - panelWidth, y: 106, width: panelWidth, height: 198 },
  ];

  const available = 720;
  const gap = rosterSize > 1 ? 12 : 0;
  const tileWidth = Math.min(162, Math.floor((available - gap * (rosterSize - 1)) / rosterSize));
  const total = tileWidth * rosterSize + gap * (rosterSize - 1);
  const x0 = (960 - total) / 2;
  const rosterTiles = Array.from({ length: rosterSize }, (_, index) => ({
    x: x0 + index * (tileWidth + gap),
    y: 320,
    width: tileWidth,
    height: 88,
  }));

  return { playerPanels, rosterTiles, statusY: 428, controlsY: 474 };
}
