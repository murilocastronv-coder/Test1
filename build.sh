#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

file_md5() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$1" | cut -d' ' -f1
  else
    md5 -q "$1"
  fi
}

echo "=== Building PixelLab Phaser Top-Down ==="

echo "[1/7] Validating PixelLab maps and characters..."
node website/scripts/validate-map-assets.mjs

echo "[2/7] Copying PixelLab assets..."
rm -rf website/public/assets
mkdir -p website/public
cp -R assets website/public/assets

echo "[3/7] Installing dependencies..."
cd website
# Skip npm ci if node_modules matches package-lock.json AND binaries exist
LOCK_HASH=$(file_md5 package-lock.json)
CACHED_HASH=""
[ -f node_modules/.lock-hash ] && CACHED_HASH=$(cat node_modules/.lock-hash)
if [ "$LOCK_HASH" = "$CACHED_HASH" ] && [ -d node_modules ] && [ -x node_modules/.bin/tsc ] && [ -x node_modules/.bin/vite ]; then
  echo "  (cached — skipping npm ci)"
else
  # Use pre-baked node_modules from the session image if available (avoids network).
  # The image bakes deps at /opt/template-node-modules/ so gVisor DNS flakiness
  # (EAI_AGAIN on registry.npmjs.org) can't break builds.
  # Only copy if the baked lock hash matches the project's — prevents wrong versions.
  BAKED_HASH=""
  [ -f /opt/template-node-modules/node_modules/.lock-hash ] && BAKED_HASH=$(cat /opt/template-node-modules/node_modules/.lock-hash)
  if [ -d /opt/template-node-modules/node_modules ] && [ "$LOCK_HASH" = "$BAKED_HASH" ]; then
    echo "  (copying pre-baked node_modules from image)"
    rm -rf node_modules
    cp -a /opt/template-node-modules/node_modules .
  elif [ -f package-lock.json ]; then
    npm ci --silent
  else
    npm install --silent
  fi
  # Verify binaries exist — npm can exit 0 with incomplete install (npm 10.x bug)
  if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/vite ]; then
    echo "ERROR: node_modules/.bin/tsc or vite not found after install. Dependencies are incomplete." >&2
    echo "If running in gVisor sandbox, the session image may need rebuilding." >&2
    exit 1
  fi
  echo "$LOCK_HASH" > node_modules/.lock-hash
fi

echo "[4/7] Adding grounded object collision bounds..."
node scripts/add-object-ground-bounds.mjs

echo "[5/7] Type-checking..."
./node_modules/.bin/tsc --noEmit

echo "[6/7] Packing texture atlases..."
# The packer skips every atlas whose images are unchanged and keeps the ones it
# finished if the build is cut short; rm -rf website/public/atlases forces a
# full repack.
node scripts/pack-atlases.mjs

echo "[7/7] Building website..."
export VITE_PIXELLAB_BUILD_ID="${VITE_PIXELLAB_BUILD_ID:-$(date +%s)}"
# Skip redundant tsc — step 4 already type-checked. Run vite directly.
./node_modules/.bin/vite build

echo "=== Build complete: $SCRIPT_DIR/website/out ==="
