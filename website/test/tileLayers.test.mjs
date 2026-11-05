import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createServer } from "vite";

let tileLayers;
let vite;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    plugins: [{
      name: "phaser-test-stub",
      enforce: "pre",
      resolveId(id) {
        return id === "phaser" ? "\0phaser-test-stub" : null;
      },
      load(id) {
        return id === "\0phaser-test-stub" ? "export default {};" : null;
      },
    }],
    server: { middlewareMode: true },
  });
  tileLayers = await vite.ssrLoadModule("/src/pixellab/tileLayers.ts");
});

after(async () => {
  await vite.close();
});

function obliqueTerrain(overrides = {}) {
  return {
    gridKind: "oblique",
    tileGroupId: "terrain",
    tileW: 32,
    tileH: 32,
    tileType: "oblique",
    tileView: "top-down",
    tileViewAngle: 90,
    tileDepthRatio: 0.5,
    tileSize: 32,
    nTiles: 16,
    assetPaths: { 0: "tile-layers/terrain/tile_0.png" },
    cells: [],
    tileRules: {
      rule_type: "corner",
      arity: 4,
      top_face_px: 21,
      frame_px: 32,
      wall_depth_px: 6,
      oblique_lean: 0.5,
      terrains: ["grass", "dirt"],
      tiles: { tile_0: { mask: 0 } },
    },
    ...overrides,
  };
}

function obliqueBuilding(overrides = {}) {
  return {
    gridKind: "oblique",
    tileGroupId: "building",
    tileW: 39,
    tileH: 45,
    tileType: "oblique",
    tileView: "top-down",
    tileDepthRatio: 0.5,
    tileSize: 32,
    nTiles: 56,
    role: "structure",
    assetPaths: { 0: "tile-layers/building/tile_0.png" },
    cells: [],
    tileRules: {
      rule_type: "composed",
      ground_face_px: 21,
      stack_stride_px: 6,
      oblique_lean: 0.5,
    },
    ...overrides,
  };
}

describe("current oblique tile-layer geometry", () => {
  it("uses published corner-Wang face/depth instead of the square frame as its lattice", () => {
    const layer = obliqueTerrain();

    assert.deepEqual(tileLayers.tileLayerGeometry(layer), {
      tileType: "oblique",
      tileW: 21,
      topH: 21,
      imageH: 32,
      wallDepth: 6,
    });
    assert.equal(tileLayers.tileLayerStackStridePx(layer), 6);
    assert.equal(tileLayers.tileLayerFaceDepth(layer, 0, 0), 15);
    assert.deepEqual(tileLayers.tileLayerCellAnchor(layer, 1, 1), {
      x: 31.5,
      y: 31.5,
    });
    assert.deepEqual(
      [0, 1, 2].map((level) => (
        tileLayers.tileLayerSpriteTopLeft(layer, 0, 0, 32, 32, level)
      )),
      [{ x: 0, y: -6 }, { x: -3, y: -12 }, { x: -6, y: -18 }],
    );
  });

  it("anchors native Building frames to the same ground face at every stack level", () => {
    const layer = obliqueBuilding();

    assert.deepEqual(tileLayers.tileLayerGeometry(layer), {
      tileType: "oblique",
      tileW: 21,
      topH: 21,
      imageH: 27,
      wallDepth: 6,
    });
    assert.equal(tileLayers.tileLayerStackStridePx(layer), 6);
    assert.deepEqual(
      [0, 1, 2].map((level) => (
        tileLayers.tileLayerSpriteTopLeft(layer, 0, 0, 39, 45, level)
      )),
      [{ x: -9, y: -18 }, { x: -12, y: -24 }, { x: -15, y: -30 }],
    );
  });

  it("keeps odd half-pixel storey shear periodic instead of accumulating rounding drift", () => {
    const layer = obliqueBuilding({
      tileW: 19,
      tileH: 23,
      tileDepthRatio: 1,
      tileSize: 16,
      tileRules: {
        rule_type: "composed",
        ground_face_px: 11,
        stack_stride_px: 5,
        oblique_lean: 0.5,
      },
    });

    assert.deepEqual(
      [0, 1, 2].map((level) => (
        tileLayers.tileLayerSpriteTopLeft(layer, 0, 0, 19, 23, level)
      )),
      [{ x: -4, y: -11 }, { x: -7, y: -16 }, { x: -10, y: -21 }],
    );
  });

  it("keeps a zero-thickness Building face on its unlifted ground lattice", () => {
    const layer = obliqueBuilding({
      tileDepthRatio: 0,
      tileRules: {
        rule_type: "composed",
        ground_face_px: 21,
        stack_stride_px: 1,
        oblique_lean: 0.5,
      },
    });

    assert.equal(tileLayers.tileLayerStackStridePx(layer), 1);
    assert.deepEqual(tileLayers.tileLayerGeometry(layer), {
      tileType: "oblique",
      tileW: 21,
      topH: 21,
      imageH: 21,
      wallDepth: 0,
    });
    assert.deepEqual(tileLayers.tileLayerWorldToCell(layer, 10, 20), { q: 0, r: 0 });
  });

  it("inverts both oblique stack axes when finding a raised standing face", () => {
    const layer = obliqueTerrain();
    const walkability = {
      layer,
      stridePx: 6,
      maxLevel: 1,
      cellLevels: new Map([["0,0", 1]]),
      blockedCells: new Set(),
    };

    assert.deepEqual(tileLayers.tileLayerStandingAt(walkability, 7, -2), {
      kind: "surface",
      level: 1,
      q: 0,
      r: 0,
    });
  });

  it("uses the editor/export west-to-east painter order for equal-depth cells", () => {
    const layer = obliqueTerrain({
      assetPaths: {
        0: "tile-layers/terrain/tile_0.png",
        1: "tile-layers/terrain/tile_1.png",
      },
      cells: [
        { q: 1, r: 0, tileIndex: 1 },
        { q: 0, r: 0, tileIndex: 0 },
      ],
    });
    const draws = [];
    const scene = {
      textures: {
        exists: () => true,
        get: () => ({ getSourceImage: () => ({ width: 32, height: 32 }) }),
      },
      add: {
        image: (x, y, key) => {
          draws.push({ x, y, key });
          return {
            setOrigin() { return this; },
            setDepth() { return this; },
          };
        },
      },
    };
    const mapData = {
      folder: "map",
      tileLayers: { version: "1.0", layers: [layer] },
    };

    tileLayers.renderTileLayers(scene, mapData);

    assert.deepEqual(draws, [
      { x: 0, y: -6, key: "tile-layer-map-terrain-0" },
      { x: 21, y: -6, key: "tile-layer-map-terrain-1" },
    ]);
  });

  it("rejects a wrong-size fixed frame instead of rescaling pixel art", () => {
    const layer = obliqueTerrain({ cells: [{ q: 0, r: 0, tileIndex: 0 }] });
    const scene = {
      textures: {
        exists: () => true,
        get: () => ({ getSourceImage: () => ({ width: 31, height: 32 }) }),
      },
    };
    const mapData = {
      folder: "map",
      tileLayers: { version: "1.0", layers: [layer] },
    };

    assert.throws(
      () => tileLayers.renderTileLayers(scene, mapData),
      /expected native 32x32/,
    );
  });

  it("rejects a partial fixed-frame geometry tuple", () => {
    const layer = obliqueTerrain();
    delete layer.tileRules.wall_depth_px;

    assert.throws(
      () => tileLayers.tileLayerGeometry(layer),
      /requires top_face_px, frame_px, oblique_lean, and wall_depth_px together/,
    );
  });
});

describe("square_topdown rows match the editor and map export", () => {
  // Numbers from api/app/endpoints/maps/export.py `_tile_layer_geometry` on the
  // same layers (2026-10-30). The template kept a pre-0dd7636429 rule and drew a
  // 64px low top-down floor on 46px rows while the editor and composite used 22.
  const cases = [
    [{ tileW: 64, tileH: 64, tileView: "low top-down" }, 22, 64],
    [{ tileW: 64, tileH: 35, tileView: "low top-down" }, 22, 35],
    [{ tileW: 64, tileH: 64, tileView: "high top-down" }, 37, 64],
    [{ tileW: 64, tileH: 64, tileView: "top-down" }, 64, 64],
    [{ tileW: 32, tileH: 32, tileView: "low top-down" }, 11, 32],
    [{ tileW: 64, tileH: 64, tileView: "low top-down", tileDepthRatio: 0 }, 22, 64],
    [{ tileW: 64, tileH: 64, tileViewAngle: 30 }, 32, 64],
    [{ tileW: 64, tileH: 128, tileHeight: 128, tileView: "low top-down" }, 22, 128],
    // published corner-Wang face/frame win over the formula (codex review)
    [{ tileW: 64, tileH: 64, tileViewAngle: 30, tileRules: { rule_type: "corner", top_face_px: 32, frame_px: 60 } }, 32, 60],
  ];
  for (const [layer, topH, imageH] of cases) {
    it(JSON.stringify(layer), () => {
      const geom = tileLayers.tileLayerGeometry({ tileType: "square_topdown", ...layer });
      assert.deepEqual([geom.topH, geom.imageH], [topH, imageH]);
    });
  }
});
