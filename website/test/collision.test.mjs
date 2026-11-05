import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createServer } from "vite";

let collision;
let groundBoundsBuilder;
let spatialIndex;
let sharedCollision;
let types;
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
  [collision, groundBoundsBuilder, spatialIndex, sharedCollision, types] = await Promise.all([
    vite.ssrLoadModule("/src/pixellab/collision.ts"),
    vite.ssrLoadModule("/scripts/add-object-ground-bounds.mjs"),
    vite.ssrLoadModule("/src/pixellab/spatialIndex.ts"),
    vite.ssrLoadModule("/src/shared/collision.ts"),
    vite.ssrLoadModule("/src/pixellab/types.ts"),
  ]);
});

after(async () => {
  await vite.close();
});

function mapWithBlockers(blockers) {
  return {
    map: { mapConfig: { tileSize: 16 } },
    terrainMap: { defaultTerrain: 1, cells: [], cellIndex: new Map() },
    collisionRects: [],
    collisionRectIndex: spatialIndex.buildRectSpatialIndex([], 16),
    objectBlockerRects: blockers,
    objectBlockerIndex: spatialIndex.buildRectSpatialIndex(blockers, 16),
    walkableTerrainIds: new Set([1]),
    hasAllowCollisionRects: false,
    hasTerrainCollisionSources: false,
    tileLayers: null,
    tileLayerWalkability: null,
  };
}

describe("placed object collision", () => {
  it("derives a broad bed base and a narrow tree trunk from sprite alpha", () => {
    const image = (width, height, opaque) => {
      const data = new Uint8Array(width * height * 4);
      for (const [left, top, right, bottom] of opaque) {
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            data[(y * width + x) * 4 + 3] = 255;
          }
        }
      }
      return { width, height, data };
    };

    assert.deepEqual(
      groundBoundsBuilder.objectGroundBounds(
        image(30, 48, [[0, 0, 30, 48]]),
        { x: 20, y: -24, width: 30, height: 48 },
      ),
      { x: 20, y: 12, width: 30, height: 12 },
    );
    assert.deepEqual(
      groundBoundsBuilder.objectGroundBounds(
        image(95, 105, [[0, 0, 95, 79], [29, 79, 62, 105]]),
        { x: 100, y: 200, width: 95, height: 105 },
      ),
      { x: 129, y: 279, width: 33, height: 26 },
    );
  });

  it("uses grounded footprints for visible objects and ignores hidden objects", () => {
    const bed = { x: 20, y: -24, width: 30, height: 48 };
    const bedGround = { x: 21, y: 12, width: 28, height: 12 };
    assert.deepEqual(collision.objectBlockerRectsFor({
      objects: [
        { filename: "bed.png", visible: true, boundingBox: bed, groundBounds: bedGround },
        { filename: "hidden.png", visible: false, boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
      ],
    }), [{ id: "bed.png", ...bedGround }]);
  });

  it("keeps object foot geometry available only for visual depth", () => {
    const box = { x: 20, y: -24, width: 30, height: 48 };
    const foot = types.objectFootRegion(box);
    assert.equal(foot.centerX, 35);
    assert.equal(foot.centerY, box.y + box.height - foot.halfHeight);
    assert.ok(foot.halfWidth * 2 < box.width);
  });

  it("cannot tunnel through a blocker during a large frame", () => {
    const bed = { id: "bed.png", x: 20, y: 12, width: 28, height: 12 };
    const moved = sharedCollision.moveWithCollision(
      mapWithBlockers([bed]),
      0,
      18,
      56,
      0,
      { width: 4, height: 4, footOffsetY: 0 },
    );
    assert.deepEqual(moved, { x: 18, y: 18 });
  });

  it("continues sliding along a blocker during diagonal movement", () => {
    const wall = { id: "wall.png", x: 20, y: -100, width: 30, height: 200 };
    const moved = sharedCollision.moveWithCollision(
      mapWithBlockers([wall]),
      0,
      0,
      56,
      20,
      { width: 4, height: 4, footOffsetY: 0 },
    );
    assert.ok(moved.x <= 18);
    assert.ok(Math.abs(moved.y - 20) < 1e-9);
  });
});
