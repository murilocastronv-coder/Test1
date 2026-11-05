import { terrainCellForPhaserWorld } from "../pixellab/coordinates";
import type { LoadedMap } from "../pixellab/types";
import { isPositionClear, type Collider } from "./collision";

export interface Point {
  x: number;
  y: number;
}

export interface TileCoord {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Neighbor {
  dx: number;
  dy: number;
  cost: number;
}

interface PathNode {
  f: number;
  tile: TileCoord;
}

const SQRT_2 = 1.4142135;
const MAX_EXPANSIONS = 16384;
const DEFAULT_SNAP_RADIUS_TILES = 4;

const NEIGHBORS: Neighbor[] = [
  { dx: 1, dy: 0, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: SQRT_2 },
  { dx: 1, dy: -1, cost: SQRT_2 },
  { dx: -1, dy: 1, cost: SQRT_2 },
  { dx: -1, dy: -1, cost: SQRT_2 },
];

export function worldToTile(mapData: LoadedMap, world: Point): TileCoord {
  const tileSize = mapData.map.mapConfig.tileSize;
  return {
    x: terrainCellForPhaserWorld(world.x, tileSize),
    y: terrainCellForPhaserWorld(world.y, tileSize),
  };
}

export function tileToWorld(mapData: LoadedMap, tile: TileCoord): Point {
  const tileSize = mapData.map.mapConfig.tileSize;
  return {
    x: tile.x * tileSize,
    y: tile.y * tileSize,
  };
}

/**
 * World-pixel extent of the map. Use this for "did it leave the map" checks on
 * anything whose position is in world pixels — projectiles, thrown items, AoE.
 *
 * IMPORTANT: `mapConfig.boundingBox` is in TILE indices, NOT pixels. Comparing a
 * sprite's world-pixel `x`/`y` directly against `boundingBox` destroys the object
 * the moment it spawns (e.g. a fireball at world y≈168 vs boundingBox.maxY≈28).
 * Always convert through this helper first — it uses the same
 * (min - 0.5) / (max + 0.5) * tileSize convention as `renderMap.ts` and the
 * camera `setBounds`, so the result lines up exactly with the rendered map.
 */
export function worldPixelBounds(mapData: LoadedMap): Bounds {
  const { boundingBox, tileSize } = mapData.map.mapConfig;
  return {
    minX: (boundingBox.minX - 0.5) * tileSize,
    minY: (boundingBox.minY - 0.5) * tileSize,
    maxX: (boundingBox.maxX + 0.5) * tileSize,
    maxY: (boundingBox.maxY + 0.5) * tileSize,
  };
}

export function findPath(
  mapData: LoadedMap,
  from: Point,
  to: Point,
  collider: Collider,
): Point[] | null {
  const start = snapToWalkable(
    mapData,
    worldToTile(mapData, from),
    collider,
    DEFAULT_SNAP_RADIUS_TILES,
  );
  const goal = snapToWalkable(
    mapData,
    worldToTile(mapData, to),
    collider,
    DEFAULT_SNAP_RADIUS_TILES,
  );
  if (start === null || goal === null) {
    return null;
  }
  if (sameTile(start, goal)) {
    return [];
  }

  const path = astar(mapData, start, goal, collider);
  if (path === null) {
    return null;
  }
  return path.slice(1).map((tile) => tileToWorld(mapData, tile));
}

export function nearestWalkable(
  mapData: LoadedMap,
  world: Point,
  collider: Collider,
  maxRadiusTiles: number,
): Point | null {
  const tile = snapToWalkable(
    mapData,
    worldToTile(mapData, world),
    collider,
    maxRadiusTiles,
  );
  return tile === null ? null : tileToWorld(mapData, tile);
}

function snapToWalkable(
  mapData: LoadedMap,
  center: TileCoord,
  collider: Collider,
  maxRadiusTiles: number,
): TileCoord | null {
  if (isTileWalkable(mapData, center, collider)) {
    return center;
  }

  for (let radius = 1; radius <= maxRadiusTiles; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const candidate = { x: center.x + dx, y: center.y + dy };
        if (isTileWalkable(mapData, candidate, collider)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function astar(
  mapData: LoadedMap,
  start: TileCoord,
  goal: TileCoord,
  collider: Collider,
): TileCoord[] | null {
  const open = new MinHeap();
  const cameFrom = new Map<string, TileCoord>();
  const gScore = new Map<string, number>();
  gScore.set(tileKey(start), 0);
  open.push({ f: heuristic(start, goal), tile: start });

  let expansions = 0;
  while (open.size > 0) {
    const current = open.pop().tile;
    if (sameTile(current, goal)) {
      return reconstruct(cameFrom, current);
    }

    expansions += 1;
    if (expansions > MAX_EXPANSIONS) {
      return null;
    }

    const currentKey = tileKey(current);
    const currentG = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;
    for (const neighbor of NEIGHBORS) {
      const next = { x: current.x + neighbor.dx, y: current.y + neighbor.dy };
      if (!isTileWalkable(mapData, next, collider)) {
        continue;
      }
      if (neighbor.dx !== 0 && neighbor.dy !== 0) {
        const horizontal = { x: current.x + neighbor.dx, y: current.y };
        const vertical = { x: current.x, y: current.y + neighbor.dy };
        if (
          !isTileWalkable(mapData, horizontal, collider)
          || !isTileWalkable(mapData, vertical, collider)
        ) {
          continue;
        }
      }

      const tentativeG = currentG + neighbor.cost;
      const nextKey = tileKey(next);
      const previousG = gScore.get(nextKey) ?? Number.POSITIVE_INFINITY;
      if (tentativeG < previousG) {
        cameFrom.set(nextKey, current);
        gScore.set(nextKey, tentativeG);
        open.push({
          f: tentativeG + heuristic(next, goal),
          tile: next,
        });
      }
    }
  }

  return null;
}

function isTileWalkable(mapData: LoadedMap, tile: TileCoord, collider: Collider): boolean {
  if (!inBounds(mapData, tile)) {
    return false;
  }
  const world = tileToWorld(mapData, tile);
  return isPositionClear(mapData, world.x, world.y, collider);
}

function inBounds(mapData: LoadedMap, tile: TileCoord): boolean {
  const bounds = tileBounds(mapData);
  return tile.x >= bounds.minX
    && tile.x <= bounds.maxX
    && tile.y >= bounds.minY
    && tile.y <= bounds.maxY;
}

function tileBounds(mapData: LoadedMap): Bounds {
  const config = mapData.map.mapConfig;
  return {
    minX: config.boundingBox.minX,
    minY: config.boundingBox.minY,
    maxX: config.boundingBox.minX + config.dimensions.width - 1,
    maxY: config.boundingBox.minY + config.dimensions.height - 1,
  };
}

function heuristic(a: TileCoord, b: TileCoord): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const lo = Math.min(dx, dy);
  const hi = Math.max(dx, dy);
  return SQRT_2 * lo + (hi - lo);
}

function reconstruct(cameFrom: Map<string, TileCoord>, current: TileCoord): TileCoord[] {
  const path = [current];
  let key = tileKey(current);
  while (cameFrom.has(key)) {
    const previous = cameFrom.get(key)!;
    path.push(previous);
    key = tileKey(previous);
  }
  path.reverse();
  return path;
}

function sameTile(a: TileCoord, b: TileCoord): boolean {
  return a.x === b.x && a.y === b.y;
}

function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.y}`;
}

class MinHeap {
  private readonly nodes: PathNode[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: PathNode): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): PathNode {
    const first = this.nodes[0];
    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.nodes[parent].f <= this.nodes[current].f) {
        return;
      }
      this.swap(parent, current);
      current = parent;
    }
  }

  private sinkDown(index: number): void {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;

      if (left < this.nodes.length && this.nodes[left].f < this.nodes[smallest].f) {
        smallest = left;
      }
      if (right < this.nodes.length && this.nodes[right].f < this.nodes[smallest].f) {
        smallest = right;
      }
      if (smallest === current) {
        return;
      }
      this.swap(current, smallest);
      current = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const temp = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = temp;
  }
}
