import type { RectSpatialIndex } from "./spatialIndex";
import type { TileLayersJson, TileLayerWalkability } from "./tileLayers";
import type { Direction } from "../shared/direction";

export interface MapJson {
  name: string;
  mapConfig: {
    tileSize: number;
    dimensions: {
      width: number; // TILES wide
      height: number; // TILES tall
      pixelWidth: number; // world PIXELS wide
      pixelHeight: number; // world PIXELS tall
    };
    // TILE indices, NOT world pixels. Never compare sprite.x/y against these.
    // For world-pixel map bounds (projectiles, thrown items, AoE) call
    // worldPixelBounds(mapData) from shared/navigation.ts.
    boundingBox: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
  };
  terrains?: Array<{
    id: number;
    name: string;
    color?: string;
    baseTileId?: string;
  }>;
  tilesets?: Array<{
    id: string;
    filename: string;
    lowerTerrainId: number;
    upperTerrainId: number;
    transitionSize?: number;
    tileSize?: number;
    gridLayout?: string;
    transitionMatcherTiles?: Array<{
      atlasIndex: number;
      pattern: TerrainPattern;
    }>;
  }>;
  walkableTerrainIds?: number[];
  overlays?: Array<{
    id: number;
    filename: string;
    worldCoordinates: { x: number; y: number };
  }>;
  gameplayAnnotations?: {
    file: string;
  };
}

export interface Rectangle {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationProperties extends Record<string, unknown> {
  areaName?: string;
  mapFolder?: string;
  mapId?: string;
  name?: string;
  spawnName?: string;
  targetMap?: string;
  targetMapFolder?: string;
  targetMapId?: string;
  targetSpawn?: string;
  targetSpawnName?: string;
}

export type CollisionMode = "block" | "allow";

export interface CollisionRect extends Rectangle {
  mode: CollisionMode;
}

export interface AnnotationLayer {
  id: string;
  name?: string;
  tags?: string[];
  defaultProperties?: AnnotationProperties;
  terrainSource?: {
    terrainIds?: number[];
    terrainNames?: string[];
  };
  rects?: Array<Rectangle & { properties?: AnnotationProperties }>;
  cells?: Array<{ x: number; y: number; properties?: AnnotationProperties }>;
  points?: Array<{
    id?: string;
    name?: string;
    x: number;
    y: number;
    direction?: Direction;
    properties?: AnnotationProperties;
  }>;
}

export interface AnnotationsJson {
  layers: AnnotationLayer[];
}

export interface ObjectManifest {
  objects: Array<{
    filename: string;
    visible: boolean;
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    groundBounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
}

export interface TerrainCell {
  x: number;
  y: number;
  terrainId: number;
}

export type TerrainPattern = number[][];

export interface RawTerrainMapJson {
  format: "sparse";
  defaultTerrain: number;
  cells: TerrainCell[];
}

export interface TerrainMapJson extends RawTerrainMapJson {
  cellIndex: Map<string, number>;
}

export interface ObjectFootRegion {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
}

export function objectFootRegion(box: { x: number; y: number; width: number; height: number }): ObjectFootRegion {
  const width = Math.max(box.width, 1);
  const height = Math.max(box.height, 1);
  const aspectRatio = height / width;
  const widthRatio = aspectRatio >= 1.4 ? 0.22 : 0.32;
  const heightRatio = aspectRatio >= 1.4 ? 0.16 : 0.22;
  const halfWidth = clamp(width * widthRatio, Math.min(width / 2, 6), width / 2);
  const halfHeight = clamp(height * heightRatio, Math.min(height / 2, 6), height / 2);
  return {
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height - halfHeight,
    halfWidth,
    halfHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface LoadedMap {
  folder: string;
  map: MapJson;
  annotations: AnnotationsJson;
  objects: ObjectManifest;
  terrainMap: TerrainMapJson;
  collisionRects: CollisionRect[];
  collisionRectIndex: RectSpatialIndex<CollisionRect>;
  objectBlockerRects: Rectangle[];
  objectBlockerIndex: RectSpatialIndex<Rectangle>;
  walkableTerrainIds: Set<number>;
  hasAllowCollisionRects: boolean;
  hasTerrainCollisionSources: boolean;
  /** Projected tile layers (iso/hex/oblique) — null when the map has none. */
  tileLayers: TileLayersJson | null;
  tileLayerWalkability: TileLayerWalkability | null;
}
