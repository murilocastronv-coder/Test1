import { objectFootRegion, type AnnotationProperties, type AnnotationsJson, type CollisionMode, type CollisionRect, type MapJson, type ObjectManifest, type Rectangle } from "./types";

const WARP_TARGET_PROPERTY_NAMES = ["targetMapFolder", "targetMapId", "targetMap", "mapFolder", "mapId"] as const;
const AREA_NAME_PROPERTY_NAMES = ["areaName", "name"] as const;
const NON_COLLISION_INTERACTION_LABELS = /\b(exit|warp|teleport|teleporter|portal|door|doorway|entrance|entry|trigger|interact|interaction|interactive|touch)\b|\bmap\s+transition\b/;

export function collisionRectsFor(annotations: AnnotationsJson, tileSize: number): CollisionRect[] {
  return annotations.layers
    .filter(isCollisionLayer)
    .flatMap((layer) => {
      const defaultMode = layerCollisionMode(layer);
      const rects = (layer.rects ?? []).flatMap((rect) => {
        if (isNonCollisionInteractionArea(layer, rect)) {
          return [];
        }
        const mode = defaultMode;
        if (mode === null || mode === undefined) {
          return [];
        }
        return [{ ...rect, mode }];
      });
      const cells = (layer.cells ?? []).flatMap((cell) => {
        const mode = defaultMode;
        if (mode === null || mode === undefined) {
          return [];
        }
        return [{
          id: `${cell.x},${cell.y}`,
          x: (cell.x - 0.5) * tileSize,
          y: (cell.y - 0.5) * tileSize,
          width: tileSize,
          height: tileSize,
          mode,
        }];
      });
      return [...rects, ...cells];
    });
}

export function walkableTerrainIdsFor(map: MapJson, annotations: AnnotationsJson): Set<number> {
  const terrainIds = new Set((map.terrains ?? []).map((terrain) => terrain.id));
  const annotationTerrainModes = terrainCollisionModesFor(annotations);
  if (annotationTerrainModes.length === 0) {
    return map.walkableTerrainIds !== undefined
      ? new Set(map.walkableTerrainIds)
      : terrainIds;
  }

  const allowTerrainIds = new Set<number>();
  const blockTerrainIds = new Set<number>();
  for (const { mode, terrainIds: ids } of annotationTerrainModes) {
    for (const terrainId of ids) {
      if (mode === "allow") {
        allowTerrainIds.add(terrainId);
      } else {
        blockTerrainIds.add(terrainId);
      }
    }
  }

  const walkableTerrainIds = allowTerrainIds.size > 0 ? allowTerrainIds : terrainIds;
  for (const terrainId of blockTerrainIds) {
    walkableTerrainIds.delete(terrainId);
  }
  return walkableTerrainIds;
}

export function hasTerrainCollisionSourcesFor(annotations: AnnotationsJson): boolean {
  return annotations.layers.some((layer) => {
    const mode = layerCollisionMode(layer);
    return layer.terrainSource?.terrainIds !== undefined
      && layer.terrainSource.terrainIds.length > 0
      && mode !== undefined
      && mode !== null;
  });
}

function terrainCollisionModesFor(annotations: AnnotationsJson): Array<{
  mode: CollisionMode;
  terrainIds: number[];
}> {
  const modes: Array<{ mode: CollisionMode; terrainIds: number[] }> = [];
  for (const layer of annotations.layers) {
    if (!isCollisionLayer(layer)) {
      continue;
    }
    const mode = layerCollisionMode(layer);
    if (mode === null || mode === undefined) {
      continue;
    }
    const layerTerrainIds = layer.terrainSource?.terrainIds ?? [];
    if (layerTerrainIds.length > 0) {
      modes.push({ mode, terrainIds: layerTerrainIds });
    }
  }
  return modes;
}

function isCollisionLayer(layer: AnnotationsJson["layers"][number]): boolean {
  const mode = layerCollisionMode(layer);
  return mode !== undefined && mode !== null;
}

function layerCollisionMode(layer: AnnotationsJson["layers"][number]): CollisionMode | null | undefined {
  const isInteractionLayer = isNonCollisionInteractionLayer(layer);
  const inferredMode = inferCollisionModeFromLayerLabels(layer);
  if (isInteractionLayer) {
    return null;
  }
  if (inferredMode !== undefined) {
    return inferredMode;
  }
  return undefined;
}

/** Name-based walkability inference, shared by annotation layers and
 * tile-layer wang materials (e.g. "water" blocks, "grass" allows). */
export function collisionModeForLabel(label: string): CollisionMode | undefined {
  if (label.length === 0) {
    return undefined;
  }
  if (/\b(non|not|no)\s+walkable\b|\bunwalkable\b|\bblocked?\b|\bblocking\b|\bsolid\b|\bwall\b|\bwater\b|\bocean\b|\briver\b|\blake\b|\blava\b|\bcliff\b|\bvoid\b|\bhole\b|\bobstacle\b|\bbarrier\b|\bfence\b|\btrees?\b|\brocks?\b/.test(label)) {
    return "block";
  }
  if (/\bwalkable\b|\bpassable\b|\ballowed?\b|\bopen\b|\bground\b|\bgrass\b|\bpath\b|\broad\b|\bfloor\b|\bland\b|\bbridge\b|\bstairs?\b|\bstaircase\b|\bsteps?\b/.test(label)) {
    return "allow";
  }
  if (/\bcollisions?\b|\bcolliders?\b/.test(label)) {
    return "block";
  }
  return undefined;
}

function inferCollisionModeFromLayerLabels(layer: AnnotationsJson["layers"][number]): CollisionMode | undefined {
  return collisionModeForLabel(labelTextForLayer(layer));
}

function isNonCollisionInteractionArea(
  layer: AnnotationsJson["layers"][number],
  rect: Rectangle & { properties?: AnnotationProperties },
): boolean {
  return isNonCollisionInteractionLayer(layer)
    || hasWarpTargetProperty(rect.properties)
    || NON_COLLISION_INTERACTION_LABELS.test(labelTextForRect(rect));
}

function isNonCollisionInteractionLayer(layer: AnnotationsJson["layers"][number]): boolean {
  return hasWarpTargetProperty(layer.defaultProperties)
    || NON_COLLISION_INTERACTION_LABELS.test(labelTextForLayer(layer));
}

function labelTextForLayer(layer: AnnotationsJson["layers"][number]): string {
  return [
    layer.name,
    ...(layer.tags ?? []),
    ...(layer.terrainSource?.terrainNames ?? []),
    ...AREA_NAME_PROPERTY_NAMES.map((name) => stringProperty(layer.defaultProperties, name)),
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
}

function labelTextForRect(rect: Rectangle & { properties?: AnnotationProperties }): string {
  return [
    rect.id,
    ...AREA_NAME_PROPERTY_NAMES.map((name) => stringProperty(rect.properties, name)),
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
}

function hasWarpTargetProperty(properties: AnnotationProperties | undefined): boolean {
  return WARP_TARGET_PROPERTY_NAMES.some((name) => stringProperty(properties, name) !== undefined);
}

function stringProperty(properties: AnnotationProperties | undefined, key: string): string | undefined {
  const value = properties?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function objectBlockerRectsFor(objects: ObjectManifest): Rectangle[] {
  return objects.objects
    .filter((object) => object.visible)
    .map((object) => {
      const foot = objectFootRegion(object.boundingBox);
      return {
        id: object.filename,
        ...(object.groundBounds ?? {
          x: foot.centerX - foot.halfWidth,
          y: foot.centerY - foot.halfHeight,
          width: foot.halfWidth * 2,
          height: foot.halfHeight * 2,
        }),
      };
    });
}
