export const GAME_CONFIG = {
  player: {
    walkSpeed: 150,
    runSpeed: 280,
    jumpHeight: 20,
    jumpDurationMs: 500,
    footOffsetY: 10,
    colliderWidth: 6,
    colliderHeight: 4,
  },
  npc: {
    walkSpeed: 80,
    footOffsetY: 8,
    bearFootOffsetY: 15,
    idleMinMs: 1500,
    idleMaxMs: 3000,
    walkMinMs: 2000,
    walkMaxMs: 4000,
    attackChance: 0.2,
  },
  camera: {
    zoom: 2,
    followLerp: 0.12,
  },
  animation: {
    fps: 10,
  },
  terrain: {
    // Projected (iso/oblique/hex) tile-layer maps: how many stacked-tile
    // levels the player can step up or down between neighbouring cells.
    // 0 = raised tiles are walls, 1 = one-block ledges are climbable,
    // higher = free climbing. Tune these when the game needs different
    // terrain traversal (e.g. stairs-only worlds set both to 0).
    maxStepUp: 1,
    maxStepDown: 1,
  },
  combat: {
    slashRange: 36,
    slashWidth: 32,
    projectileHitRadius: 8,
    npcHitRadius: 10,
    knockbackStrength: 200,
    hitStunMs: 350,
  },
} as const;

export const TEMPLATE_SPAWNS = {
  player: { x: 808, y: 168 },
  npc: { x: 712, y: 40 },
  farmer: { x: 496, y: 264 },
  bear: { x: 1112, y: 328 },
} as const;

/**
 * Walkability overrides for tile-layer (iso/oblique/hex) map materials, keyed
 * by lowercase material name from the tileset (e.g. "water", "grass", "lava").
 * By default water-like names block and ground-like names allow — add an entry
 * here to override, e.g. { water: "allow" } for a swimming game or
 * { grass: "block" } to fence off the grass.
 */
export const MATERIAL_WALKABILITY_OVERRIDES: Record<string, "allow" | "block"> = {};
