/**
 * Add grounded collision footprints to copied PixelLab object manifests.
 *
 * The export API writes the same field. This build-time pass keeps older exports
 * compatible so the first asset sync cannot regress object collision.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import pngjs from "pngjs";

const { PNG } = pngjs;
const OBJECT_GROUND_HEIGHT_RATIO = 0.25;
const OBJECT_ALPHA_THRESHOLD = 128;
const DEFAULT_ASSETS_DIR = join(import.meta.dirname, "..", "public", "assets");

export function objectGroundBounds(image, boundingBox) {
  let opaqueTop = image.height;
  let opaqueBottom = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < OBJECT_ALPHA_THRESHOLD) {
        continue;
      }
      opaqueTop = Math.min(opaqueTop, y);
      opaqueBottom = Math.max(opaqueBottom, y + 1);
    }
  }

  if (opaqueBottom === 0) {
    return {
      x: Number(boundingBox.x),
      y: Number(boundingBox.y) + Number(boundingBox.height) * (1 - OBJECT_GROUND_HEIGHT_RATIO),
      width: Number(boundingBox.width),
      height: Number(boundingBox.height) * OBJECT_GROUND_HEIGHT_RATIO,
    };
  }

  const groundHeight = Math.max(1, Math.floor(image.height * OBJECT_GROUND_HEIGHT_RATIO + 0.5));
  const groundTop = Math.max(opaqueTop, opaqueBottom - groundHeight);
  let groundLeft = image.width;
  let groundRight = 0;

  for (let y = groundTop; y < opaqueBottom; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < OBJECT_ALPHA_THRESHOLD) {
        continue;
      }
      groundLeft = Math.min(groundLeft, x);
      groundRight = Math.max(groundRight, x + 1);
    }
  }

  const scaleX = Number(boundingBox.width) / image.width;
  const scaleY = Number(boundingBox.height) / image.height;
  return {
    x: Number(boundingBox.x) + groundLeft * scaleX,
    y: Number(boundingBox.y) + groundTop * scaleY,
    width: (groundRight - groundLeft) * scaleX,
    height: (opaqueBottom - groundTop) * scaleY,
  };
}

export function addObjectGroundBounds(assetsDir) {
  const mapsDir = join(assetsDir, "maps");
  if (!existsSync(mapsDir)) {
    return 0;
  }

  let updated = 0;
  for (const mapFolder of readdirSync(mapsDir, { withFileTypes: true })) {
    if (!mapFolder.isDirectory()) {
      continue;
    }
    const objectsDir = join(mapsDir, mapFolder.name, "objects");
    const manifestPath = join(objectsDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const object of manifest.objects) {
      const image = PNG.sync.read(readFileSync(join(objectsDir, object.filename)));
      object.groundBounds = objectGroundBounds(image, object.boundingBox);
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    updated += manifest.objects.length;
  }
  return updated;
}

if (process.argv[1] === import.meta.filename) {
  const assetsDir = process.argv[2] ?? DEFAULT_ASSETS_DIR;
  console.log(`Added grounded collision bounds to ${addObjectGroundBounds(assetsDir)} placed objects`);
}
