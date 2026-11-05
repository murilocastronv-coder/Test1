export const MAP_FOLDER = "__PIXELLAB_TEMPLATE_MAP_ID__";
export const PLAYER_CHARACTER_ID = "__PIXELLAB_TEMPLATE_PLAYER_CHARACTER_ID__";
export const NPC_CHARACTER_ID = "__PIXELLAB_TEMPLATE_NPC_CHARACTER_ID__";
export const FARMER_GIRL_CHARACTER_ID = "__PIXELLAB_TEMPLATE_FARMER_GIRL_CHARACTER_ID__";
export const BEAR_CHARACTER_ID = "__PIXELLAB_TEMPLATE_BEAR_CHARACTER_ID__";

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
