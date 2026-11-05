import Phaser from "phaser";
import { preloadNpcs } from "../npc/spawnNpcs";
import { loadPixelLabMap } from "../pixellab/loadMap";
import { preloadMapAssets } from "../pixellab/renderMap";
import { PlayerController } from "../player/PlayerController";
import { FireProjectileSystem } from "../gameplay/FireProjectileSystem";
import { CharacterSelection } from "../gameplay/CharacterSelection";

export const MAP_DATA_REGISTRY_KEY = "pixellab-map-data";

const BAR_WIDTH = 200;
const BAR_HEIGHT = 4;
const BAR_BORDER = 1;

export class BootScene extends Phaser.Scene {
  private progressBar!: Phaser.GameObjects.Graphics;

  constructor() {
    super("BootScene");
  }

  create(): void {
    this.createLoadingUI();
    this.loadTemplateAssets().catch((error) => {
      console.error("Failed to load assets:", error);
      this.showError(error instanceof Error ? error.message : "Failed to load game assets");
    });
  }

  private createLoadingUI(): void {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    const border = this.add.graphics();
    border.lineStyle(BAR_BORDER, 0x444444, 1);
    border.strokeRect(
      centerX - BAR_WIDTH / 2 - BAR_BORDER,
      centerY - BAR_HEIGHT / 2 - BAR_BORDER,
      BAR_WIDTH + BAR_BORDER * 2,
      BAR_HEIGHT + BAR_BORDER * 2,
    );

    this.progressBar = this.add.graphics();

    this.load.on("progress", (value: number) => {
      this.progressBar.clear();
      this.progressBar.fillStyle(0x5a8a6a, 1);
      this.progressBar.fillRect(
        centerX - BAR_WIDTH / 2,
        centerY - BAR_HEIGHT / 2,
        BAR_WIDTH * value,
        BAR_HEIGHT,
      );
    });
  }

  private showError(message: string): void {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, message, {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#ff4444",
      align: "center",
      wordWrap: { width: width * 0.8 },
    }).setOrigin(0.5);
  }

  private async loadTemplateAssets(): Promise<void> {
    const mapData = await loadPixelLabMap();
    this.registry.set(MAP_DATA_REGISTRY_KEY, mapData);

    preloadMapAssets(this, mapData);
    PlayerController.preload(this);
    CharacterSelection.preload(this);
    FireProjectileSystem.preload(this);
    preloadNpcs(this);

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.scene.start("GameScene");
    });
    this.load.start();
  }
}
