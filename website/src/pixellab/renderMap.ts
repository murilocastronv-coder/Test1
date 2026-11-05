import Phaser from "phaser";
import { assetUrl, publicAssetUrl } from "./templateAssetPaths";
import { preloadTerrainTilesets, renderTerrainTiles } from "./terrainRenderer";
import { preloadTileLayers, renderTileLayers } from "./tileLayers";
import { objectFootRegion, type LoadedMap } from "./types";

export interface RenderedMapObject {
  sprite: Phaser.GameObjects.Image;
  data: LoadedMap["objects"]["objects"][number];
}

export interface RenderedMap {
  mapData: LoadedMap;
  objects: RenderedMapObject[];
  destroy(): void;
}

export interface RenderMapOptions {
  replaceActive?: boolean;
}

const activeRenderedMaps = new WeakMap<Phaser.Scene, RenderedMap>();

export function mapObjectsAtlasKey(mapFolder: string): string {
  return `map-objects-${mapFolder}`;
}

export function destroyRenderedMap(scene: Phaser.Scene, renderedMap?: RenderedMap): void {
  const target = renderedMap ?? activeRenderedMaps.get(scene);
  target?.destroy();
}

export function preloadMapAssets(scene: Phaser.Scene, mapData: LoadedMap): void {
  preloadTerrainTilesets(scene, mapData);
  preloadTileLayers(scene, mapData);

  for (const overlay of mapData.map.overlays ?? []) {
    const key = mapAssetKey(mapData, "overlay", String(overlay.id));
    if (!scene.textures.exists(key)) {
      scene.load.image(key, assetUrl("maps", mapData.folder, "overlays", overlay.filename));
    }
  }

  // Maps without placed objects (e.g. pure tile-layer maps) have no packed
  // atlas — loading it anyway fetches the SPA index.html fallback and Phaser
  // throws "Unexpected token '<'" parsing HTML as JSON.
  if (mapData.objects.objects.length === 0) {
    return;
  }
  const objectsAtlasKey = mapObjectsAtlasKey(mapData.folder);
  if (!scene.textures.exists(objectsAtlasKey)) {
    scene.load.atlas(
      objectsAtlasKey,
      publicAssetUrl("atlases", `${objectsAtlasKey}.png`),
      publicAssetUrl("atlases", `${objectsAtlasKey}.json`),
    );
  }
}

export function renderMap(
  scene: Phaser.Scene,
  mapData: LoadedMap,
  options: RenderMapOptions = {},
): RenderedMap {
  if (options.replaceActive !== false) {
    destroyRenderedMap(scene);
  }

  const map = mapData.map;
  const bounds = map.mapConfig.boundingBox;
  const tileSize = map.mapConfig.tileSize;
  const worldOffsetX = (bounds.minX - 0.5) * tileSize;
  const worldOffsetY = (bounds.minY - 0.5) * tileSize;
  const gameObjects: Phaser.GameObjects.GameObject[] = [];
  const renderedObjects: RenderedMapObject[] = [];

  const terrainStats = renderTerrainTiles(scene, mapData);
  // One object per tile: a spread overflows the call stack past ~120k tiles.
  for (const tile of terrainStats.gameObjects) gameObjects.push(tile);
  const tileLayerStats = renderTileLayers(scene, mapData);
  for (const tile of tileLayerStats.gameObjects) gameObjects.push(tile);
  if (terrainStats.rendered === 0 && tileLayerStats.rendered === 0) {
    throw new Error(`Map ${mapData.folder} rendered no terrain tiles`);
  }

  for (const overlay of map.overlays ?? []) {
    const image = scene.add.image(overlay.worldCoordinates.x, overlay.worldCoordinates.y, mapAssetKey(mapData, "overlay", String(overlay.id)));
    image.setOrigin(0, 0);
    image.setDepth(-90000);
    gameObjects.push(image);
  }

  const objectsAtlasKey = mapObjectsAtlasKey(mapData.folder);
  for (const object of mapData.objects.objects) {
    if (!object.visible) {
      continue;
    }
    const box = object.boundingBox;
    const foot = objectFootRegion(box);
    const frameName = object.filename.replace(/\.png$/i, "");
    const sprite = scene.add.image(box.x + box.width / 2, box.y + box.height / 2, objectsAtlasKey, frameName);
    sprite.setDepth(foot.centerY);
    gameObjects.push(sprite);
    renderedObjects.push({ sprite, data: object });
  }

  const pixelWidth = map.mapConfig.dimensions.pixelWidth;
  const pixelHeight = map.mapConfig.dimensions.pixelHeight;
  scene.cameras.main.setBounds(worldOffsetX, worldOffsetY, pixelWidth, pixelHeight);

  let renderedMap: RenderedMap;
  renderedMap = {
    mapData,
    objects: renderedObjects,
    destroy(): void {
      for (const gameObject of gameObjects) {
        gameObject.destroy();
      }
      if (activeRenderedMaps.get(scene) === renderedMap) {
        activeRenderedMaps.delete(scene);
      }
    },
  };
  activeRenderedMaps.set(scene, renderedMap);
  return renderedMap;
}

export function mapAssetKey(mapData: LoadedMap, kind: string, name: string): string {
  return `${kind}-${mapData.folder}-${name}`;
}
