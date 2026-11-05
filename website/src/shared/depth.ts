import Phaser from "phaser";

export function setYDepth(gameObject: Phaser.GameObjects.Components.Depth, y: number, offset = 0): void {
  gameObject.setDepth(y + offset);
}
