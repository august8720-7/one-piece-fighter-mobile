import Phaser from 'phaser';
import { UI_SCALE } from '../screen';

/** Keep a self-contained 960×540 UI layout while rasterizing text at its final pixel density. */
export function layoutGroup(scene: Phaser.Scene, nodes: Phaser.GameObjects.GameObject[], depth: number): Phaser.GameObjects.Container {
  for (const node of nodes) {
    if (node instanceof Phaser.GameObjects.Text) node.setResolution(UI_SCALE);
  }
  nodes.sort((a, b) => (('depth' in a ? Number(a.depth) : 0) - ('depth' in b ? Number(b.depth) : 0)));
  return scene.add.container(0, 0, nodes).setScale(UI_SCALE).setDepth(depth);
}
