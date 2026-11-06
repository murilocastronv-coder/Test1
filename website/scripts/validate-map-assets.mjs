/**
 * Validates PixelLab asset folders before the Phaser build deploys them.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const DEFAULT_ASSETS_DIR = join(import.meta.dirname, "..", "..", "assets");
const SRC_DIR = join(import.meta.dirname, "..", "src");
const TEMPLATE_ASSET_PATHS = join(
  import.meta.dirname,
  "..",
  "src",
  "pixellab",
  "templateAssetPaths.ts",
);
const TERRAIN_RENDERER = join(SRC_DIR, "pixellab", "terrainRenderer.ts");
const CURRENT_TERRAIN_RENDERER = join(import.meta.dirname, "current-terrainRenderer.ts");
const assetsDir = process.argv[2] ?? DEFAULT_ASSETS_DIR;
const mapsDir = join(assetsDir, "maps");
const charactersDir = join(assetsDir, "characters");
const VALID_DIRECTIONS = new Set([
  "south", "south-west", "west", "north-west",
  "north", "north-east", "east", "south-east",
]);
const MAX_TERRAIN_RENDER_ERRORS = 20;
const TERRAIN_FAILURE_EXAMPLE_TILES = 3;
const PHASER_RUNTIME_PATTERNS = [
  /\bnew\s+Phaser\./,
  /\bextends\s+Phaser\./,
  /\bPhaser\.AUTO\b/,
  /\bPhaser\.Input\.Keyboard\.(JustDown|KeyCodes)\b/,
  /\bPhaser\.Loader\.Events\b/,
  /\bPhaser\.Math\.(Vector2|Distance|Clamp|Between|Angle)\b/,
  /\bPhaser\.Scale\./,
];
const PHASER_IMPORT_PATTERN = /\bimport\s+Phaser\s+from\s+["']phaser["'];?/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Whether terrains that no one tileset spans may touch is the project's RENDERER's
// call, not this file's. This validator is replaced in every project at the start
// of each session; terrainRenderer.ts only ever arrives with a new project. A
// renderer that predates hard edges still throws on them, so for that project
// they must keep failing the build instead of the game.
function rendererDrawsHardTerrainEdges() {
  return existsSync(TERRAIN_RENDERER)
    && /^export const DRAWS_HARD_TERRAIN_EDGES = true;/m.test(readFileSync(TERRAIN_RENDERER, "utf8"));
}

function collectTypeScriptFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (entry.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
}

function validatePhaserRuntimeImports(errors) {
  for (const path of collectTypeScriptFiles(SRC_DIR)) {
    const source = readFileSync(path, "utf8");
    const usesPhaserRuntime = PHASER_RUNTIME_PATTERNS.some((pattern) =>
      pattern.test(source),
    );
    if (!usesPhaserRuntime || PHASER_IMPORT_PATTERN.test(source)) {
      continue;
    }

    errors.push(
      `${relative(join(import.meta.dirname, ".."), path)} uses Phaser runtime APIs without import Phaser from "phaser"`,
    );
  }
}

function requireFile(missing, mapId, mapDir, filename) {
  const path = join(mapDir, filename);
  if (!existsSync(path)) {
    missing.push(`assets/maps/${mapId}/${filename}`);
  }
}


function withoutComments(source) {
  // A role name left behind in a comment ("dropped NPC_CHARACTER_ID here") is
  // not a use — otherwise removing a character can never be finished.
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function characterIdExports() {
  const source = withoutComments(readFileSync(TEMPLATE_ASSET_PATHS, "utf8"));

  // Every literal id first, so an alias below can resolve to one. Any
  // SCREAMING_CASE export, not just `*_CHARACTER_ID`, because an alias is free to
  // point at a differently-named constant and only lookups by name read this.
  //
  // Any quote style, and nothing required after the closing one: matching only
  // `= "id";` refused `'id'`, a backtick, `"id" as const` and a trailing comment
  // — all valid TypeScript with the id in plain sight — and the refusal claimed
  // the export was missing while pointing at the line that declares it. Reading
  // MORE shapes can only resolve a role that would otherwise fail loudly; it can
  // never make a used role go unchecked.
  const literals = new Map();
  for (const [, name, id] of source.matchAll(
    /export const ([A-Z0-9_]+)\s*=\s*["'`]([^"'`]+)["'`]/g,
  )) {
    literals.set(name, id);
  }

  // `export const A = B;` — an alias, the obvious way to say "this role reuses
  // that character". Reported 2026-10-05: only quoted literals were matched, so
  // an alias read as an absent export and blocked the deploy. Resolved one hop
  // through literals only, so a chain that never reaches an id still fails
  // loudly rather than silently validating nothing.
  const aliases = new Map();
  for (const [, name, target] of source.matchAll(
    /export const ([A-Z0-9_]*_CHARACTER_ID)\s*=\s*([A-Z0-9_]+)\b/g,
  )) {
    aliases.set(name, target);
  }

  return { literals, aliases };
}

function reachableTypeScriptFiles() {
  // The modules main.ts imports, directly or not: only those are bundled, so a
  // template file nothing imports any more (PlayerController in a terrain-only
  // game) ships nothing and needs none of its characters. Scanning every file
  // demanded four deleted characters from such a project, and this file is
  // reinstalled each session, so the agent's own fix could not stick
  // (agent_feedback 2026-11-04, five turns). Anything this cannot follow (an
  // alias like "@/x", import.meta.glob, an import() of a computed path, another
  // entry in index.html) makes every file count, as before. Imports are read
  // from the raw source: a commented-out one only adds a file, while the
  // comment stripper can eat the rest of a line after "https://".
  const all = collectTypeScriptFiles(SRC_DIR);
  const entry = join(SRC_DIR, "main.ts");
  const html = join(SRC_DIR, "..", "index.html");
  const entries = existsSync(html)
    ? [...readFileSync(html, "utf8").matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1])
    : [];
  if (!existsSync(entry) || entries.some((src) => !/^\.?\/src\/main\.ts$/.test(src))) {
    return all;
  }
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.pop();
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    const code = readFileSync(path, "utf8");
    const dynamicImports = code.match(/\bimport\s*\(/g) ?? [];
    const literalImports = code.match(/\bimport\s*\(\s*(["'])[^"']*\1\s*\)/g) ?? [];
    if (/import\.meta\.glob/.test(code) || dynamicImports.length !== literalImports.length) {
      return all;
    }
    for (const [, spec] of code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
      if (/^[@~#]\/|^\//.test(spec)) {
        return all;
      }
      if (!spec.startsWith(".")) {
        continue;
      }
      const base = join(dirname(path), spec).replace(/\.js$/, "");
      const target = [base, `${base}.ts`, join(base, "index.ts")].find(
        (candidate) => candidate.endsWith(".ts") && existsSync(candidate) && statSync(candidate).isFile(),
      );
      if (target) {
        queue.push(target);
      }
    }
  }
  return all.filter((path) => seen.has(path));
}

function characterIdUses() {
  // Which character roles the game still USES, name -> files using it.
  //
  // templateAssetPaths.ts is excluded deliberately: every export mentions its
  // own name, so counting the declaration as a use would mark every role used
  // forever and make this whole check a no-op.
  const uses = new Map();
  // A role a module defines for itself (`const ELF_CHARACTER_ID = "<id>"`) is
  // as good as an export: it was refused for not being in templateAssetPaths.ts
  // (agent_feedback 2026-11-05 13:30), a rule nothing documented. Names are
  // module-scoped, so one name can hold a different id in each module: every
  // id is kept and checked, never just the last one scanned.
  const localLiterals = new Map();

  for (const path of reachableTypeScriptFiles()) {
    if (path === TEMPLATE_ASSET_PATHS) {
      continue;
    }
    const code = withoutComments(readFileSync(path, "utf8"));
    const relativePath = relative(join(import.meta.dirname, ".."), path);
    for (const [, name, id] of code.matchAll(
      /\bconst ([A-Z0-9_]*_CHARACTER_ID)\s*=\s*["']([0-9a-fA-F-]{36})["']/g,
    )) {
      if (!localLiterals.has(name)) {
        localLiterals.set(name, new Set());
      }
      localLiterals.get(name).add(id);
    }
    for (const [, name] of code.matchAll(/\b([A-Z0-9_]*_CHARACTER_ID)\b/g)) {
      if (!uses.has(name)) {
        uses.set(name, []);
      }
      if (!uses.get(name).includes(relativePath)) {
        uses.get(name).push(relativePath);
      }
    }
  }

  return { uses, localLiterals };
}

function readTemplateCharacterIds(warnings) {
  // The character roles to validate are the ones the project USES, not a fixed
  // list of the four the template shipped with.
  //
  // Reported three times (2026-10-04, 10-05, 10-08): a project that removed its
  // NPCs — deleting the exports and every reference, exactly as asked — was then
  // refused by "Missing NPC_CHARACTER_ID", and a project that kept the dead
  // constants was refused for their absent asset folders. Neither can be fixed
  // from inside the project: the roles were hardcoded here, so NPCs were
  // effectively permanent. One reporter patched this file by hand to get a deploy
  // out.
  //
  // Use-driven instead of list-driven, which is also what makes it non-vacuous:
  // if these patterns ever stop matching the file, the uses remain and resolve to
  // nothing, so validation fails loudly instead of quietly checking zero
  // characters. A role the agent adds later gets the same treatment for free.
  const { literals, aliases } = characterIdExports();
  const { uses, localLiterals } = characterIdUses();

  const ids = [];
  const unresolved = [];
  for (const [name, files] of uses) {
    const exported = literals.get(name) ?? literals.get(aliases.get(name));
    const local = [...(localLiterals.get(name) ?? [])];
    if (exported === undefined && local.length === 0) {
      unresolved.push(
        `${name} is used by ${files.join(", ")} but has no id in ` +
          "website/src/pixellab/templateAssetPaths.ts" +
          (aliases.has(name)
            ? ` (it points at ${aliases.get(name)}, which has no id either)`
            : ""),
      );
      continue;
    }
    ids.push(...(exported === undefined ? [] : [exported]), ...local);
  }

  if (unresolved.length > 0) {
    throw new Error(
      `${unresolved.join("; ")}. Either stop using the role, or give it an id: ` +
        'export const <ROLE>_CHARACTER_ID = "<character id>"; in templateAssetPaths.ts, ' +
        "or the same const in the module that uses it.",
    );
  }

  // Character roles only — `literals` also holds MAP_FOLDER and friends, which
  // are used in ways this never looks for.
  for (const name of [...literals.keys(), ...aliases.keys()]) {
    if (name.endsWith("_CHARACTER_ID") && !uses.has(name)) {
      warnings.push(
        // "no .ts file uses it" stays word for word: projects keep the test that
        // matches it while this file is reinstalled under them every session.
        `${name} is exported but no .ts file uses it that main.ts imports, so its character assets ` +
          "were not checked",
      );
    }
  }

  return [...new Set(ids)];
}

// MAP_FOLDER's value when it can be read with certainty: a complete string
// literal, or a constant naming one. Anything else (concatenation, an
// interpolated template, a call) returns null and is not checked, so a valid
// game is never failed on a guess.
function startMapFolder() {
  const source = withoutComments(readFileSync(TEMPLATE_ASSET_PATHS, "utf8"));
  const valueOf = (name) => {
    const found = source.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([^;\\n]+)`));
    return found ? found[1].trim().replace(/\s+as\s+const$/, "") : null;
  };
  let value = valueOf("MAP_FOLDER");
  if (value && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    value = valueOf(value);
  }
  const literal = value?.match(/^(["'`])([^"'`$\\]+)\1$/);
  return literal ? literal[2] : null;
}

function readReachabilityText() {
  // Everything that can NAME a map folder, because any of them makes it loadable at
  // runtime. TypeScript alone is NOT enough: mapWarps.ts reads targetMapFolder /
  // targetMapId out of annotations.json rect + layer properties, so a door can lead
  // to a map whose id appears in no .ts file anywhere. Scanning source only, a
  // broken warp target was reported as "unreferenced", the build went green, and the
  // game crashed when the player walked through the door.
  const sources = [readFileSync(TEMPLATE_ASSET_PATHS, "utf8")];
  for (const path of collectTypeScriptFiles(SRC_DIR)) {
    sources.push(readFileSync(path, "utf8"));
  }

  const manifestPath = join(assetsDir, "manifest.json");
  if (existsSync(manifestPath)) {
    sources.push(readFileSync(manifestPath, "utf8"));
  }

  for (const entry of readdirSync(mapsDir)) {
    const annotationsPath = join(mapsDir, entry, "annotations.json");
    if (statSync(join(mapsDir, entry)).isDirectory() && existsSync(annotationsPath)) {
      sources.push(readFileSync(annotationsPath, "utf8"));
    }
  }

  return sources.join("\n");
}

function filenamesForMap(mapJson) {
  const filenames = [
    "map.json",
    "terrain-map.json",
    "objects/manifest.json",
  ];

  if (!mapJson.gameplayAnnotations?.file) {
    filenames.push("map.json#gameplayAnnotations.file");
  } else {
    filenames.push(mapJson.gameplayAnnotations.file);
  }

  for (const overlay of mapJson.overlays ?? []) {
    filenames.push(`overlays/${overlay.filename}`);
  }

  for (const tileset of mapJson.tilesets ?? []) {
    filenames.push(`tilesets/${tileset.filename}`);
  }

  return filenames;
}

function terrainName(mapJson, terrainId) {
  const terrain = (mapJson.terrains ?? []).find((candidate) => Number(candidate.id) === terrainId);
  return terrain ? `${terrain.name} (${terrainId})` : `unknown (${terrainId})`;
}

function terrainKey(x, y) {
  return `${x},${y}`;
}

function pairKey(first, second) {
  return `${first}:${second}`;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function tileCorners(terrain, tileX, tileY) {
  return [
    terrain.get(terrainKey(tileX - 1, tileY - 1)) ?? 0,
    terrain.get(terrainKey(tileX, tileY - 1)) ?? 0,
    terrain.get(terrainKey(tileX - 1, tileY)) ?? 0,
    terrain.get(terrainKey(tileX, tileY)) ?? 0,
  ];
}

function transitionTerrainIdsByTileset(mapJson) {
  const transitionTerrainIds = new Map();
  for (const terrain of mapJson.terrains ?? []) {
    const baseTileId = terrain.baseTileId;
    if (typeof baseTileId === "string" && baseTileId.startsWith("transition-")) {
      transitionTerrainIds.set(baseTileId.slice("transition-".length), Number(terrain.id));
    }
  }
  return transitionTerrainIds;
}

function buildTerrainGrid(mapJson, terrainMap) {
  const terrain = new Map();
  const bounds = mapJson.mapConfig.boundingBox;
  const maxVertexX = bounds.minX + mapJson.mapConfig.dimensions.width;
  const maxVertexY = bounds.minY + mapJson.mapConfig.dimensions.height;

  for (let y = bounds.minY; y <= maxVertexY; y += 1) {
    for (let x = bounds.minX; x <= maxVertexX; x += 1) {
      terrain.set(terrainKey(x, y), Number(terrainMap.defaultTerrain));
    }
  }

  for (const cell of terrainMap.cells ?? []) {
    terrain.set(terrainKey(Number(cell.x), Number(cell.y)), Number(cell.terrainId));
  }

  applyTransitionTerrains(terrain, mapJson);
  return terrain;
}

function applyTransitionTerrains(terrain, mapJson) {
  const transitionIds = new Set(transitionTerrainIdsByTileset(mapJson).values());
  if ([...terrain.values()].some((terrainId) => transitionIds.has(terrainId))) {
    return;
  }

  const transitionTerrainIds = transitionTerrainIdsByTileset(mapJson);
  const specs = (mapJson.tilesets ?? [])
    .filter((tileset) => Number(tileset.transitionSize ?? 0) >= 1)
    .flatMap((tileset) => {
      const transitionTerrainId = transitionTerrainIds.get(tileset.id);
      if (transitionTerrainId === undefined) {
        return [];
      }
      return [{
        lowerTerrainId: Number(tileset.lowerTerrainId),
        upperTerrainId: Number(tileset.upperTerrainId),
        transitionTerrainId,
      }];
    });

  const insertions = [];
  const bounds = mapJson.mapConfig.boundingBox;
  const maxVertexX = bounds.minX + mapJson.mapConfig.dimensions.width;
  const maxVertexY = bounds.minY + mapJson.mapConfig.dimensions.height;

  for (let y = bounds.minY; y <= maxVertexY; y += 1) {
    for (let x = bounds.minX; x <= maxVertexX; x += 1) {
      const currentTerrain = terrain.get(terrainKey(x, y)) ?? 0;
      if (currentTerrain === 0) {
        continue;
      }

      const belowY = y + 1;
      const belowTerrain = terrain.get(terrainKey(x, belowY)) ?? 0;
      if (belowTerrain === 0 || belowTerrain === currentTerrain) {
        continue;
      }

      for (const spec of specs) {
        if (currentTerrain !== spec.upperTerrainId || belowTerrain !== spec.lowerTerrainId) {
          continue;
        }

        const aboveTerrain = terrain.get(terrainKey(x, y - 1)) ?? 0;
        if (aboveTerrain === spec.upperTerrainId) {
          insertions.push({ x, y, terrainId: spec.transitionTerrainId });
          break;
        }

        const belowBelowTerrain = terrain.get(terrainKey(x, belowY + 1)) ?? 0;
        if (belowBelowTerrain === spec.lowerTerrainId) {
          insertions.push({ x, y: belowY, terrainId: spec.transitionTerrainId });
          break;
        }
      }
    }
  }

  for (const insertion of insertions) {
    terrain.set(terrainKey(insertion.x, insertion.y), insertion.terrainId);
  }
}

function buildRenderLookups(mapJson, hardEdges) {
  const standardPairs = new Set();
  const standardTerrains = new Set();
  const transitionTerrainIds = transitionTerrainIdsByTileset(mapJson);
  const transitionSpecs = [];

  for (const tileset of mapJson.tilesets ?? []) {
    const lowerTerrainId = Number(tileset.lowerTerrainId);
    const upperTerrainId = Number(tileset.upperTerrainId);
    if (Number(tileset.transitionSize ?? 0) >= 1) {
      const transitionTerrainId = transitionTerrainIds.get(tileset.id);
      if (transitionTerrainId !== undefined) {
        transitionSpecs.push({
          lowerTerrainId,
          upperTerrainId,
          transitionTerrainId,
          fills: transitionFillEncodings(tileset),
        });
      }
      continue;
    }

    standardPairs.add(pairKey(lowerTerrainId, upperTerrainId));
    standardPairs.add(pairKey(upperTerrainId, lowerTerrainId));
    standardTerrains.add(lowerTerrainId);
    standardTerrains.add(upperTerrainId);
  }

  return { standardPairs, standardTerrains, transitionSpecs, hardEdges };
}

// Which of the set's own terrains it has a plain tile for: 0 = lower, 1 = upper.
// Mirrors the runtime's transitionFillTileset, which looks for a matcher tile
// whose centre is all one terrain. Without transitionMatcherTiles the runtime
// uses its built-in patterns, which have both.
function transitionFillEncodings(tileset) {
  if (!tileset.transitionMatcherTiles) {
    return new Set([0, 1]);
  }
  const fills = new Set();
  for (const { pattern } of tileset.transitionMatcherTiles) {
    const centre = [pattern[1][1], pattern[1][2], pattern[2][1], pattern[2][2]];
    if (centre.every((value) => value === centre[0]) && (centre[0] === 0 || centre[0] === 1)) {
      fills.add(centre[0]);
    }
  }
  return fills;
}

function transitionSpecCanRender(terrainIds, spec) {
  return terrainIds.every((terrainId) => (
    terrainId === spec.lowerTerrainId
    || terrainId === spec.upperTerrainId
    || terrainId === spec.transitionTerrainId
  ));
}

function canRenderSingleTerrain(terrainId, lookups) {
  if (lookups.standardTerrains.has(terrainId)) {
    return true;
  }
  return lookups.transitionSpecs.some((spec) => (
    (terrainId === spec.lowerTerrainId && spec.fills.has(0))
    || (terrainId === spec.upperTerrainId && spec.fills.has(1))
  ));
}

function canRenderTerrainCombination(terrainIds, lookups) {
  if (terrainIds.length === 1) {
    return canRenderSingleTerrain(terrainIds[0], lookups);
  }

  if (lookups.transitionSpecs.some((spec) => transitionSpecCanRender(terrainIds, spec))) {
    return true;
  }

  for (let index = 0; index < terrainIds.length - 1; index += 1) {
    if (lookups.standardPairs.has(pairKey(terrainIds[index], terrainIds[index + 1]))) {
      return true;
    }
  }

  // A hard edge: the renderer fills each quarter of the tile from its own
  // terrain's plain tile, so it only needs every terrain to have one.
  return lookups.hardEdges
    && terrainIds.every((terrainId) => canRenderSingleTerrain(terrainId, lookups));
}

function validateMapTerrain(errors, mapId, mapJson, terrainMap, hardEdges) {
  const definedTerrainIds = new Set();
  const duplicateTerrainIds = new Set();

  for (const terrain of mapJson.terrains ?? []) {
    const terrainId = Number(terrain.id);
    if (definedTerrainIds.has(terrainId)) {
      duplicateTerrainIds.add(terrainId);
    }
    definedTerrainIds.add(terrainId);
  }

  for (const terrainId of duplicateTerrainIds) {
    errors.push(`assets/maps/${mapId}/map.json has duplicate terrain id ${terrainId}`);
  }

  const usedTerrainIds = new Set([Number(terrainMap.defaultTerrain)]);
  for (const cell of terrainMap.cells ?? []) {
    usedTerrainIds.add(Number(cell.terrainId));
  }

  for (const terrainId of usedTerrainIds) {
    if (terrainId !== 0 && !definedTerrainIds.has(terrainId)) {
      errors.push(`assets/maps/${mapId}/terrain-map.json uses missing terrain id ${terrainId}`);
    }
  }

  const terrain = buildTerrainGrid(mapJson, terrainMap);
  const lookups = buildRenderLookups(mapJson, hardEdges);
  const bounds = mapJson.mapConfig.boundingBox;
  const maxTileX = bounds.minX + mapJson.mapConfig.dimensions.width - 1;
  const maxTileY = bounds.minY + mapJson.mapConfig.dimensions.height - 1;
  // Counted per terrain COMBINATION, not per tile, and every tile is counted
  // before anything is reported. Reporting just the first tile read as "one bad
  // tile": two users repainted the named tile, re-exported, and got the next
  // tile with the same unrenderable pair, repeatedly (2026-10-05 x2). The pair
  // is the defect — the tile is only where it was noticed first.
  const failures = new Map();

  for (let tileY = bounds.minY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = bounds.minX; tileX <= maxTileX; tileX += 1) {
      const corners = tileCorners(terrain, tileX, tileY);
      if (corners.some((terrainId) => terrainId === 0)) {
        continue;
      }

      const terrainIds = uniqueSorted(corners);
      if (canRenderTerrainCombination(terrainIds, lookups)) {
        continue;
      }

      const failureKey = terrainIds.join(",");
      let failure = failures.get(failureKey);
      if (!failure) {
        if (failures.size >= MAX_TERRAIN_RENDER_ERRORS) {
          continue; // cap distinct combinations, but keep counting the known ones
        }
        failure = { terrainIds, tiles: [], tileCount: 0 };
        failures.set(failureKey, failure);
      }
      failure.tileCount += 1;
      if (failure.tiles.length < TERRAIN_FAILURE_EXAMPLE_TILES) {
        failure.tiles.push(`${tileX},${tileY}`);
      }
    }
  }

  for (const { terrainIds, tiles, tileCount } of failures.values()) {
    const names = terrainIds.map((terrainId) => terrainName(mapJson, terrainId)).join(", ");
    if (tileCount === 1) {
      errors.push(`assets/maps/${mapId} cannot render terrains ${names} at tile ${tiles[0]}`);
      continue;
    }
    // Just the count — the footer below already says how to fix the pair, and
    // the count is the part that was missing: it tells the user this is the
    // whole boundary rather than the one tile that got named.
    const examples = tiles.join(" / ") + (tileCount > tiles.length ? " / …" : "");
    errors.push(
      `assets/maps/${mapId} cannot render terrains ${names} at ${tileCount} tiles (${examples})`,
    );
  }
}

function main() {
  if (!existsSync(mapsDir)) {
    throw new Error(`Missing PixelLab maps directory: ${mapsDir}`);
  }

  const missing = [];
  const unreachable = [];
  const warnings = [];
  let mapCount = 0;

  validatePhaserRuntimeImports(missing);
  const hardEdges = rendererDrawsHardTerrainEdges();

  // A map folder that NOTHING names — not the sources, not another map's warp
  // annotations — cannot be loaded at runtime. Its problems are reported but must
  // NOT fail the build: the exporter leaves old maps in assets/maps/, so one stale
  // map used to block EVERY build in the project, including brand-new maps that
  // were themselves fine (reported by a user 2026-09-02, whose Island Map blocked
  // the map they were actually building). Deliberately conservative — a mention
  // anywhere counts as reachable, so an uncertain map fails the build as before.
  const reachabilityText = readReachabilityText();

  for (const mapId of readdirSync(mapsDir)) {
    const mapDir = join(mapsDir, mapId);
    if (!statSync(mapDir).isDirectory()) {
      continue;
    }

    mapCount += 1;
    const sink = reachabilityText.includes(mapId) ? missing : unreachable;
    const mapJsonPath = join(mapDir, "map.json");
    requireFile(sink, mapId, mapDir, "map.json");
    if (!existsSync(mapJsonPath)) {
      continue;
    }

    const mapJson = readJson(mapJsonPath);
    for (const filename of filenamesForMap(mapJson)) {
      // The ONLY "#" names this loop invents are the `map.json#<field>` pseudo
      // entries above — they describe a missing FIELD, not a file, so they are
      // reported without a disk check. Matching any "#" caught real tilesets too:
      // a filename derived from a terrain description carries its hex colours
      // (e.g. "... #a5754a ...png"), so an asset that exists on disk was reported
      // missing and the build refused to run. Reported via agent_feedback
      // 2026-09-15.
      if (filename.startsWith("map.json#")) {
        sink.push(`assets/maps/${mapId}/${filename}`);
        continue;
      }
      requireFile(sink, mapId, mapDir, filename);
    }

    const terrainMapPath = join(mapDir, "terrain-map.json");
    if (existsSync(terrainMapPath)) {
      validateMapTerrain(sink, mapId, mapJson, readJson(terrainMapPath), hardEdges);
    }
  }

  if (mapCount === 0) {
    throw new Error(`No PixelLab map folders found in ${mapsDir}`);
  }

  // The map the game boots into. Its folder going missing (the map was unlinked
  // from the project, or deleted) left every check above green while the deployed
  // game 404'd on map.json and never became ready (agent_feedback 2026-10-27,
  // three reports): nothing here looked for the folder MAP_FOLDER names.
  const startMap = startMapFolder();
  if (startMap && !existsSync(join(mapsDir, startMap, "map.json"))) {
    const present = readdirSync(mapsDir).filter((entry) =>
      existsSync(join(mapsDir, entry, "map.json")),
    );
    missing.push(
      `assets/maps/${startMap}/map.json — MAP_FOLDER in src/pixellab/templateAssetPaths.ts ` +
        "names this map, but it is not in the project's assets, so the game would 404 on " +
        "boot. Add that map to the project (add_to_project) if it still exists, or point " +
        "MAP_FOLDER at the map the game loads (it is the default for loadPixelLabMap). " +
        `Maps here: ${present.join(", ")}`,
    );
  }

  const characterIds = readTemplateCharacterIds(warnings);

  // Only a problem once some role needs a character. A project with no character
  // roles left has no use for the directory, and used to be refused for not
  // having one. Named here rather than left to N missing-manifest lines, because
  // "the whole export is gone" and "this one character is missing" need different
  // fixes (reported 2026-10-07, a project whose sync lost every character).
  if (characterIds.length > 0 && !existsSync(charactersDir)) {
    missing.push(`assets/characters/ is missing entirely (${charactersDir})`);
  }

  for (const characterId of characterIds) {
    const manifestPath = join(charactersDir, characterId, "manifest.json");
    if (!existsSync(manifestPath)) {
      missing.push(`assets/characters/${characterId}/manifest.json`);
      continue;
    }

    const manifest = readJson(manifestPath);
    if (!Array.isArray(manifest.states) || manifest.states.length === 0) {
      missing.push(`assets/characters/${characterId}/manifest.json: states must be a non-empty array`);
      continue;
    }
    for (const state of manifest.states) {
      if (!state.folder || typeof state.folder !== "string") {
        missing.push(`assets/characters/${characterId}/manifest.json: state missing folder`);
        continue;
      }
      if (!Array.isArray(state.directions) || state.directions.length === 0) {
        missing.push(`assets/characters/${characterId}/manifest.json: state "${state.folder}" has no directions`);
        continue;
      }

      // Validate state directions are valid
      for (const direction of state.directions) {
        if (!VALID_DIRECTIONS.has(direction)) {
          missing.push(`assets/characters/${characterId}/manifest.json: state "${state.folder}" has invalid direction "${direction}"`);
        }
      }

      // Validate rotations exist for each direction
      for (const direction of state.directions) {
        const rotPath = join(charactersDir, characterId, state.folder, "rotations", `${direction}.png`);
        if (!existsSync(rotPath)) {
          missing.push(`assets/characters/${characterId}/${state.folder}/rotations/${direction}.png`);
        }
      }

      if (state.portrait) {
        if (typeof state.portrait.path !== "string") {
          missing.push(`assets/characters/${characterId}/manifest.json: state "${state.folder}" portrait missing path`);
        } else if (!existsSync(join(charactersDir, characterId, state.portrait.path))) {
          missing.push(`assets/characters/${characterId}/${state.portrait.path}`);
        }
      }

      if (state.vocal_animation) {
        if (typeof state.vocal_animation.path !== "string") {
          missing.push(`assets/characters/${characterId}/manifest.json: state "${state.folder}" vocal_animation missing path`);
        } else if (!existsSync(join(charactersDir, characterId, state.vocal_animation.path))) {
          missing.push(`assets/characters/${characterId}/${state.vocal_animation.path}`);
        }
      }

      // Validate every animation frame exists
      for (const anim of state.animations ?? []) {
        if (!anim.name || typeof anim.frame_count !== "number" || anim.frame_count < 1) {
          missing.push(`assets/characters/${characterId}/manifest.json: invalid animation in state "${state.folder}"`);
          continue;
        }
        if (!Array.isArray(anim.directions) || anim.directions.length === 0) {
          missing.push(`assets/characters/${characterId}/manifest.json: animation "${anim.name}" has no directions`);
          continue;
        }
        if (typeof anim.loop !== "boolean") {
          missing.push(`assets/characters/${characterId}/manifest.json: animation "${anim.name}" missing boolean loop field`);
        }
        for (const direction of anim.directions) {
          if (!VALID_DIRECTIONS.has(direction)) {
            missing.push(`assets/characters/${characterId}/manifest.json: animation "${anim.name}" has invalid direction "${direction}"`);
            continue;
          }
          for (let frame = 0; frame < anim.frame_count; frame++) {
            const frameName = `frame_${String(frame).padStart(3, "0")}.png`;
            const framePath = join(
              charactersDir, characterId, state.folder,
              "animations", anim.name, direction, frameName,
            );
            if (!existsSync(framePath)) {
              missing.push(
                `assets/characters/${characterId}/${state.folder}/animations/${anim.name}/${direction}/${frameName}`,
              );
            }
          }
        }
      }
    }
  }

  if (unreachable.length > 0) {
    console.warn(
      "PixelLab asset warnings in map folder(s) nothing references — not blocking the build:",
    );
    for (const filename of unreachable) {
      console.warn(`  - ${filename}`);
    }
    console.warn("These are stale exports: delete the folder, or point MAP_FOLDER / a warp at it and it becomes an error.");
  }

  if (warnings.length > 0) {
    console.warn("PixelLab character roles nothing uses — not blocking the build:");
    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
    console.warn("Delete the export too if the role is gone; use it again and it becomes an error.");
  }

  if (missing.length > 0) {
    console.error("PixelLab asset validation failed. Runtime asset problems:");
    for (const filename of missing) {
      console.error(`  - ${filename}`);
    }
    // The advice has to match what was listed. "Re-sync" was printed after
    // every failure, including a terrain pair with no tileset — which no sync
    // can create — and an agent reported having no repair path for it.
    const terrainGaps = missing.filter((line) => line.includes(" cannot render terrains ")).length;
    if (terrainGaps > 0 && hardEdges) {
      // Terrains from different tilesets meet with a hard edge, so what is left
      // is a terrain no tileset draws at all.
      console.error(
        "`cannot render terrains` is not a sync problem: one of those terrains has no tileset at all. " +
          "Create a tileset that includes it, or repaint with edit_map so it is not used.",
      );
    } else if (terrainGaps > 0) {
      console.error(
        "`cannot render terrains` is not a sync problem: no tileset connects that pair. " +
          "view_map shows each tile. Repaint with edit_map so the two terrains do not touch " +
          "(the only fix where three meet at a corner), or create_topdown_tileset for the pair.",
      );
      // The session puts the current renderer here when this project's predates
      // hard edges (api offer_current_terrain_renderer.py): the one free fix
      // that keeps the map as Map Workshop drew it.
      if (existsSync(CURRENT_TERRAIN_RENDERER)) {
        console.error(
          "Free, and keeps the map as it is: this project's terrain renderer predates hard edges. " +
            "The current one is at website/scripts/current-terrainRenderer.ts — " +
            "`mv` it over website/src/pixellab/terrainRenderer.ts (`diff` the two first if this project changed its renderer; " +
            "if tsc then flags a caller, the project predates 2026-05-11: adapt it) " +
            "and pairs that no tileset connects draw as a hard edge.",
        );
      }
    }
    // The start-map line carries its own fix (link the map or repoint
    // MAP_FOLDER, which IS gameplay code), so the generic advice skips it.
    const startMapGaps = missing.filter((line) => line.includes("— MAP_FOLDER")).length;
    if (terrainGaps + startMapGaps < missing.length) {
      console.error("For the missing files: re-sync PixelLab assets before building.");
    }
    if (startMapGaps < missing.length) {
      console.error("Do not work around this in gameplay code.");
    }
    process.exit(1);
  }

  console.log(`Validated ${mapCount} PixelLab map asset folder(s) and ${characterIds.length} character asset folder(s)`);
}

try {
  main();
} catch (error) {
  console.error("PixelLab asset validation failed:", error);
  process.exit(1);
}
