# NPC Module (top-down)

NPC/farmer/bear behavior: roaming/attack in `CharacterAgent.ts`, preload + spawn construction in `spawnNpcs.ts`.

- **Spawns** resolve by NAME — a point/layer whose `name`/`tags` contain the role word (`npc` → base, `farmer`/`farmer_girl`/`farmer-girl` → farmer, `bear` → bear). `resolveWalkableSpawnPoint(...)` (`pixellab/spawns.ts`) snaps blocked/missing spawns to walkable ground — an NPC parsed straight out of annotations spawns inside a wall and never moves. `TEMPLATE_SPAWNS` = default map only.
- "All NPCs" = base + farmer + bear unless the user clearly means one.
- **Removing a role** is fine and takes two edits: drop its uses here, and drop its `*_CHARACTER_ID` export from `pixellab/templateAssetPaths.ts`. The asset check validates the roles the code still uses, so a role nobody imports needs no assets — it only warns that the export is dead. Leave a use behind and the build fails naming the file, which is the point.
- **Movement:** `shared/collision.ts` is what the player uses, so NPCs routed through it collide identically and stay cheaper than Arcade Physics. Chase around walls with `shared/navigation.ts` (`findPath`, `nearestWalkable`); recomputing every few frames (~0.2s) rather than every pixel is the difference between smooth and a frame-rate drop.
