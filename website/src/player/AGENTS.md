# Player Module (top-down)

Player movement, animation, input.

- **Relocate:** map-authored spawns via `resolvePlayerSpawnPoint(mapData)` (`pixellab/spawns.ts`), which already handles the collider offset and blocked-spawn fallback that hand-parsed `annotations.json` misses. A spawn move that touches movement code is usually a sign the spawn was read in the wrong place. "Spawn on grass" = evaluate the feet/collider point, not the sprite center. `TEMPLATE_SPAWNS.player` = default map only.
- **Warps:** `player.setMapData(targetMapData)` before movement resumes, `player.teleportTo(spawn.x, spawn.y)` after resolving the target-map spawn. Check trigger/warp areas with `player.worldPosition` (ground/collider position, not the visual jump offset).
- **Character swap:** update `PLAYER_CHARACTER_ID` in `pixellab/templateAssetPaths.ts` and reuse `PlayerController.ts` — no new module to point at another character. Read `assets/characters/{id}/manifest.json` first; still poses at `{stateFolder}/rotations/{direction}.png`, clips at `{stateFolder}/animations/{clip}/{direction}/frame_NNN.png`. Prefer manifest aliases (`walk`/`run`) over long clip names.
