import type { AnnotationLayer, AnnotationProperties, LoadedMap } from "./types";
import { GAME_CONFIG, TEMPLATE_SPAWNS } from "../config";
import { type Collider } from "../shared/collision";
import type { Direction } from "../shared/direction";
import { nearestWalkable, worldToTile } from "../shared/navigation";

export interface SpawnPoint {
  id?: string;
  name?: string;
  x: number;
  y: number;
  direction?: Direction;
  properties?: AnnotationProperties;
}

export interface MapEntryOptions {
  spawnName?: string;
  spawnRole?: string;
}

const SPAWN_ROLE_ALIASES: Record<string, string> = {
  player: "player",
  npc: "npc",
  farmer: "farmer",
  farmer_girl: "farmer",
  "farmer-girl": "farmer",
  bear: "bear",
};
const SPAWN_LABEL_PATTERN = /\bspawns?\b|\bstarts?\b|\bentries?\b|\bentry\s+points?\b/;
const SPAWN_LABEL_PROPERTY_NAMES = ["areaName", "name", "spawnName", "targetSpawnName"] as const;

function normalizeSpawnRole(spawnRole: string | undefined): string | undefined {
  if (spawnRole === undefined) {
    return undefined;
  }
  return SPAWN_ROLE_ALIASES[spawnRole.trim().toLowerCase()];
}

function normalizeLabel(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelText(values: Array<string | undefined>): string {
  return values
    .map(normalizeLabel)
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

function spawnRoleFromLabels(values: Array<string | undefined>): string | undefined {
  const labels = labelText(values);
  if (labels.length === 0) {
    return undefined;
  }

  for (const [alias, spawnRole] of Object.entries(SPAWN_ROLE_ALIASES)) {
    const normalizedAlias = normalizeLabel(alias);
    if (
      normalizedAlias !== undefined
      && new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`).test(labels)
    ) {
      return spawnRole;
    }
  }

  return undefined;
}

function stringProperty(properties: AnnotationProperties | undefined, key: string): string | undefined {
  const value = properties?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function layerLabels(layer: AnnotationLayer): Array<string | undefined> {
  return [
    layer.id,
    layer.name,
    ...(layer.tags ?? []),
    ...SPAWN_LABEL_PROPERTY_NAMES.map((name) => stringProperty(layer.defaultProperties, name)),
  ];
}

function pointLabels(point: SpawnPoint): Array<string | undefined> {
  return [
    point.id,
    point.name,
    ...SPAWN_LABEL_PROPERTY_NAMES.map((name) => stringProperty(point.properties, name)),
  ];
}

function isSpawnLayer(layer: AnnotationLayer): boolean {
  return SPAWN_LABEL_PATTERN.test(labelText(layerLabels(layer)))
    || layerDefaultSpawnRole(layer) !== undefined
    || (layer.points ?? []).some((point) => pointSpawnRole(point) !== undefined);
}

function layerDefaultSpawnRole(layer: AnnotationLayer): string | undefined {
  return spawnRoleFromLabels(layerLabels(layer));
}

function pointSpawnRole(point: SpawnPoint): string | undefined {
  return spawnRoleFromLabels(pointLabels(point));
}

function pointMatchesSpawnName(point: SpawnPoint, spawnName: string): boolean {
  const requestedName = normalizeLabel(spawnName);
  const labels = pointLabels(point).map(normalizeLabel);
  return requestedName !== undefined && labels.includes(requestedName);
}

function pointsForDefaultLayer(layer: AnnotationLayer): SpawnPoint[] {
  return (layer.points ?? []).filter((point) => pointSpawnRole(point) === undefined);
}

function firstGenericSpawnPoint(spawnLayers: AnnotationLayer[]): SpawnPoint | undefined {
  return spawnLayers
    .filter((layer) => layerDefaultSpawnRole(layer) === undefined)
    .flatMap(pointsForDefaultLayer)[0];
}

function mapCenterPoint(mapData: LoadedMap): SpawnPoint {
  const config = mapData.map.mapConfig;
  const tileSize = config.tileSize;
  return {
    x: (config.boundingBox.minX + (config.dimensions.width - 1) / 2) * tileSize,
    y: (config.boundingBox.minY + (config.dimensions.height - 1) / 2) * tileSize,
  };
}

function isInsideMapBounds(mapData: LoadedMap, point: SpawnPoint): boolean {
  const tile = worldToTile(mapData, point);
  const config = mapData.map.mapConfig;
  return tile.x >= config.boundingBox.minX
    && tile.x <= config.boundingBox.maxX
    && tile.y >= config.boundingBox.minY
    && tile.y <= config.boundingBox.maxY;
}

function spawnSnapRadiusTiles(mapData: LoadedMap): number {
  const dimensions = mapData.map.mapConfig.dimensions;
  return Math.max(dimensions.width, dimensions.height);
}

function resolveWalkablePoint(
  mapData: LoadedMap,
  point: SpawnPoint,
  collider: Collider,
  label: string,
): SpawnPoint {
  const searchPoint = isInsideMapBounds(mapData, point) ? point : mapCenterPoint(mapData);
  const walkable = nearestWalkable(mapData, searchPoint, collider, spawnSnapRadiusTiles(mapData));
  if (walkable) {
    return { ...point, x: walkable.x, y: walkable.y };
  }
  throw new Error(`No walkable ${label} found on map ${mapData.folder}`);
}

export function findSpawnPoint(
  mapData: LoadedMap,
  spawnRole: string | undefined,
  spawnName?: string,
): SpawnPoint | undefined {
  const requestedRole = normalizeSpawnRole(spawnRole);
  const spawnLayers = mapData.annotations.layers.filter(isSpawnLayer);

  if (spawnName !== undefined) {
    const namedPoint = spawnLayers
      .flatMap((layer) => layer.points ?? [])
      .find((point) => pointMatchesSpawnName(point, spawnName));
    if (namedPoint !== undefined) {
      return namedPoint;
    }
  }

  if (requestedRole === undefined) {
    return undefined;
  }

  const explicitPoint = spawnLayers
    .flatMap((layer) => layer.points ?? [])
    .find((point) => pointSpawnRole(point) === requestedRole);
  if (explicitPoint) {
    return explicitPoint;
  }

  const defaultLayer = spawnLayers.find(
    (layer) => layerDefaultSpawnRole(layer) === requestedRole,
  );
  const defaultPoint = defaultLayer ? pointsForDefaultLayer(defaultLayer)[0] : undefined;
  if (defaultPoint !== undefined) {
    return defaultPoint;
  }

  return requestedRole === "player" ? firstGenericSpawnPoint(spawnLayers) : undefined;
}

export function resolveSpawnPoint(
  mapData: LoadedMap,
  spawnRole: string,
  fallback: SpawnPoint,
): SpawnPoint {
  return findSpawnPoint(mapData, spawnRole) ?? fallback;
}

export function resolveWalkableSpawnPoint(
  mapData: LoadedMap,
  spawnRole: string,
  fallback: SpawnPoint,
  collider: Collider,
): SpawnPoint {
  const spawn = resolveSpawnPoint(mapData, spawnRole, fallback);
  return resolveWalkablePoint(mapData, spawn, collider, `${spawnRole} spawn`);
}

export function playerCollider(): Collider {
  // Must match PlayerController's collider exactly — without maxStepUp/maxStepDown, spawn
  // resolution treats every raised tile-layer cell as blocked and silently relocates a spawn
  // annotation placed on a platform the player can actually climb.
  return {
    width: GAME_CONFIG.player.colliderWidth,
    height: GAME_CONFIG.player.colliderHeight,
    footOffsetY: GAME_CONFIG.player.footOffsetY,
    maxStepUp: GAME_CONFIG.terrain.maxStepUp,
    maxStepDown: GAME_CONFIG.terrain.maxStepDown,
  };
}

export function resolvePlayerSpawnPoint(mapData: LoadedMap): SpawnPoint {
  return resolveWalkableSpawnPoint(
    mapData,
    "player",
    TEMPLATE_SPAWNS.player,
    playerCollider(),
  );
}

export function resolveMapEntryPoint(
  mapData: LoadedMap,
  options: MapEntryOptions = {},
): SpawnPoint {
  const spawn = findSpawnPoint(mapData, options.spawnRole ?? "player", options.spawnName);
  const entry = spawn ?? mapCenterPoint(mapData);
  return resolveWalkablePoint(mapData, entry, playerCollider(), "map entry point");
}
