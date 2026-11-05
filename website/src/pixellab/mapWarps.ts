import type Phaser from "phaser";
import type { PlayerController } from "../player/PlayerController";
import type { Point } from "../shared/navigation";
import { switchPlayerToMap, type MapSwitchResult } from "./mapHelpers";
import type { AnnotationLayer, AnnotationProperties, LoadedMap, Rectangle } from "./types";
import type { RenderedMap } from "./renderMap";

export interface MapWarpConfig {
  areaName: string;
  targetMapFolder: string;
  targetSpawnName?: string;
}

export interface MapWarpArea {
  id: string;
  name: string;
  rect: Rectangle;
  targetMapFolder: string;
  targetSpawnName?: string;
}

const TARGET_MAP_PROPERTY_NAMES = ["targetMapFolder", "targetMapId", "targetMap", "mapFolder", "mapId"] as const;
const TARGET_SPAWN_NAME_PROPERTY_NAMES = ["targetSpawnName", "targetSpawn", "spawnName"] as const;
const AREA_NAME_PROPERTY_NAMES = ["areaName", "name"] as const;

export function mapWarpAreasFor(mapData: LoadedMap, configs: MapWarpConfig[] = []): MapWarpArea[] {
  const areas: MapWarpArea[] = [];
  for (const layer of mapData.annotations.layers) {
    for (const rect of layer.rects ?? []) {
      const config = findConfigForArea(layer, rect, configs);
      const targetMapFolder = config?.targetMapFolder
        ?? firstStringProperty(rect.properties, TARGET_MAP_PROPERTY_NAMES)
        ?? firstStringProperty(layer.defaultProperties, TARGET_MAP_PROPERTY_NAMES);
      if (targetMapFolder === undefined) {
        continue;
      }

      areas.push({
        id: rect.id ?? `${layer.id}-${areas.length}`,
        name: areaNameFor(layer, rect),
        rect,
        targetMapFolder,
        targetSpawnName: config?.targetSpawnName
          ?? firstStringProperty(rect.properties, TARGET_SPAWN_NAME_PROPERTY_NAMES)
          ?? firstStringProperty(layer.defaultProperties, TARGET_SPAWN_NAME_PROPERTY_NAMES),
      });
    }
  }
  return areas;
}

export function mapWarpAt(
  mapData: LoadedMap,
  world: Point,
  configs: MapWarpConfig[] = [],
): MapWarpArea | null {
  return mapWarpAreasFor(mapData, configs).find((area) => pointInsideRect(world, area.rect)) ?? null;
}

export async function switchPlayerByWarpArea(
  scene: Phaser.Scene,
  currentMapData: LoadedMap,
  world: Point,
  player: PlayerController,
  currentRenderedMap?: RenderedMap,
  configs: MapWarpConfig[] = [],
): Promise<MapSwitchResult | null> {
  const warp = mapWarpAt(currentMapData, world, configs);
  if (warp === null) {
    return null;
  }
  return switchPlayerToMap(scene, warp.targetMapFolder, player, currentRenderedMap, {
    spawnName: warp.targetSpawnName,
  });
}

function findConfigForArea(
  layer: AnnotationLayer,
  rect: Rectangle & { properties?: AnnotationProperties },
  configs: MapWarpConfig[],
): MapWarpConfig | undefined {
  return configs.find((config) => areaMatchesConfig(layer, rect, config));
}

function areaMatchesConfig(
  layer: AnnotationLayer,
  rect: Rectangle & { properties?: AnnotationProperties },
  config: MapWarpConfig,
): boolean {
  return [...labelsForLayer(layer), ...labelsForRect(rect)].includes(normalizeLabel(config.areaName));
}

function labelsForLayer(layer: AnnotationLayer): string[] {
  return [
    layer.id,
    layer.name,
    ...(layer.tags ?? []),
    ...AREA_NAME_PROPERTY_NAMES.map((name) => stringProperty(layer.defaultProperties, name)),
  ].flatMap((label) => labelList(label));
}

function labelsForRect(rect: Rectangle & { properties?: AnnotationProperties }): string[] {
  return [
    rect.id,
    ...AREA_NAME_PROPERTY_NAMES.map((name) => stringProperty(rect.properties, name)),
  ].flatMap((label) => labelList(label));
}

function areaNameFor(layer: AnnotationLayer, rect: Rectangle & { properties?: AnnotationProperties }): string {
  return stringProperty(rect.properties, "name")
    ?? stringProperty(rect.properties, "areaName")
    ?? layer.name
    ?? rect.id
    ?? layer.id;
}

function firstStringProperty(
  properties: AnnotationProperties | undefined,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = stringProperty(properties, name);
    if (value !== undefined) {
      return value;
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

function labelList(value: string | undefined): string[] {
  const normalized = normalizeLabel(value);
  return normalized === "" ? [] : [normalized];
}

function normalizeLabel(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[-_]+/g, " ") ?? "";
}

function pointInsideRect(point: Point, rect: Rectangle): boolean {
  return point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height;
}
