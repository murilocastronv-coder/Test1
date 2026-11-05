import type Phaser from "phaser";
import { assetUrl } from "../pixellab/templateAssetPaths";
import type { PlayerController } from "../player/PlayerController";

export const WINGS_FILE = "objects/b02a85e2-8a92-4b70-8d4b-8dcb9f3eb4f7/base/rotations/unknown.png";
export class HeroWings {
  private readonly image: Phaser.GameObjects.Image;
  static preload(scene: Phaser.Scene): void { scene.load.image("hero-golden-wings", assetUrl(WINGS_FILE)); }
  constructor(scene: Phaser.Scene, private player: PlayerController) {
    this.image = scene.add.image(player.sprite.x, player.sprite.y, "hero-golden-wings").setVisible(false);
  }
  update(equipped: boolean, started: boolean): void {
    const sprite = this.player.sprite;
    const facing = this.player.facing;
    const side = facing === "east" || facing === "west";
    // One-facing equipment: keep the golden feather silhouette, narrow it in profile.
    this.image.setVisible(equipped && started).setPosition(sprite.x, sprite.y - 9);
    this.image.setScale(side ? .55 : 1, 1);
    this.image.setDepth(sprite.depth + (facing.startsWith("north") ? .1 : -.1));
  }
  get visible(): boolean { return this.image.visible; }
  destroy(): void { this.image.destroy(); }
}
