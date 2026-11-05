# Phaser 4 Skill

Use this skill when editing the Phaser top-down template in PixelLab `/chat`.

## Workflow
- Work in `website/src/`.
- Keep `build.sh` output as `website/out`.
- Run `npm run build` from `website/` or `./build.sh` from the project root after code changes.
- Use PixelLab exported assets from `/assets/...` at runtime; do not download assets manually.
- Keep `VITE_PIXELLAB_BUILD_ID` cache busting intact in root `build.sh` and `pixellab/templateAssetPaths.ts`, so stable PixelLab asset URLs refresh after every deploy.

## Patterns
- Create one Phaser Scene for runtime work unless the task explicitly asks for menus or multiple zones.
- Keep logic in focused TypeScript modules.
- Use `setDepth(y)` for top-down sprite/object sorting.
- Use `shared/collision.ts` for movement blocking; it supports authored collision masks and terrain walkability fallback from PixelLab map exports.
- Use `shared/animation.ts` for character frame loading and 8-direction animation. Do not hand-roll another animation loop in a scene.
- Use `pixellab/terrainRenderer.ts` for map terrain. It renders `terrain-map.json` with exported Wang tilesets and must stay separate from `map-composite.png`.
- Use `pixellab/renderMap.ts` for terrain/object/overlay scene construction. There is no `MapRenderer.ts` file in this template.
- Use `pixellab/spawns.ts` for player, NPC, farmer, and bear spawn lookup from exported `annotations.json`. Do not duplicate spawn parsing in scenes.
- Use DOM HUD for scores/objectives because it is easier for agents to update and visually test.
- Keep player changes in `player/PlayerController.ts`; keep NPC/farmer/bear behavior in `npc/CharacterAgent.ts` and `npc/spawnNpcs.ts`.

## Object Interactions
- For `@object ... [id:...]`, use `assets/objects/{id}/` directly; `assets/manifest.json` may not exist.
- List the referenced object folder once to choose the sprite filename, then edit code.
- Use the current map `objects/manifest.json` for placed object bounds instead of hand-placing objects.
- For chest/opened-sprite behavior, add proximity + interact-key logic in `GameScene.ts` or a focused imported module, preload the replacement sprite with `assetUrl("objects", objectId, filename)`, then switch/overlay the visual.
- Do not keep rereading `BootScene.ts`, `renderMap.ts`, or map JSON after the object id and relevant runtime file are known.

## PixelLab Map Rules
- Switch maps by updating `MAP_FOLDER` in `website/src/pixellab/templateAssetPaths.ts`.
- Read `assets/manifest.json` when it exists and you need name lookup.
- If the user provided an explicit `@map ... [id:...]`, go directly to `assets/maps/{id}/` when `assets/manifest.json` is missing.
- Read `assets/maps/{id}/map.json`, `annotations.json` if referenced by `map.json.gameplayAnnotations.file`, and `objects/manifest.json` before changing map setup.
- A normal PixelLab map swap should usually only change `MAP_FOLDER`; do not rewrite terrain rendering or build a custom tilemap unless the runtime is actually missing export support.
- For multi-map gameplay or warps, use `loadPixelLabMap(targetMapId)` and keep using that returned `LoadedMap`. Its `folder` field must drive tileset, overlay, and object texture keys.
- Do not create procedural tile grids, green debug maps, placeholder tile arrays, or hand-placed object layouts when the requested map exists under `assets/maps/`.
- Read `terrain-map.json`, `transition-map.json`, and `transition-rules.json` only when debugging terrain rendering, collision semantics, or transition logic.
- For `transitionSize = 1` tilesets, resolve the synthetic transition terrain via `map.json.terrains[].baseTileId == "transition-{tilesetId}"`.
- Spawn roles are matched by NAME: a point/layer's `name`, `tags`, or label properties (`areaName`, `spawnName`, `targetSpawnName`) containing the role word (`player`, `npc`, `farmer` / `farmer_girl`, `bear`), with `TEMPLATE_SPAWNS` as the default-map fallback. There is no `spawnType` property — see `pixellab/spawns.ts`.
- Annotation collision is inferred from layer names/tags/terrain names: names like `water`, `wall`, `blocked`, `non-walkable`, `lava`, and `cliff` block; names like `grass`, `ground`, `walkable`, `path`, `road`, and `floor` allow. There is no `collisionMode` property — see `pixellab/collision.ts`.
- Do not hard-code one exact layer name; keep collision inference centralized in `website/src/pixellab/collision.ts`.
- For every map swap, authored `annotations.json` collision should work immediately. `map.json.walkableTerrainIds` is only a fallback when collision annotations are absent.
- Phaser uses PixelLab export coordinates directly. Do not apply Bevy center-origin/Y-up conversion.
- Terrain uses dual-grid sampling: rendered tile `(x, y)` samples `(x-1,y-1)`, `(x,y-1)`, `(x-1,y)`, `(x,y)`.
- Objects, overlays, spawns, and collision rects use raw exported world pixels. Do not add or subtract `tileSize / 2` for new maps.
- If a new map looks offset, inspect terrain sampling, `LoadedMap.folder` texture keys, and preload order before touching exported object/overlay/collision coordinates.
- Treat `terrain-map.json` as layout-only. Collision comes from `annotations.json` or the `map.json.walkableTerrainIds` fallback.

## Avoid
- Do not add Bevy, Rust, Cargo, wasm-bindgen, or WASM build steps.
- Do not rewrite PixelLab export JSON.
- Do not hard-code current template IDs outside `templateAssetPaths.ts`.
- Do not use `map-composite.png` for playable terrain. It is a reference image, not the runtime map.
- Do not render a target map before calling `preloadMapAssets(scene, targetMapData)`. Green/black diagonal tiles are usually Phaser missing-texture placeholders.
