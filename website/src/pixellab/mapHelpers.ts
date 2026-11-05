import Phaser from "phaser";
import type { PlayerController } from "../player/PlayerController";
import { loadPixelLabMap } from "./loadMap";
import { destroyRenderedMap, preloadMapAssets, renderMap, type RenderedMap } from "./renderMap";
import { resolveMapEntryPoint, type MapEntryOptions } from "./spawns";
import type { LoadedMap } from "./types";

export interface MapSwitchResult {
  mapData: LoadedMap;
  renderedMap: RenderedMap;
}

export type MapSwitchOptions = MapEntryOptions;

export async function loadAndPreloadMap(scene: Phaser.Scene, mapFolder: string): Promise<LoadedMap> {
  const mapData = await loadPixelLabMap(mapFolder);
  await preloadLoadedMapAssets(scene, mapData);
  return mapData;
}

export async function preloadLoadedMapAssets(scene: Phaser.Scene, mapData: LoadedMap): Promise<void> {
  if (scene.load.isLoading()) {
    throw new Error(`Cannot preload map ${mapData.folder} while the Phaser loader is already running`);
  }

  const queuedBefore = scene.load.list.size;
  preloadMapAssets(scene, mapData);
  if (scene.load.list.size === queuedBefore) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      scene.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
    };
    const onComplete = () => {
      cleanup();
      resolve();
    };
    const onLoadError = (file: Phaser.Loader.File) => {
      cleanup();
      reject(new Error(`Failed to preload map ${mapData.folder} asset ${file.key}`));
    };

    scene.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
    scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
    scene.load.start();
  });
}

export function replaceRenderedMap(
  scene: Phaser.Scene,
  mapData: LoadedMap,
  currentRenderedMap?: RenderedMap,
): RenderedMap {
  if (currentRenderedMap) {
    destroyRenderedMap(scene, currentRenderedMap);
  }
  return renderMap(scene, mapData);
}

export async function switchPlayerToMap(
  scene: Phaser.Scene,
  mapFolder: string,
  player: PlayerController,
  currentRenderedMap?: RenderedMap,
  options: MapSwitchOptions = {},
): Promise<MapSwitchResult> {
  const mapData = await loadAndPreloadMap(scene, mapFolder);
  const renderedMap = replaceRenderedMap(scene, mapData, currentRenderedMap);
  const spawn = resolveMapEntryPoint(mapData, options);
  player.setMapData(mapData);
  player.teleportTo(spawn.x, spawn.y);
  return { mapData, renderedMap };
}
