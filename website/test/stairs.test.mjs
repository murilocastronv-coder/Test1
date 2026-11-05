import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createServer } from "vite";

let collision;
let stairs;
let vite;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  [collision, stairs] = await Promise.all([
    vite.ssrLoadModule("/src/pixellab/collision.ts"),
    vite.ssrLoadModule("/src/pixellab/stairs.ts"),
  ]);
});

after(async () => {
  await vite.close();
});

describe("stair annotations", () => {
  const annotations = {
    layers: [{
      id: "stairs-1",
      name: "Stairs",
      tags: [],
      rects: [
        { x: 0, y: 0, width: 4, height: 2 },
        { x: 2, y: 2, width: 4, height: 2 },
        { x: 4, y: 4, width: 4, height: 2 },
      ],
    }],
  };

  it("treats stairs as authored walkable terrain", () => {
    assert.equal(collision.collisionModeForLabel("stairs"), "allow");
    assert.equal(collision.collisionModeForLabel("stone staircase"), "allow");
  });

  it("derives the diagonal from the annotation mask", () => {
    const [area] = stairs.stairAreasFor(annotations);
    assert.ok(area.axis.x > 0.6);
    assert.ok(area.axis.y > 0.6);
    assert.ok(area.axis.x > area.axis.y);
    assert.equal(stairs.stairAreaAt([area], 3, 3), area);
    assert.equal(stairs.stairAreaAt([area], 20, 20), null);
  });

  it("keeps traversal active until the authored stair span is cleared", () => {
    const [area] = stairs.stairAreasFor(annotations);
    const midpoint = (area.minProjection + area.maxProjection) / 2;
    const pathX = area.axis.x * midpoint;
    const pathY = area.axis.y * midpoint;
    assert.equal(stairs.isWithinStairSpan(area, pathX, pathY), true);
    assert.equal(
      stairs.isWithinStairSpan(
        area,
        area.axis.x * (area.maxProjection + 1),
        area.axis.y * (area.maxProjection + 1),
      ),
      false,
    );
  });

  it("constrains movement to ascending or descending the stairs", () => {
    const [area] = stairs.stairAreasFor(annotations);
    const descending = stairs.movementAlongStairs({ x: 1, y: 0 }, area);
    const ascending = stairs.movementAlongStairs({ x: 0, y: -1 }, area);
    assert.ok(descending.x > 0 && descending.y > 0);
    assert.ok(ascending.x < 0 && ascending.y < 0);
    assert.ok(Math.abs(Math.hypot(descending.x, descending.y) - 1) < 1e-9);
  });
  it("handles a stair mask made of tens of thousands of cells", () => {
    // Stair rects come from map cells; Math.min(...projections) overflowed the
    // call stack on a map this large (same family as renderMap, 2026-10-24).
    const rects = [];
    for (let i = 0; i < 40_000; i++) rects.push({ x: i, y: i, width: 1, height: 1 });
    const [area] = stairs.stairAreasFor({ layers: [{ id: "big", name: "Stairs", tags: [], rects }] });
    assert.ok(area.maxProjection > area.minProjection);
  });
});
