export const MAP_FOLDER = "9e8b0141-7e5d-4f34-b786-101c31f900f0";
export const PLAYER_CHARACTER_ID = "3945e38c-3ead-4935-87ef-d72925f05ea0";
export const NPC_CHARACTER_ID = "6c13e221-8d92-41d1-aa00-3bd5ab5c05d8";
export const FARMER_GIRL_CHARACTER_ID = "deb24a9a-bcab-49e3-89b4-79187903b27a";
export const BEAR_CHARACTER_ID = "43eb7bb3-486f-46a5-a6db-c401e315505a";

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
