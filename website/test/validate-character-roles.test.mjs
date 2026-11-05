/**
 * The asset validator must check the character roles the game USES, not the
 * fixed set the template shipped with.
 *
 * Reported three times (2026-10-04, 10-05, 10-08): a project that removed its
 * NPCs was refused by "Missing NPC_CHARACTER_ID" even after deleting every
 * reference, so the template's NPCs could never actually be removed. One
 * reporter hand-patched the validator to get a deploy out.
 *
 * Driven through the real script with spawnSync, because build.sh runs exactly
 * that and the exit code is the whole contract.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

const SCRIPT = join(
  import.meta.dirname,
  "..",
  "scripts",
  "validate-map-assets.mjs",
);
const MAP_FOLDER_EXPORT = 'export const MAP_FOLDER = "test-map";';
const PLAYER_ID = "player-character";
const NPC_ID = "npc-character";
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

function writeMap(assetsDir) {
  // One tile of terrain 0, which the renderability check skips — this fixture is
  // about characters, and a map has to exist or the validator refuses outright.
  const mapDir = join(assetsDir, "maps", "test-map");
  writeFile(
    join(mapDir, "map.json"),
    JSON.stringify({
      mapConfig: {
        tileSize: 16,
        dimensions: { width: 1, height: 1 },
        boundingBox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      },
      terrains: [],
      tilesets: [],
      overlays: [],
      gameplayAnnotations: { file: "annotations.json" },
    }),
  );
  writeFile(
    join(mapDir, "terrain-map.json"),
    JSON.stringify({ defaultTerrain: 0, cells: [] }),
  );
  writeFile(join(mapDir, "annotations.json"), JSON.stringify({ layers: [] }));
  writeFile(join(mapDir, "objects", "manifest.json"), JSON.stringify({ objects: [] }));
}

function writeCharacter(assetsDir, id) {
  const characterDir = join(assetsDir, "characters", id);
  writeFile(
    join(characterDir, "manifest.json"),
    JSON.stringify({ id, states: [{ folder: "default", directions: ["south"] }] }),
  );
  writeFile(join(characterDir, "default", "rotations", "south.png"), "");
}

/** Build a throwaway project and run the validator in it. */
function validate({ assetPaths, src = {}, characters = [] }) {
  const root = mkdtempSync(join(tmpdir(), "validate-character-roles-"));
  roots.push(root);

  const script = join(root, "website", "scripts", "validate-map-assets.mjs");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(SCRIPT, script);

  writeFile(
    join(root, "website", "src", "pixellab", "templateAssetPaths.ts"),
    `${MAP_FOLDER_EXPORT}\n${assetPaths}\n`,
  );
  for (const [name, contents] of Object.entries(src)) {
    writeFile(join(root, "website", "src", name), contents);
  }

  const assetsDir = join(root, "assets");
  writeMap(assetsDir);
  for (const id of characters) {
    writeCharacter(assetsDir, id);
  }

  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

const BOTH_ROLES = [
  `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
  `export const NPC_CHARACTER_ID = "${NPC_ID}";`,
].join("\n");

describe("character roles the project uses", () => {
  it("validates every role the game still references", () => {
    const { code, output } = validate({
      assetPaths: BOTH_ROLES,
      src: {
        "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
        "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID, NPC_ID],
    });

    assert.equal(code, 0, output);
    assert.match(output, /2 character asset folder/);
  });

  it("lets a project that removed its NPCs build", () => {
    // The reported case: export gone, user gone, assets gone. Used to fail with
    // "Missing NPC_CHARACTER_ID" and no way to fix it from inside the project.
    const { code, output } = validate({
      assetPaths: `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
      src: {
        "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 0, output);
    // Non-vacuous: the player is still checked, so this is not "validated nothing".
    assert.match(output, /1 character asset folder/);
  });

  it("does not demand assets for a dead constant nothing uses", () => {
    // The other half of the report: the export was left in place after the NPC
    // assets were unlinked, and the missing manifest blocked the build.
    const { code, output } = validate({
      assetPaths: BOTH_ROLES,
      src: {
        "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 0, output);
    assert.match(output, /1 character asset folder/);
    assert.match(output, /NPC_CHARACTER_ID is exported but nothing main\.ts imports uses it/);
  });

  it("ignores template modules main.ts no longer imports", () => {
    // agent_feedback 2026-11-04, five turns: a terrain-only game whose main.ts
    // starts WorldMapScene alone was refused for the four deleted template
    // characters that only the now-unimported PlayerController/spawnNpcs used.
    const { code, output } = validate({
      assetPaths: BOTH_ROLES,
      src: {
        "main.ts": "import { WorldMapScene } from './scenes/WorldMapScene';\nnew WorldMapScene();\n",
        "scenes/WorldMapScene.ts": "import { MAP_FOLDER } from '../pixellab/templateAssetPaths';\nexport class WorldMapScene { map = MAP_FOLDER; }\n",
        "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
        "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [],
    });

    assert.equal(code, 0, output);
    assert.match(output, /0 character asset folder/);
  });

  it("still fails for a role a module main.ts reaches uses", () => {
    const { code, output } = validate({
      assetPaths: BOTH_ROLES,
      src: {
        "main.ts": "import './scenes/GameScene';\n",
        "scenes/GameScene.ts": "export * from '../npc/spawnNpcs';\n",
        "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [],
    });

    assert.equal(code, 1, output);
    assert.match(output, new RegExp(`assets/characters/${NPC_ID}`));
  });

  it("counts every file when main.ts loads modules by glob", () => {
    const { code, output } = validate({
      assetPaths: BOTH_ROLES,
      src: {
        "main.ts": "const scenes = import.meta.glob('./scenes/*.ts');\n",
        "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [],
    });

    assert.equal(code, 1, output);
  });

  for (const [label, main] of [
    // codex review: each of these hid a reachable NPC and passed
    ["an import after a URL string", "console.log('https://example.com'); import './npc/spawnNpcs';\n"],
    ["an aliased import", "import '@/npc/spawnNpcs';\n"],
    ["an import() of a built path", "import('./npc/' + 'spawnNpcs');\n"],
  ]) {
    it(`still checks the roles behind ${label}`, () => {
      const { code } = validate({
        assetPaths: BOTH_ROLES,
        src: {
          "main.ts": main,
          "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
        },
        characters: [],
      });
      assert.equal(code, 1);
    });
  }

  it("still fails when a role the game uses has no assets", () => {
    // The negative that matters: this is the whole point of the validator, and a
    // runtime 404 on the player sprite must not become a warning.
    const { code, output } = validate({
      assetPaths: BOTH_ROLES,
      src: {
        "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [],
    });

    assert.equal(code, 1, output);
    assert.match(output, new RegExp(`assets/characters/${NPC_ID}`));
  });

  it("fails loudly when a used role has no id, rather than checking nothing", () => {
    // What a broken export pattern would look like from the inside. Uses drive
    // the requirement, so this can never degrade into a silent pass.
    const { code, output } = validate({
      assetPaths: `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
      src: {
        "npc/spawnNpcs.ts": "export const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 1, output);
    assert.match(output, /NPC_CHARACTER_ID is used by src\/npc\/spawnNpcs\.ts/);
    assert.match(output, /has no id in/);
  });

  it("resolves a role aliased to another character", () => {
    const { code, output } = validate({
      assetPaths: [
        `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
        "export const NPC_CHARACTER_ID = PLAYER_CHARACTER_ID;",
      ].join("\n"),
      src: {
        "npc/spawnNpcs.ts": "import { NPC_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const npc = NPC_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 0, output);
    assert.match(output, /1 character asset folder/);
  });

  it("resolves an alias pointing at a differently named constant", () => {
    // An alias target need not itself be a `*_CHARACTER_ID`, so resolution reads
    // every SCREAMING_CASE literal rather than only the role-shaped ones.
    const { code, output } = validate({
      assetPaths: [
        `export const HERO = "${PLAYER_ID}";`,
        "export const PLAYER_CHARACTER_ID = HERO;",
      ].join("\n"),
      src: {
        "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 0, output);
    assert.match(output, /1 character asset folder/);
  });

  it("does not warn about exports that are not character roles", () => {
    // MAP_FOLDER is read by the map loader, which this scan never looks at —
    // reporting it as unused would be noise on every single build.
    const { code, output } = validate({
      assetPaths: `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
      src: {
        "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 0, output);
    assert.doesNotMatch(output, /MAP_FOLDER/);
  });

  it("reads an id written in any quote style, with or without a semicolon", () => {
    // All valid TypeScript, and all of it used to fail with "has no id in
    // templateAssetPaths.ts" while pointing at the line declaring the id.
    for (const declaration of [
      `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
      `export const PLAYER_CHARACTER_ID = '${PLAYER_ID}';`,
      `export const PLAYER_CHARACTER_ID = \`${PLAYER_ID}\`;`,
      `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}" as const;`,
      `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}"`,
      `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}"; // the hero`,
      `export const PLAYER_CHARACTER_ID =\n  "${PLAYER_ID}";`,
    ]) {
      const { code, output } = validate({
        assetPaths: declaration,
        src: {
          "player/PlayerController.ts": "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';\nexport const player = PLAYER_CHARACTER_ID;\n",
        },
        characters: [PLAYER_ID],
      });

      assert.equal(code, 0, `${declaration}\n${output}`);
      assert.match(output, /1 character asset folder/);
    }
  });

  it("does not count a role named only in a comment as a use", () => {
    const { code, output } = validate({
      assetPaths: `export const PLAYER_CHARACTER_ID = "${PLAYER_ID}";`,
      src: {
        "player/PlayerController.ts": [
          "import { PLAYER_CHARACTER_ID } from '../pixellab/templateAssetPaths';",
          "// the old NPC_CHARACTER_ID spawner lived here",
          "/* BEAR_CHARACTER_ID too */",
          "export const player = PLAYER_CHARACTER_ID;",
        ].join("\n"),
      },
      characters: [PLAYER_ID],
    });

    assert.equal(code, 0, output);
    assert.match(output, /1 character asset folder/);
  });

  it("builds a project with no character roles and no characters directory", () => {
    // Removing the LAST character used to be refused by "Missing PixelLab
    // characters directory" before any role was even looked at.
    const { code, output } = validate({ assetPaths: "", src: {}, characters: [] });

    assert.equal(code, 0, output);
    assert.match(output, /0 character asset folder/);
  });
});
