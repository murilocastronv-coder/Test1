import type { LoadedMap, Rectangle, TerrainMapJson } from "../pixellab/types";
import { terrainCellForPhaserWorld } from "../pixellab/coordinates";
import { rectsNear } from "../pixellab/spatialIndex";
import { tileLayerElevationAt, tileLayerStandingAt, type TileLayerElevation } from "../pixellab/tileLayers";

const MAX_MOVEMENT_STEP_PX = 1;

export interface Collider {
  width: number;
  height: number;
  footOffsetY: number;
  /**
   * Tile-layer elevation levels this mover may step up/down between cells
   * (default 0: raised tiles are walls). Movers that opt in must also draw
   * their sprite lifted by the elevation returned from elevationAt — NPCs
   * keep 0 because their sprite position doubles as their logical position.
   */
  maxStepUp?: number;
  maxStepDown?: number;
}

export function bodyRect(centerX: number, centerY: number, collider: Collider): Rectangle {
  return {
    x: centerX - collider.width / 2,
    y: centerY + collider.footOffsetY - collider.height / 2,
    width: collider.width,
    height: collider.height,
  };
}

export function intersectsRect(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function isPositionClear(
  mapData: LoadedMap,
  centerX: number,
  centerY: number,
  collider: Collider,
  fromLevel = 0,
): boolean {
  const footX = centerX;
  const footY = centerY + collider.footOffsetY;
  const rect = bodyRect(centerX, centerY, collider);
  if (rectsNear(mapData.objectBlockerIndex, rect).some((blocker) => intersectsRect(rect, blocker))) {
    return false;
  }
  const terrainWalkable = isTerrainWalkable(mapData, footX, footY, collider, fromLevel);
  return isAuthoredCollisionWalkable(mapData, footX, footY, terrainWalkable);
}

export function moveWithCollision(
  mapData: LoadedMap,
  currentX: number,
  currentY: number,
  deltaX: number,
  deltaY: number,
  collider: Collider,
  fromLevel = 0,
): { x: number; y: number } {
  const stepCount = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / MAX_MOVEMENT_STEP_PX),
  );
  const stepX = deltaX / stepCount;
  const stepY = deltaY / stepCount;
  let x = currentX;
  let y = currentY;

  for (let step = 0; step < stepCount; step += 1) {
    const intendedX = x + stepX;
    const intendedY = y + stepY;
    const moved = moveSingleStepWithCollision(mapData, x, y, stepX, stepY, collider, fromLevel);
    if (moved.x === x && moved.y === y) {
      break;
    }

    const movedDirectly = moved.x === intendedX && moved.y === intendedY;
    const slidAlongAxis = (
      (moved.x === intendedX && moved.y === y)
      || (moved.x === x && moved.y === intendedY)
    );
    x = moved.x;
    y = moved.y;

    // A ledge transition can move farther than one substep. Return it immediately
    // so the caller can refresh the standing level before the next frame.
    if (!movedDirectly && !slidAlongAxis) {
      break;
    }
  }

  return { x, y };
}

function moveSingleStepWithCollision(
  mapData: LoadedMap,
  currentX: number,
  currentY: number,
  deltaX: number,
  deltaY: number,
  collider: Collider,
  fromLevel: number,
): { x: number; y: number } {
  const nextX = currentX + deltaX;
  const nextY = currentY + deltaY;
  if (isPositionClear(mapData, nextX, nextY, collider, fromLevel)) {
    return { x: nextX, y: nextY };
  }

  if (deltaX !== 0 && isPositionClear(mapData, nextX, currentY, collider, fromLevel)) {
    return { x: nextX, y: currentY };
  }

  if (deltaY !== 0 && isPositionClear(mapData, currentX, nextY, collider, fromLevel)) {
    return { x: currentX, y: nextY };
  }

  // Ledge hop: a blocked move whose collider touches a drawn cliff side
  // face (no face to stand on) may still be a legal transition — the side
  // face is just the vertical wall between two walkable faces. Hop over it:
  // climb to the face above (front approach) or drop to the face below
  // (walking off the top). Step limits still apply via isPositionClear, so
  // an unclimbable wall or a too-deep drop stays blocked. Scan range is the
  // face height plus one stride of slack — diagonal edges and the collider
  // box make the no-face band wider than stridePx alone.
  if (mapData.tileLayerWalkability) {
    const walkability = mapData.tileLayerWalkability;
    const footY = nextY + collider.footOffsetY;
    const halfW = collider.width / 2;
    const halfH = collider.height / 2;
    const touchesNoFace = [
      [nextX, footY],
      [nextX - halfW, footY - halfH],
      [nextX + halfW, footY - halfH],
      [nextX - halfW, footY + halfH],
      [nextX + halfW, footY + halfH],
    ].some(([px, py]) => tileLayerStandingAt(walkability, px, py).kind === "empty");
    if (touchesNoFace) {
      const climbLimit = collider.maxStepUp ?? 0;
      const maxRise = walkability.stridePx * (climbLimit + 1);
      for (let risePx = 2; climbLimit > 0 && risePx <= maxRise; risePx += 2) {
        const riseY = nextY - risePx;
        if (!isPositionClear(mapData, nextX, riseY, collider, fromLevel)) {
          continue;
        }
        const landing = tileLayerStandingAt(walkability, nextX, riseY + collider.footOffsetY);
        if (landing.kind === "surface" && landing.level > fromLevel) {
          return { x: nextX, y: riseY };
        }
      }
      const maxDrop = walkability.stridePx * (fromLevel + 1);
      for (let dropPx = 2; fromLevel > 0 && dropPx <= maxDrop; dropPx += 2) {
        const dropY = nextY + dropPx;
        if (!isPositionClear(mapData, nextX, dropY, collider, fromLevel)) {
          continue;
        }
        const landing = tileLayerStandingAt(walkability, nextX, dropY + collider.footOffsetY);
        if (landing.kind === "empty" || (landing.kind === "surface" && landing.level < fromLevel)) {
          return { x: nextX, y: dropY };
        }
      }
    }
  }

  return { x: currentX, y: currentY };
}

/**
 * Elevation of the tile-layer face under a mover's foot point (drawn space).
 * Movers that allow stepping (collider maxStepUp/maxStepDown > 0) must
 * re-query this after every move and use `depth` (when non-null) instead of
 * foot-y depth so they draw over the block they stand on.
 */
export function elevationAt(mapData: LoadedMap, footX: number, footY: number): TileLayerElevation {
  if (!mapData.tileLayerWalkability) {
    return { level: 0, depth: null };
  }
  return tileLayerElevationAt(mapData.tileLayerWalkability, footX, footY);
}

function stepAllowed(collider: Collider, fromLevel: number, toLevel: number): boolean {
  const delta = toLevel - fromLevel;
  return delta <= (collider.maxStepUp ?? 0) && -delta <= (collider.maxStepDown ?? 0);
}

function isTerrainWalkable(
  mapData: LoadedMap,
  worldX: number,
  worldY: number,
  collider: Collider,
  fromLevel: number,
): boolean {
  const terrainMap = mapData.terrainMap;
  // Projected tile layers (iso/hex/oblique) refine square-terrain walkability:
  // a solid cell (structure wall, water material) blocks, a painted cell is a
  // standing surface entered only within the mover's step limits (a floor
  // stamp at level 0 stays an unconditional allow — e.g. iso bridge over
  // square water), an unpainted cell falls through to square terrain at
  // ground level. A pure tile-layer map has an all-zero square grid —
  // unpainted means void.
  if (mapData.tileLayerWalkability) {
    const walkability = mapData.tileLayerWalkability;
    const pureTileLayerMap = terrainMap.cellIndex.size === 0 && terrainMap.defaultTerrain === 0;
    // The whole collider box must stay on faces the mover can stand on:
    // corners fail on solid cells (structure walls, water material), on
    // no-face points (map void, cliff side faces) for pure tile-layer maps,
    // and on faces too high to climb onto — a foot-point-only test let the
    // body slide partially into wall tiles. Corners never test the downward
    // rule, so a box straddling a ledge just climbed (or hugging a drop
    // edge) can't wedge the mover.
    const halfW = collider.width / 2;
    const halfH = collider.height / 2;
    for (const [cornerX, cornerY] of [
      [worldX - halfW, worldY - halfH],
      [worldX + halfW, worldY - halfH],
      [worldX - halfW, worldY + halfH],
      [worldX + halfW, worldY + halfH],
    ]) {
      const corner = tileLayerStandingAt(walkability, cornerX, cornerY);
      if (corner.kind === "blocked" || (corner.kind === "empty" && pureTileLayerMap)) {
        return false;
      }
      if (corner.kind === "surface" && corner.level - fromLevel > (collider.maxStepUp ?? 0)) {
        return false;
      }
    }
    const standing = tileLayerStandingAt(walkability, worldX, worldY);
    if (standing.kind === "blocked") {
      return false;
    }
    if (standing.kind === "surface") {
      return stepAllowed(collider, fromLevel, standing.level);
    }
    if (pureTileLayerMap) {
      return false;
    }
    if (!stepAllowed(collider, fromLevel, 0)) {
      return false;
    }
  }
  const walkableTerrainIds = mapData.walkableTerrainIds;

  const tileSize = mapData.map.mapConfig.tileSize;
  const tileX = terrainCellForPhaserWorld(worldX, tileSize);
  const tileY = terrainCellForPhaserWorld(worldY, tileSize);
  const corners = [
    terrainIdAt(terrainMap, tileX - 1, tileY - 1),
    terrainIdAt(terrainMap, tileX, tileY - 1),
    terrainIdAt(terrainMap, tileX - 1, tileY),
    terrainIdAt(terrainMap, tileX, tileY),
  ];
  return corners.every((terrainId) => walkableTerrainIds.has(terrainId));
}

function terrainIdAt(terrainMap: TerrainMapJson, x: number, y: number): number {
  const key = `${x},${y}`;
  return terrainMap.cellIndex.get(key) ?? terrainMap.defaultTerrain;
}

function isAuthoredCollisionWalkable(
  mapData: LoadedMap,
  x: number,
  y: number,
  terrainWalkable: boolean,
): boolean {
  const pointRect = { x, y, width: 1, height: 1 };
  let walkable = mapData.hasAllowCollisionRects && !mapData.hasTerrainCollisionSources ? false : terrainWalkable;
  for (const rect of rectsNear(mapData.collisionRectIndex, pointRect)) {
    if (pointInsideRect(x, y, rect)) {
      walkable = rect.mode === "allow";
    }
  }
  return walkable;
}

function pointInsideRect(x: number, y: number, rect: Rectangle): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
