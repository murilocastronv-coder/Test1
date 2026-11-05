import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createServer } from "vite";

// A 12464x5616 map crashed GameScene.create with "Maximum call stack size exceeded":
// renderMap spread every tile into push() as an argument (lunar-wizard-7, 2026-10-24).
const TILES = 300_000;

function fakeTiles() {
  const tiles = [];
  for (let i = 0; i < TILES; i++) {
    tiles.push({ destroy() { fakeTiles.destroyed++; } });
  }
  return tiles;
}
fakeTiles.destroyed = 0;

let renderMap;
let vite;

before(async () => {
  globalThis.__fakeTiles = fakeTiles;
  const stubs = {
    phaser: "export default {};",
    "./terrainRenderer":
      "export const preloadTerrainTilesets = () => {};\n" +
      "export const renderTerrainTiles = () => ({ rendered: 1, gameObjects: globalThis.__fakeTiles() });",
    "./tileLayers":
      "export const preloadTileLayers = () => {};\n" +
      "export const renderTileLayers = () => ({ rendered: 1, gameObjects: globalThis.__fakeTiles() });",
  };
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "render-map-stubs",
      enforce: "pre",
      resolveId(id) {
        return id in stubs ? `\0stub:${id}` : null;
      },
      load(id) {
        return id.startsWith("\0stub:") ? stubs[id.slice("\0stub:".length)] : null;
      },
    }],
    server: { middlewareMode: true },
  });
  renderMap = await vite.ssrLoadModule("/src/pixellab/renderMap.ts");
});

after(async () => {
  await vite.close();
});

function largeMap() {
  return {
    folder: "big",
    map: {
      mapConfig: {
        boundingBox: { minX: 0, minY: 0 },
        tileSize: 16,
        dimensions: { pixelWidth: 12464, pixelHeight: 5616 },
      },
      overlays: [],
    },
    objects: { objects: [] },
  };
}

const scene = { cameras: { main: { setBounds() {} } } };

describe("renderMap on a map with hundreds of thousands of tiles", () => {
  it("renders without overflowing the call stack and destroys every tile", () => {
    const rendered = renderMap.renderMap(scene, largeMap());
    rendered.destroy();
    assert.equal(fakeTiles.destroyed, 2 * TILES);
  });
});
