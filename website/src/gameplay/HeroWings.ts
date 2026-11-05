import type Phaser from "phaser";
import { assetUrl } from "../pixellab/templateAssetPaths";
import type { PlayerController } from "../player/PlayerController";
import { WING_CATALOG } from "./WingCatalog";

export const WINGS_FILE = "objects/b02a85e2-8a92-4b70-8d4b-8dcb9f3eb4f7/base/rotations/unknown.png";
export class HeroWings {
  private phase: number = 0;
  private readonly image: Phaser.GameObjects.Image;
  static preload(scene: Phaser.Scene): void {
    scene.load.image("hero-golden-wings", assetUrl(WINGS_FILE));
    for(const wing of WING_CATALOG) scene.load.image(`wing-${wing.id}`, assetUrl(wing.file));
  }
  constructor(scene: Phaser.Scene, private player: PlayerController) {
    this.image = scene.add.image(player.sprite.x, player.sprite.y, "hero-golden-wings").setVisible(false);
  }
  update(equipped: boolean, started: boolean, wingId?: string): void {
    const wing = WING_CATALOG.find(w=>w.id===wingId);
    const texture = wing ? `wing-${wing.id}` : "hero-golden-wings";
    if(this.image.texture.key !== texture) this.image.setTexture(texture);
    const sprite = this.player.sprite;
    const facing = this.player.facing;
    const side = facing === "east" || facing === "west";
    // One-facing equipment: keep the golden feather silhouette, narrow it in profile.
    this.image.setVisible(equipped && started).setPosition(sprite.x, sprite.y - 9 * sprite.scaleY);
    this.phase += .028;
    const opening = .94 + Math.sin(this.phase) * .06;
    this.image.setScale((side ? .55 : 1) * sprite.scaleX * opening, sprite.scaleY * (1 + Math.sin(this.phase) * .012));
    this.image.setDepth(sprite.depth + (facing.startsWith("north") ? .1 : -.1));
  }
  get visible(): boolean { return this.image.visible; }
  get texture(): string { return this.image.texture.key; }
  destroy(): void { this.image.destroy(); }
}
