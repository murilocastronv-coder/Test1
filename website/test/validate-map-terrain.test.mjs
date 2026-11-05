/**
 * An unrenderable terrain combination is a property of the PAIR, not of the one
 * tile where the scan first met it.
 *
 * Reported twice on 2026-10-05: users repainted the single tile the error named,
 * re-exported, and validation came back with the next tile holding the same pair
 * — "maps repaired/re-exported repeatedly but deploy still rejects terrain
 * pairs". The error now reports how many tiles share the pair, so the size of
 * the problem is visible before anyone starts repainting.
 *
 * Driven through the real script with spawnSync: build.sh runs exactly that.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "scripts",
  "validate-map-assets.mjs",
);
const RENDERER = join(
  import.meta.dirname,
  "..",
  "src",
  "pixellab",
  "terrainRenderer.ts",
);
const PLAYER_ID = "player-character";
const GRASS = 1;
const WATER = 2;
const SAND = 3;
const SHORE = 4; // the synthetic terrain of the water/sand transition set
const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * A square map of `grass`, with `waterCells` painted to a terrain that has no
 * tileset pairing it with grass — so every tile touching both is unrenderable.
 * `waterTileset` gives water a tileset of its own, made separately from grass's:
 * the two still share none, but each terrain can now be drawn on its own.
 * `shoreMatchers` instead puts water in a water/sand TRANSITION set with these
 * transitionMatcherTiles — which decide whether that set can draw plain water.
 */
function writeMap(assetsDir, { size, waterCells, waterTileset = false, shoreMatchers = null }) {
  const mapDir = join(assetsDir, "maps", "test-map");
  writeFile(
    join(mapDir, "map.json"),
    JSON.stringify({
      mapConfig: {
        tileSize: 16,
        dimensions: { width: size, height: size },
        boundingBox: { minX: 0, minY: 0, maxX: size - 1, maxY: size - 1 },
      },
      terrains: [
        { id: GRASS, name: "grass" },
        { id: WATER, name: "water" },
        ...(shoreMatchers
          ? [
            { id: SAND, name: "sand" },
            { id: SHORE, name: "shore", baseTileId: "transition-shore" },
          ]
          : []),
      ],
      // Pairs grass with itself only. Nothing can draw a grass/water boundary.
      tilesets: [
        {
          id: "grass-only",
          filename: "grass-only.png",
          lowerTerrainId: GRASS,
          upperTerrainId: GRASS,
          transitionSize: 0,
        },
        ...(waterTileset
          ? [{
            id: "water-only",
            filename: "water-only.png",
            lowerTerrainId: WATER,
            upperTerrainId: WATER,
            transitionSize: 0,
          }]
          : []),
        ...(shoreMatchers
          ? [{
            id: "shore",
            filename: "shore.png",
            lowerTerrainId: WATER,
            upperTerrainId: SAND,
            transitionSize: 1,
            transitionMatcherTiles: shoreMatchers,
          }]
          : []),
      ],
      overlays: [],
      gameplayAnnotations: { file: "annotations.json" },
    }),
  );
  writeFile(
    join(mapDir, "terrain-map.json"),
    JSON.stringify({
      defaultTerrain: GRASS,
      cells: waterCells.map(([x, y]) => ({ x, y, terrainId: WATER })),
    }),
  );
  writeFile(join(mapDir, "annotations.json"), JSON.stringify({ layers: [] }));
  writeFile(join(mapDir, "objects", "manifest.json"), JSON.stringify({ objects: [] }));
  writeFile(join(mapDir, "tilesets", "grass-only.png"), "");
  if (waterTileset) {
    writeFile(join(mapDir, "tilesets", "water-only.png"), "");
  }
  if (shoreMatchers) {
    writeFile(join(mapDir, "tilesets", "shore.png"), "");
  }
}

function writeCharacter(assetsDir, id) {
  const characterDir = join(assetsDir, "characters", id);
  writeFile(
    join(characterDir, "manifest.json"),
    JSON.stringify({ id, states: [{ folder: "default", directions: ["south"] }] }),
  );
  writeFile(join(characterDir, "default", "rotations", "south.png"), "");
}

/**
 * `renderer` installs this template's real terrainRenderer.ts in the project.
 * Without it the project stands for one created before hard edges, whose
 * renderer still throws where two separate tilesets meet.
 */
function validate({ size, waterCells, waterTileset = false, shoreMatchers = null, renderer = false, offered = false, mapFolder = "test-map", mapFolderLines = null }) {
  const root = mkdtempSync(join(tmpdir(), "validate-map-terrain-"));
  roots.push(root);

  const script = join(root, "website", "scripts", "validate-map-assets.mjs");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(SCRIPT, script);

  writeFile(
    join(root, "website", "src", "pixellab", "templateAssetPaths.ts"),
    [
      ...(mapFolderLines ?? [`export const MAP_FOLDER = "${mapFolder}";`]),
      `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
      "",
    ].join("\n"),
  );
  writeFile(
    join(root, "website", "src", "player", "PlayerController.ts"),
    "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\n"
      + "export const player = PLAYER_CHARACTER_ID;\n",
  );

  if (renderer) {
    const rendererCopy = join(root, "website", "src", "pixellab", "terrainRenderer.ts");
    mkdirSync(dirname(rendererCopy), { recursive: true });
    cpSync(RENDERER, rendererCopy);
  }
  // What the chat session leaves beside an old renderer (offer_current_terrain_renderer.py).
  if (offered) {
    cpSync(RENDERER, join(root, "website", "scripts", "current-terrainRenderer.ts"));
  }

  const assetsDir = join(root, "assets");
  writeMap(assetsDir, { size, waterCells, waterTileset, shoreMatchers });
  writeCharacter(assetsDir, PLAYER_ID);

  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  return { root, script, code: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("unrenderable terrain reporting", () => {
  it("reports how many tiles share one unrenderable combination", () => {
    // A 2x2 block of water inside grass: many tiles touch both terrains, and all
    // of them are the same grass/water defect.
    const { code, output } = validate({
      size: 8,
      waterCells: [
        [3, 3],
        [3, 4],
        [4, 3],
        [4, 4],
      ],
    });

    assert.equal(code, 1, output);
    assert.match(output, /cannot render terrains .*grass.*water.* at \d+ tiles/);
    // The footer, not the per-tile line, is what tells the user how to fix it.
    assert.match(output, /create_topdown_tileset for the pair/);

    // The count must be the real number of affected tiles, not a sample size.
    const [, reported] = output.match(/at (\d+) tiles/);
    assert.ok(
      Number(reported) > 3,
      `a 2x2 water block touches more than 3 tiles, got ${reported}\n${output}`,
    );
  });

  it("names the single tile when only one is affected", () => {
    // Tiles are rendered from their four CORNER terrains, so a painted cell
    // normally spoils the four tiles around it. Only at the far corner of the
    // bounding box do the other three fall outside the scan, leaving exactly one
    // affected tile — the branch that must still read "at tile x,y".
    const { code, output } = validate({ size: 8, waterCells: [[7, 7]] });

    assert.equal(code, 1, output);
    assert.match(output, /cannot render terrains .*grass.*water.* at tile \d+,\d+/);
  });

  it("passes a map whose terrains all have tilesets", () => {
    // Non-vacuous: without water painted anywhere, the same fixture validates.
    const { code, output } = validate({ size: 8, waterCells: [] });

    assert.equal(code, 0, output);
  });
});

describe("terrains from separate tilesets", () => {
  // A 2x2 water block inside grass, where grass and water each have a tileset
  // but no tileset spans the two.
  const block = [
    [3, 3],
    [3, 4],
    [4, 3],
    [4, 4],
  ];

  it("may touch once the project's renderer draws hard edges", () => {
    const { code, output } = validate({
      size: 8, waterCells: block, waterTileset: true, renderer: true,
    });

    assert.equal(code, 0, output);
  });

  it("still fail a project whose renderer predates hard edges", () => {
    // This validator replaces the project's copy every session; the renderer
    // does not. An old renderer throws on these tiles, so the build must too.
    const { code, output } = validate({
      size: 8, waterCells: block, waterTileset: true, renderer: false,
    });

    assert.equal(code, 1, output);
    assert.match(output, /cannot render terrains .*grass.*water/);
    assert.match(output, /create_topdown_tileset for the pair/);
    assert.doesNotMatch(output, /current-terrainRenderer/, "only named once it is there");
  });

  it("names the current renderer the session left, and moving it in passes", () => {
    const { root, script, code, output } = validate({
      size: 8, waterCells: block, waterTileset: true, renderer: false, offered: true,
    });

    assert.equal(code, 1, output);
    assert.match(output, /`mv` it over website\/src\/pixellab\/terrainRenderer.ts/);

    // Following that advice is the whole fix.
    const site = join(root, "website");
    renameSync(
      join(site, "scripts", "current-terrainRenderer.ts"),
      join(site, "src", "pixellab", "terrainRenderer.ts"),
    );
    const after = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(after.status, 0, `${after.stdout}${after.stderr}`);
  });

  it("still fail on a terrain no tileset draws, hard edges or not", () => {
    const { code, output } = validate({
      size: 8, waterCells: block, waterTileset: false, renderer: true,
    });

    assert.equal(code, 1, output);
    assert.match(output, /cannot render terrains .*grass.*water/);
    assert.match(output, /has no tileset at all/);
  });
});

describe("plain tiles from a transition set", () => {
  // The runtime draws a terrain plain from a transition set only through a
  // matcher tile whose centre is all that terrain (transitionFillTileset).
  // Belonging to the set is not enough.
  const W = 255;
  const upperFill = { atlasIndex: 0, pattern: [[W, W, W, W], [W, 1, 1, W], [W, 1, 1, W], [W, W, W, W]] };
  const lowerFill = { atlasIndex: 1, pattern: [[W, W, W, W], [W, 0, 0, W], [W, 0, 0, W], [W, W, W, W]] };
  const block = [
    [3, 3],
    [3, 4],
    [4, 3],
    [4, 4],
  ];

  it("rejects water against grass when the set has no plain water tile", () => {
    const { code, output } = validate({
      size: 8, waterCells: block, shoreMatchers: [upperFill], renderer: true,
    });

    assert.equal(code, 1, output);
    assert.match(output, /cannot render terrains .*grass.*water/);
  });

  it("lets water meet grass with a hard edge once the set has one", () => {
    // Non-vacuous: the same map with a lower fill among the matcher tiles.
    const { code, output } = validate({
      size: 8, waterCells: block, shoreMatchers: [upperFill, lowerFill], renderer: true,
    });

    assert.equal(code, 0, output);
  });
});

describe("the map the game boots into", () => {
  // agent_feedback 2026-10-27: the start map was unlinked from the project, its
  // folder pruned, every check passed, and the deployed game 404'd on map.json.
  it("fails when MAP_FOLDER names a map that is not in assets/maps", () => {
    const { code, output } = validate({ size: 8, waterCells: [], mapFolder: "gone-map" });

    assert.equal(code, 1, output);
    assert.match(output, /assets\/maps\/gone-map\/map\.json — MAP_FOLDER/);
    // It names what the agent can point at instead.
    assert.match(output, /Maps here: test-map/);
    // The generic footer would contradict it: re-syncing cannot bring the map
    // back, and repointing MAP_FOLDER is a code change.
    assert.doesNotMatch(output, /re-sync PixelLab assets/);
    assert.doesNotMatch(output, /Do not work around this in gameplay code/);
  });

  it("follows a constant to the literal it names", () => {
    const { code, output } = validate({
      size: 8,
      waterCells: [],
      mapFolderLines: ['const ACTIVE_MAP = "gone-map";', "export const MAP_FOLDER = ACTIVE_MAP;"],
    });

    assert.equal(code, 1, output);
    assert.match(output, /assets\/maps\/gone-map\/map\.json — MAP_FOLDER/);
  });

  it("does not guess at a value it cannot read", () => {
    // Review 2026-10-27: `"test" + "-map"` was read as "test" and failed a game
    // whose map is right there. An expression is skipped, not misread.
    for (const line of [
      'export const MAP_FOLDER = "test" + "-map";',
      "export const MAP_FOLDER = `${'test'}-map`;",
    ]) {
      const { code, output } = validate({ size: 8, waterCells: [], mapFolderLines: [line] });
      assert.equal(code, 0, `${line}\n${output}`);
    }
  });

  it("passes when MAP_FOLDER names a map that is there", () => {
    const { code, output } = validate({ size: 8, waterCells: [], mapFolder: "test-map" });

    assert.equal(code, 0, output);
  });
});
