import { assetUrl, MAP_FOLDER } from "./templateAssetPaths";
import { collisionRectsFor, hasTerrainCollisionSourcesFor, objectBlockerRectsFor, walkableTerrainIdsFor } from "./collision";
import { buildRectSpatialIndex } from "./spatialIndex";
import { tileLayerWalkabilityFor, type TileLayersJson } from "./tileLayers";
import type { AnnotationsJson, LoadedMap, MapJson, ObjectManifest, RawTerrainMapJson, TerrainMapJson } from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** tile-layers.json is absent from exports that predate projected tile layers. */
async function fetchOptionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function loadPixelLabMap(mapFolder = MAP_FOLDER): Promise<LoadedMap> {
  const map = await fetchJson<MapJson>(assetUrl("maps", mapFolder, "map.json"));
  const raw = await fetchJson<RawTerrainMapJson>(assetUrl("maps", mapFolder, "terrain-map.json"));
  if (!map.gameplayAnnotations) {
    throw new Error(`Map ${mapFolder} is missing gameplayAnnotations.file`);
  }
  const terrainMap: TerrainMapJson = {
    ...raw,
    cellIndex: new Map(raw.cells.map((cell) => [`${cell.x},${cell.y}`, cell.terrainId])),
  };
  const annotations = await fetchJson<AnnotationsJson>(assetUrl("maps", mapFolder, map.gameplayAnnotations.file));
  const objects = await fetchJson<ObjectManifest>(assetUrl("maps", mapFolder, "objects", "manifest.json"));
  const tileLayers = await fetchOptionalJson<TileLayersJson>(assetUrl("maps", mapFolder, "tile-layers.json"));
  const collisionRects = collisionRectsFor(annotations, map.mapConfig.tileSize);
  const objectBlockerRects = objectBlockerRectsFor(objects);
  const spatialCellSize = map.mapConfig.tileSize * 4;
  const partialMap = {
    folder: mapFolder,
    map,
    annotations,
    objects,
    terrainMap,
    collisionRects,
    collisionRectIndex: buildRectSpatialIndex(collisionRects, spatialCellSize),
    objectBlockerRects,
    objectBlockerIndex: buildRectSpatialIndex(objectBlockerRects, spatialCellSize),
    walkableTerrainIds: walkableTerrainIdsFor(map, annotations),
    hasAllowCollisionRects: collisionRects.some((rect) => rect.mode === "allow"),
    hasTerrainCollisionSources: hasTerrainCollisionSourcesFor(annotations),
    tileLayers,
    tileLayerWalkability: null,
  };
  return {
    ...partialMap,
    tileLayerWalkability: tileLayerWalkabilityFor(partialMap),
  };
}
