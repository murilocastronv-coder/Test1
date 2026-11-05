# Game Assets

This template no longer keeps demo maps or character sprites in git.

At project creation time the API:

1. clones the shared template map, characters, and tilesets into the target user
2. patches the template source with the cloned UUIDs
3. syncs the cloned assets into `assets/` before the game is built

The resulting workspace layout is:

```text
assets/
  characters/<uuid>/
  images/<id>/
  maps/<uuid>/
  rooms/<uuid>/
  tilesets/<uuid>/
```

The Phaser template loads those project-specific UUID paths through
`website/src/pixellab/templateAssetPaths.ts` and `assetUrl(...)`.

For map swaps, update `MAP_FOLDER` in `templateAssetPaths.ts` and keep the
exported map files read-only. Spawn and collision data should come from the
exported `annotations.json` when `map.json.gameplayAnnotations.file` exists.
Each map folder must include the Phaser runtime files validated by `build.sh`:
`map.json`, `terrain-map.json`, `objects/manifest.json`, and the referenced
annotation, overlay, and tileset files.

Each character ID referenced by `templateAssetPaths.ts` must also have its
runtime files under `assets/characters/<uuid>/<stateFolder>/`. Still poses live
under `rotations/`, and animated clips live under `animations/<clip>/`. If those
files are missing, fix asset sync; do not swap the runtime back to template
placeholders. Character manifests may expose short animation `aliases` such as
`walk` or `run`; use those aliases in runtime code instead of long custom clip
folder names.

Creator and imported project images sync under `assets/images/<id>/`. Each
folder contains `image.png` and `metadata.json`; spritesheet-style creator images
also include numbered PNG frames in `frames/`. Use `projectImageUrl(id)` and
`projectImageFrameUrl(id, frameIndex)` from `templateAssetPaths.ts` instead of
hardcoding relative paths.

Rooms (`create_room`) used in the project sync under `assets/rooms/<id>/`:
`room.png` and `metadata.json` (name, view, size, layout and, for top-down rooms,
each door's join `anchor`, `trigger` and `arrive`, and the `walkable` rects, all in
picture px). Load them with `projectRoomUrl(id)` / `projectRoomUrl(id, "metadata.json")`;
set joined rooms with the anchors and run them with `pixellab/roomCamera.ts` (doors,
fades, one room at a time, zoomed to fit).
