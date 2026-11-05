# Phaser Top-Down Template

A Phaser 4 + TypeScript + Vite top-down game for PixelLab `/chat`. It's a working game, not a frame to fill in — the fastest path to most features is a new module under `website/src/gameplay/` wired into the existing scaffolding.

**These are guidelines, not rules.** Everything below is something that cost someone real time; the reason is stated so you can tell when it applies and when it doesn't. It's your project — if a task genuinely needs a different shape, take it, and update this file with what you learned.

## Where the detail lives
Each `website/src/` subfolder has its own `AGENTS.md` with the real contract — worth reading before working in that area (they're all in the project file tree):
- `pixellab/` — the runtime layer that turns PixelLab's exported maps/assets into the running game: map loading, terrain rendering, collision, spawns, warps, coordinates, and projected (iso/oblique/hex) tile-layer maps. The export formats are fiddly and the helpers already handle them, so parsing `map.json`/`annotations.json` in a scene usually means re-deriving a solved problem (dual-grid sampling, transition tiles, warp rects). Full map contract in `pixellab/AGENTS.md`.
- `player/` — player movement, spawn relocation, character swaps.
- `npc/` — NPC/farmer/bear spawns and behavior (`CharacterAgent`).
- `hud/` — DOM HUD and UI layouts.

`assets/` (map.json, terrain-map.json, annotations.json, the manifests) is **generated**, and asset sync rewrites it after every map mutation and before each deploy — so hand edits there are silently reverted, not rejected. To change the data, change it at the source: the map/character tools. Green/black placeholder tiles are a missing texture preload, not missing data — a fallback tilemap hides the real cause.

`website/scripts/` (`build.sh`, `validate-map-assets.mjs`) is ordinary editable code, not generated — so when the build's asset check requires a character the game no longer uses, remove its `_CHARACTER_ID` reference (the check only wants roles your code still names); regenerating a character to satisfy it wastes a generation.

## The handful of things that actually bite
- **A map swap is one line:** `MAP_FOLDER` in `pixellab/templateAssetPaths.ts`; the runtime handles bounds, tilesets, overlays, objects, spawns, and collision. A character swap is likewise just the relevant ID in that file. (Multi-map / warps → `pixellab/AGENTS.md`.)
- **Each character's atlas must fit one page**: 2048×2048, or 4096×4096 when it cannot (`website/scripts/pack-atlases.mjs`; a page over 2048 can fail on old phones). The game cannot load multi-page output, so overflow fails the build ("Atlas … no longer fits a single page"). Drop animations or unlink unused characters; never resize frames.
- **Runtime code needs `import Phaser from "phaser";`** — type-only code compiles without it but crashes in Vite (there is no global Phaser).
- **`update(_time: number, deltaMs: number)`** — Scene.update's first arg is TIME, not delta; using it as delta teleports everything (TS2554).
- **Declare numeric fields with a type:** `private score: number = 0;` — a bare `= 0` infers the literal type `0` and rejects reassignment.
- **MapJson access is nested:** `map.mapConfig.tileSize`, `map.mapConfig.dimensions.pixelWidth` (pixels), `map.mapConfig.boundingBox.minX` (TILES, not pixels). `LoadedMap` wraps it (`.map`, `.folder`, `.annotations`). For an off-map test use `worldPixelBounds(mapData)` from `shared/navigation.ts` — comparing a world-pixel position against the tile-unit boundingBox culls everything on frame 1.
- **Coordinates are already exported world pixels** (x right, y down), and terrain uses dual-grid sampling. An apparent half-tile offset is almost always a wrong texture key or a missing preload; shifting objects/overlays/spawns/collision by half a tile makes that one map look right and every other map wrong. Check keys and preload first (see `pixellab/AGENTS.md`).
- **Poses and clips are separate calls on `SpriteAnimator`:** `setPose(direction)` draws the static rotation, `setClip(name, direction)` plays an animation. A clip named `idle` is just an animation — the name carries no special meaning, and branching on it instead of on what the clip is cost the sidescroller template a silently frozen idle.

## Combat works out of the box
Slash (J) and fireball (L) already hit NPCs. Tune via `GAME_CONFIG.combat` in `config.ts`. On hit, `CharacterAgent.hit(x, y, strength)` applies knockback/stun/flash; `FireProjectileSystem.update(...)` and the `onSlashSwing` callback already do hit detection. Any object with `sprite`, `hitRadius`, and `hit(x, y, strength)` is a valid projectile target — that interface is the extension point.
- **W/A/S/D move, Shift run, Space jump, J slash, L spell are taken.** Free keys (E, F, Q, R…) avoid a collision; rebinding J or L breaks combat silently, so if you do rebind, re-test attacking.
- No dialogue/interaction system exists — "talk to NPC" is built from scratch (proximity check + DOM UI + data).

## Adding gameplay
A new `.ts` under `website/src/gameplay/` wired into `GameScene.ts` at the marker comments (`// === NEW SYSTEMS ===` in `create()`, `// === NEW UPDATES ===` in `update()`) is the cheapest path, and keeps the next feature cheap too.

`GameScene.ts`, `BootScene.ts`, `PlayerController.ts` and `pixellab/` carry wiring the rest of the game assumes — preload order, camera setup, collision stepping, the map contract. Rewriting one means re-deriving that, which is the right call when it IS the task ("replace the movement system") and an expensive accident when it isn't ("add a coin"). Prefer incremental edits; know which one you're doing.

Put HUD text in `HudOverlay` and clickable UI as DOM in `#hud-root` — the playtest tool clicks DOM, so a canvas button can't be verified even when it works.

`cd website && npm test` runs the template's own checks (animation, HUD, collision, stairs, tile layers) — fast, and a good idea after touching `shared/` or `pixellab/`.

Deploy with `wrangler deploy` (it builds, smoke-tests, and ships the `worker/` multiplayer bundle when present). Nothing auto-saves — persist with `git add -A && git commit && git push origin main`.
