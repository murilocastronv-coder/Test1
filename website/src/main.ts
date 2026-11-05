import Phaser from "phaser";
import { BootScene, MAP_DATA_REGISTRY_KEY } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";
import { mapObjectsAtlasKey } from "./pixellab/renderMap";
import type { LoadedMap } from "./pixellab/types";
import "./styles.css";

// Global error handler: surfaces ALL runtime errors visibly on-screen
// so the agent's smoke test (screenshot + console check) always catches them.
// Also exposes window.gameErrors API for programmatic error retrieval.
interface GameError { message: string; isWarning: boolean }
const collectedErrors: GameError[] = [];
(window as unknown as Record<string, unknown>).gameErrors = {
  getErrors: () => collectedErrors,
};

function showFatalError(message: string): void {
  console.error("[GAME_ERROR]", message);
  collectedErrors.push({ message, isWarning: false });
  let overlay = document.getElementById("error-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "error-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.85);color:#ff4444;" +
      "font:14px/1.6 monospace;padding:24px;z-index:99999;overflow:auto;white-space:pre-wrap;";
    document.body.appendChild(overlay);
  }
  overlay.textContent += message + "\n\n";
}

window.onerror = (_event, source, line, col, error) => {
  const location = source ? `${source}:${line}:${col}` : "unknown";
  showFatalError(`Uncaught error at ${location}\n${error?.stack ?? error ?? "unknown"}`);
};

window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  showFatalError(`Unhandled promise rejection\n${message}`);
};

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#111111",
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: "100%",
    height: "100%",
  },
  scene: [BootScene, GameScene],
};

const game = new Phaser.Game(config);

// A canvas is opaque to automated playtesting. agent-browser and Playwright can
// press keys and take screenshots, but cannot answer "did that hit land?" or even
// "where is the player?" — and guessing from screenshots produces false bug
// reports: thirty attacks in a row logged "You miss", which looked exactly like
// broken hit detection and was really a wandering enemy that had walked
// off-screen. So expose the state, the same way window.gameErrors above exposes
// errors. Deliberately generic — agents rewrite the scenes, so this must not
// assume any particular one.
(window as unknown as Record<string, unknown>).game = game;
(window as unknown as Record<string, unknown>).playtest = () => {
  // Every scene and what state it is in. `getScenes(true)` is ACTIVE-only, so a
  // game sitting on a paused menu reported `{scene: null}` and nothing else —
  // true, useless, and indistinguishable from a game that failed to boot. A
  // playtest agent hit exactly that on a wake-screen -> menu -> hero-select
  // intro and spent all 15 of its iterations clicking canvas pixels blind.
  const scenes = game.scene.getScenes(false).map((candidate: Phaser.Scene) => ({
    key: candidate.scene.key,
    active: candidate.scene.isActive(),
    paused: candidate.scene.isPaused(),
    sleeping: candidate.scene.isSleeping(),
    visible: candidate.scene.isVisible(),
  }));
  const scene = game.scene.getScenes(true)[0] as Phaser.Scene | undefined;
  if (!scene) return { scene: null, scenes, errors: collectedErrors.length };
  const camera = scene.cameras?.main;
  // Phaser 4 keeps these in a Set, not a Group — there is no getArray() here.
  const world = scene.physics?.world as Phaser.Physics.Arcade.World | undefined;
  const mapData = scene.registry.get(MAP_DATA_REGISTRY_KEY) as LoadedMap | undefined;
  const bodies: Phaser.Physics.Arcade.Body[] = world
    ? (Array.from(world.bodies) as Phaser.Physics.Arcade.Body[])
    : [];
  return {
    scene: scene.scene.key,
    scenes,
    fps: Math.round(game.loop.actualFps),
    objects: scene.children?.list?.length ?? 0,
    // Every physics body with whatever name or texture identifies it, so a
    // caller can find the player, find the enemies, and measure the gap.
    bodies: bodies.map((body) => {
      const owner = body.gameObject as Phaser.GameObjects.Sprite | undefined;
      return {
        x: Math.round(body.x),
        y: Math.round(body.y),
        name: owner?.name || owner?.texture?.key || "?",
      };
    }),
    map: mapData
      ? {
          name: mapData.map.name,
          expectedObjects: mapData.objects.objects.filter((object) => object.visible).length,
          renderedObjects: scene.children.list.filter((child) => (
            child instanceof Phaser.GameObjects.Image
            && child.texture.key === mapObjectsAtlasKey(mapData.folder)
          )).length,
          pixelWidth: mapData.map.mapConfig.dimensions.pixelWidth,
          pixelHeight: mapData.map.mapConfig.dimensions.pixelHeight,
        }
      : null,
    camera: camera
      ? { x: Math.round(camera.scrollX), y: Math.round(camera.scrollY), zoom: camera.zoom }
      : null,
    errors: collectedErrors.length,
  };
};
