/**
 * Packs individual image files into texture atlases for Phaser.
 *
 * Scans assets/ for:
 *   - characters/{id}/**\/*.png → one atlas per character
 *   - maps/{id}/objects/*.png   → one atlas per map's objects
 *
 * Outputs Phaser3-compatible JSON + PNG into public/atlases/.
 * Frame names preserve the relative path (e.g. "walk/south/frame_000").
 *
 * Each atlas is repacked only when its own images (or this script) change: its
 * `.{name}.hash` is written after its files, so a build killed mid-pack keeps
 * every atlas it finished. Repacking all of them on any change took a project
 * with ~14k synced frames past the deploy limit every time (2026-10-31).
 */

import { packAsync } from "free-tex-packer-core";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

const ASSETS_DIR = join(import.meta.dirname, "..", "..", "assets");
const OUT_DIR = join(import.meta.dirname, "..", "public", "atlases");
const PACKER_SOURCE = readFileSync(import.meta.filename);

const PACK_OPTIONS = {
  textureName: "atlas",
  width: 2048,
  height: 2048,
  padding: 1,
  allowRotation: false,
  allowTrim: false,
  detectIdentical: true,
  exporter: "Phaser3",
  removeFileExtension: true,
  prependFolderName: true,
};

const MAX_PAGE_SIDE = 4096;

function collectPngs(dir, shouldInclude = () => true) {
  const files = [];
  if (!existsSync(dir)) return files;

  function walk(current) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (extname(entry).toLowerCase() === ".png") {
        const path = relative(dir, full);
        if (!shouldInclude(path)) continue;
        files.push({
          path,
          contents: readFileSync(full),
        });
      }
    }
  }

  walk(dir);
  return files;
}

function imagesHash(images) {
  const hash = createHash("sha1").update(PACKER_SOURCE);
  for (const image of [...images].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(image.path).update("\0").update(image.contents);
  }
  return hash.digest("hex");
}

/** Returns true when it packed, false when the atlas on disk was already current. */
async function packAndWrite(name, images) {
  const hashPath = join(OUT_DIR, `.${name}.hash`);
  const hash = imagesHash(images);
  if (
    existsSync(hashPath) && readFileSync(hashPath, "utf8") === hash &&
    existsSync(join(OUT_DIR, `${name}.json`)) && existsSync(join(OUT_DIR, `${name}.png`))
  ) {
    return false;
  }
  rmSync(hashPath, { force: true });

  // 2048 first, so every atlas that fits keeps today's page; 4096 only for one
  // that cannot. A 256px character with 136 frames needs ~8.9M px against 4.2M
  // and blocked every deploy (agent_feedback 2026-11-03 14:44). Packing every
  // atlas at 4096 instead grew a 1950x1950 one to 4030x4030, past what old
  // phones load. A page over 2048 can still fail on such a phone.
  const single = (files) => files.length === 2 && files.every((f) => [`${name}.json`, `${name}.png`].includes(f.name));
  let results;
  for (const side of [PACK_OPTIONS.width, MAX_PAGE_SIDE]) {
    results = await packAsync(images, { ...PACK_OPTIONS, width: side, height: side, textureName: name });
    if (single(results)) break;
  }

  // Exactly one atlas page. Overflowing the page makes the packer emit `{name}-0.json`,
  // `{name}-1.json`, … while the game loads exactly `atlases/{name}.json` — the build would pass
  // and the deployed game would die at runtime with a cryptic "Unexpected token '<'" (the SPA
  // fallback HTML served for the missing JSON). Fail HERE, loudly, with the fix.
  if (!single(results)) {
    throw new Error(
      `Atlas "${name}" no longer fits a single ${MAX_PAGE_SIDE}x${MAX_PAGE_SIDE} page ` +
      `(packer emitted: ${results.map((f) => f.name).join(", ")}). ` +
      `Multi-page atlases are not loadable by the game. If the game doesn't use this asset, ` +
      `remove_from_project unlinks it and the next sync drops its folder; otherwise delete ` +
      `animations it doesn't need (delete_animation). Don't resize the frames: that breaks the pixel grid.`,
    );
  }

  for (const file of results) {
    const outPath = join(OUT_DIR, file.name);
    writeFileSync(outPath, file.buffer);
  }

  writeFileSync(hashPath, hash);
  console.log(`  ${name}: ${images.length} images → ${results.length} files`);
  return true;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  let totalImages = 0;
  let totalAtlases = 0;
  let packed = 0;
  const current = new Set();

  // Pack each character into its own atlas
  const charsDir = join(ASSETS_DIR, "characters");
  if (existsSync(charsDir)) {
    for (const charId of readdirSync(charsDir)) {
      const charDir = join(charsDir, charId);
      if (!statSync(charDir).isDirectory()) continue;
      const images = collectPngs(charDir, (path) => (
        !path.endsWith("/portrait.png") && !path.endsWith("/vocal/grid.png")
      ));
      if (images.length > 0) {
        current.add(`char-${charId}`);
        if (await packAndWrite(`char-${charId}`, images)) packed++;
        totalImages += images.length;
        totalAtlases++;
      }
    }
  }

  // Pack each map's objects into one atlas
  const mapsDir = join(ASSETS_DIR, "maps");
  if (existsSync(mapsDir)) {
    for (const mapId of readdirSync(mapsDir)) {
      const objectsDir = join(mapsDir, mapId, "objects");
      const images = collectPngs(objectsDir);
      if (images.length > 0) {
        current.add(`map-objects-${mapId}`);
        if (await packAndWrite(`map-objects-${mapId}`, images)) packed++;
        totalImages += images.length;
        totalAtlases++;
      }
    }
  }

  // Atlases of art that left the project: the game must not find them.
  for (const file of readdirSync(OUT_DIR)) {
    const name = file.replace(/^\./, "").replace(/\.(json|png|hash)$/, "");
    if (name !== file && !current.has(name)) rmSync(join(OUT_DIR, file), { force: true });
  }

  console.log(
    `Packed ${totalImages} images into ${totalAtlases} atlases ` +
    `(${packed} repacked, ${totalAtlases - packed} unchanged)`,
  );
}

main().catch((err) => {
  console.error("Atlas packing failed:", err);
  process.exit(1);
});
