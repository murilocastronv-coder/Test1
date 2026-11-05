/**
 * Terrains from two tilesets made separately meet with a hard edge.
 *
 * No tileset spans sand and grass here, so a tile with both at its corners used
 * to throw "No tileset can render terrains" and take the whole game down. The Map
 * Editor draws such a tile from quarters — each one cut from its own corner's
 * plain tile — and the game must draw the same thing from the same map.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createServer } from "vite";

const OCEAN = 1;
const SAND = 2;
const DIRT = 3;
const GRASS = 4;
const STONE = 5; // defined on the map, drawn by no tileset
const ALL_UPPER_FRAME = 12; // WANG_TO_ATLAS[15]
const ALL_LOWER_FRAME = 6; // WANG_TO_ATLAS[0]
const FOLDER = "hard-edge";

let terrainRenderer;
let vite;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "phaser-stub",
      enforce: "pre",
      resolveId(id) {
        return id === "phaser" ? "\0stub:phaser" : null;
      },
      load(id) {
        return id === "\0stub:phaser" ? "export default {};" : null;
      },
    }],
    server: { middlewareMode: true },
  });
  terrainRenderer = await vite.ssrLoadModule("/src/pixellab/terrainRenderer.ts");
});

after(async () => {
  await vite.close();
});

function fakeScene() {
  const images = [];
  return {
    images,
    textures: { exists: () => true },
    add: {
      image(x, y, key, frame) {
        const image = {
          x, y, key, frame, width: 16, height: 16, crop: null,
          setCrop(cropX, cropY, width, height) {
            this.crop = [cropX, cropY, width, height];
            return this;
          },
          setDepth() {
            return this;
          },
        };
        images.push(image);
        return image;
      },
    },
  };
}

/**
 * Four tiles in a row, rendered from a 5x3 grid of corner cells. Every cell is
 * `fill` except column 2 and right of it, which is `right`. So tile 1 is all
 * `fill`, tile 2 straddles both, and tile 3 is all `right`. `cells` repaints
 * single corner cells on top; `tilesets` adds tilesets to the two below.
 */
function mapData({ fill, right, cells: repainted = [], tilesets = [] }) {
  const cells = [];
  for (let y = 0; y <= 2; y += 1) {
    for (let x = 2; x <= 4; x += 1) {
      cells.push({ x, y, terrainId: right });
    }
  }
  cells.push(...repainted);
  return {
    folder: FOLDER,
    map: {
      name: "hard edge",
      mapConfig: {
        tileSize: 16,
        dimensions: { width: 4, height: 2 },
        boundingBox: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
      },
      terrains: [
        { id: OCEAN, name: "ocean" },
        { id: SAND, name: "sand" },
        { id: DIRT, name: "dirt" },
        { id: GRASS, name: "grass" },
        { id: STONE, name: "stone" },
      ],
      // Two tilesets made separately: nothing pairs sand with grass.
      tilesets: [
        { id: "beach", filename: "beach.png", lowerTerrainId: OCEAN, upperTerrainId: SAND, transitionSize: 0 },
        { id: "meadow", filename: "meadow.png", lowerTerrainId: DIRT, upperTerrainId: GRASS, transitionSize: 0 },
        ...tilesets,
      ],
    },
    terrainMap: { defaultTerrain: fill, cells },
  };
}

const key = (filename) => `tileset-${FOLDER}-${filename}`;

describe("terrains from separate tilesets", () => {
  it("meet with a hard edge: four quarters, each from its own corner's plain tile", () => {
    const scene = fakeScene();
    terrainRenderer.renderTerrainTiles(scene, mapData({ fill: SAND, right: GRASS }));

    const seam = scene.images.filter((image) => image.x === 32 && image.y === 16);
    assert.deepEqual(
      seam.map(({ key: k, frame, crop }) => ({ key: k, frame, crop })),
      [
        { key: key("beach.png"), frame: ALL_UPPER_FRAME, crop: [0, 0, 8, 8] }, // NW: sand
        { key: key("meadow.png"), frame: ALL_UPPER_FRAME, crop: [8, 0, 8, 8] }, // NE: grass
        { key: key("beach.png"), frame: ALL_UPPER_FRAME, crop: [0, 8, 8, 8] }, // SW: sand
        { key: key("meadow.png"), frame: ALL_UPPER_FRAME, crop: [8, 8, 8, 8] }, // SE: grass
      ],
    );

    // Tiles off the seam are untouched: one whole tile each, no crop.
    for (const x of [16, 48]) {
      const whole = scene.images.filter((image) => image.x === x && image.y === 16);
      assert.equal(whole.length, 1, `tile at x=${x}`);
      assert.equal(whole[0].crop, null, `tile at x=${x}`);
    }
  });

  it("still uses the tileset's own transition where one spans the pair", () => {
    // Non-vacuous: the same layout with ocean/sand, which one tileset covers,
    // draws the Wang transition tile rather than quarters.
    const scene = fakeScene();
    terrainRenderer.renderTerrainTiles(scene, mapData({ fill: OCEAN, right: SAND }));

    const seam = scene.images.filter((image) => image.x === 32 && image.y === 16);
    assert.equal(seam.length, 1);
    assert.equal(seam[0].crop, null);
    assert.equal(seam[0].key, key("beach.png"));
  });

  it("use quarters, not layering, where three terrains leave a pair with no tileset", () => {
    // Tile 2's corners are sand, dirt / sand, grass. Layering draws pairs in
    // order — sand+dirt (no tileset), then dirt+grass — so it used to paint
    // the sand corners as dirt. Quarters keep each corner its own terrain.
    const scene = fakeScene();
    terrainRenderer.renderTerrainTiles(scene, mapData({
      fill: SAND, right: GRASS, cells: [{ x: 2, y: 0, terrainId: DIRT }],
    }));

    const seam = scene.images.filter((image) => image.x === 32 && image.y === 16);
    assert.deepEqual(
      seam.map(({ key: k, frame, crop }) => ({ key: k, frame, crop })),
      [
        { key: key("beach.png"), frame: ALL_UPPER_FRAME, crop: [0, 0, 8, 8] }, // NW: sand
        { key: key("meadow.png"), frame: ALL_LOWER_FRAME, crop: [8, 0, 8, 8] }, // NE: dirt
        { key: key("beach.png"), frame: ALL_UPPER_FRAME, crop: [0, 8, 8, 8] }, // SW: sand
        { key: key("meadow.png"), frame: ALL_UPPER_FRAME, crop: [8, 8, 8, 8] }, // SE: grass
      ],
    );
  });

  it("use quarters where three terrains meet, even when every pair has a tileset", () => {
    // Layering drew one opaque Wang tile per pair, and each reads every corner
    // that is not its upper terrain as its lower — so the dirt/grass layer on
    // top painted the sand corners as dirt even with a sand/dirt tileset under
    // it. One tileset spans at most two terrains, so three always get quarters.
    const scene = fakeScene();
    terrainRenderer.renderTerrainTiles(scene, mapData({
      fill: SAND,
      right: GRASS,
      cells: [{ x: 2, y: 0, terrainId: DIRT }],
      tilesets: [
        { id: "dune", filename: "dune.png", lowerTerrainId: SAND, upperTerrainId: DIRT, transitionSize: 0 },
      ],
    }));

    const seam = scene.images.filter((image) => image.x === 32 && image.y === 16);
    assert.deepEqual(
      seam.map(({ key: k, frame, crop }) => ({ key: k, frame, crop })),
      [
        { key: key("beach.png"), frame: ALL_UPPER_FRAME, crop: [0, 0, 8, 8] }, // NW: sand
        { key: key("meadow.png"), frame: ALL_LOWER_FRAME, crop: [8, 0, 8, 8] }, // NE: dirt
        { key: key("beach.png"), frame: ALL_UPPER_FRAME, crop: [0, 8, 8, 8] }, // SW: sand
        { key: key("meadow.png"), frame: ALL_UPPER_FRAME, crop: [8, 8, 8, 8] }, // SE: grass
      ],
    );
  });

  it("still throws for a terrain that no tileset draws at all", () => {
    const scene = fakeScene();
    assert.throws(
      () => terrainRenderer.renderTerrainTiles(scene, mapData({ fill: SAND, right: STONE })),
      /No tileset can render terrains 2,5 at tile 2,1/,
    );
  });

  it("declares hard edges, which the build's asset check reads", () => {
    // validate-map-assets.mjs lets separate tilesets touch only when the
    // project's renderer says it draws them; see DRAWS_HARD_TERRAIN_EDGES.
    assert.equal(terrainRenderer.DRAWS_HARD_TERRAIN_EDGES, true);
  });
});
