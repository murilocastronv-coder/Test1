export const MAP_FOLDER = "bc1bd264-859d-4d51-9acc-18eac3e24bb1";
export const PLAYER_CHARACTER_ID = "e60c571b-2e75-4810-bca9-eb8527b8b767";
export const NPC_CHARACTER_ID = "fc0ed64f-09b6-4f0c-951c-c1e8202f6e8e";
export const FARMER_GIRL_CHARACTER_ID = "076e6c4e-15ff-4c08-8172-cb49481ab5c8";
export const BEAR_CHARACTER_ID = "9580506c-a5b6-49af-983d-07b7dcc87b0b";

export const ASSET_ROOT = "assets";

const assetVersion = (import.meta as ImportMeta & {
  env?: { VITE_PIXELLAB_BUILD_ID?: string };
}).env?.VITE_PIXELLAB_BUILD_ID?.trim();

export function assetUrl(...parts: string[]): string {
  return versionedUrl([ASSET_ROOT, ...parts].join("/"));
}

export function publicAssetUrl(...parts: string[]): string {
  return versionedUrl(parts.join("/"));
}

export function projectImageUrl(imageId: string, file = "image.png"): string {
  return assetUrl("images", imageId, file);
}

export function projectImageFrameUrl(imageId: string, frameIndex: number): string {
  return assetUrl("images", imageId, "frames", `${frameIndex}.png`);
}

/** A project room's file: room.png (its picture) or metadata.json (doors, anchors, walkable rects). */
export function projectRoomUrl(roomId: string, file = "room.png"): string {
  return assetUrl("rooms", roomId, file);
}

function versionedUrl(path: string): string {
  return assetVersion ? `${path}?v=${encodeURIComponent(assetVersion)}` : path;
}
