import Phaser from "phaser";
import { MATERIAL_WALKABILITY_OVERRIDES } from "../config";
import { collisionModeForLabel } from "./collision";
import { assetUrl } from "./templateAssetPaths";
import { TERRAIN_DEPTH } from "./terrainRenderer";
import type { LoadedMap } from "./types";

/**
 * Projected tile layers (isometric / oblique / hex / square-topdown stamps).
 *
 * Painted in the Map Editor's tile-layer subsystem and exported to
 * `tile-layers.json` + `tile-layers/<groupId>/tile_N.png`. Geometry is a port
 * of the export's `_tile_layer_*` helpers (api/app/endpoints/maps/export.py),
 * which mirror the editor's `computeTileShapeGeometry` — all three must agree
 * or runtime placement drifts from the editor/composite rendering.
 *
 * Anchors are in world pixels (same space as square terrain: tile (x, y)
 * top-left at x*tileSize) — the export pastes onto map-composite.png at
 * `spriteTopLeft - mapOriginPx`, so rendering at `spriteTopLeft` directly
 * matches the baked image.
 */

export interface TileLayerCell {
  q: number;
  r: number;
  layerY?: number;
  tileIndex: number;
}

export interface TileLayerRules {
  rule_type?: string;
  arity?: number;
  /** Corner wang: [upper, lower] material names; mask bit 1 = upper. */
  terrains?: string[];
  tiles?: Record<string, { mask: number }>;
  /** Exact fixed-frame corner-Wang geometry published by current generators. */
  top_face_px?: number;
  frame_px?: number;
  /** Horizontal pixels of lean per vertical pixel (0-1). */
  oblique_lean?: number;
  wall_depth_px?: number;
  /** Exact oblique Building ground lattice and one-storey rise. */
  ground_face_px?: number;
  stack_stride_px?: number;
}

export interface TileLayerJson {
  gridKind: string;
  tileGroupId: string;
  tileGroupName?: string;
  tileW: number;
  tileH: number;
  tileType?: string;
  tileView?: string;
  tileViewAngle?: number;
  tileDepthRatio?: number;
  tileHeight?: number;
  tileSize?: number;
  nTiles: number;
  role?: string | null;
  tileRules?: TileLayerRules | null;
  assetPaths: Record<string, string>;
  cells: TileLayerCell[];
}

export interface TileLayersJson {
  version: string;
  layers: TileLayerJson[];
}

export interface TileLayerStats {
  rendered: number;
  gameObjects: Phaser.GameObjects.GameObject[];
}

const GRID_KIND_TO_TILE_TYPE: Record<string, string> = {
  "hex-flat-top": "hex",
  "hex-pointy-top": "hex_pointy",
  iso: "isometric",
  oblique: "oblique",
  octagon: "octagon",
  "square-topdown": "square_topdown",
};

const VIEW_ANGLES: Record<string, number> = {
  "top-down": 90,
  "high top-down": 35,
  "low top-down": 20,
  side: 0,
};

const VIEW_VISIBILITY_FACTORS: Record<string, number> = {
  "top-down": 0.0,
  "high top-down": 0.82,
  "low top-down": 0.94,
  side: 1.0,
};

const DEFAULT_THICKNESS = 0.3;

function resolveTileType(layer: TileLayerJson): string {
  return layer.tileType ?? GRID_KIND_TO_TILE_TYPE[layer.gridKind] ?? "square_topdown";
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// --- lattice helpers (port of tile_shape_generator.py) ---

function flatTopHexLatticeVerticalPitchPx(hexHeight: number): number {
  const cy = hexHeight / 2;
  const ry = (hexHeight - 1) / Math.sqrt(3);
  const ys = [0, 1, 2, 3, 4, 5].map((i) => Math.round(cy + ry * Math.sin(radians(60 * i))));
  return Math.max(Math.max(...ys) - Math.min(...ys), 1);
}

function flatTopHexProjectedAxialTuneXyPx(tileW: number): { tuneX: number; tuneY: number } {
  const dw = Math.max(0, tileW - 32);
  return { tuneX: Math.round((2 * dw) / 32), tuneY: Math.round(dw / 32) };
}

function flatTopHexProjectedAxialHxPx(tileW: number): number {
  return 0.75 * tileW - flatTopHexProjectedAxialTuneXyPx(tileW).tuneX;
}

function flatTopHexProjectedAxialPyPx(tileW: number, hexHeight: number): number {
  return flatTopHexLatticeVerticalPitchPx(hexHeight) + 1 - flatTopHexProjectedAxialTuneXyPx(tileW).tuneY;
}

function hexPointyLatticeHorizontalPitchPx(tileW: number): number {
  const cx = tileW / 2;
  const rx = (tileW / 2 - 1) / Math.cos(radians(30));
  const xs = [0, 1, 2, 3, 4, 5].map((i) => Math.round(cx + rx * Math.cos(radians(60 * i + 30))));
  return Math.max(Math.max(...xs) - Math.min(...xs), 1);
}

function hexPointyLatticeVerticalSpanPx(hexHeight: number): number {
  const cy = hexHeight / 2;
  const ry = (hexHeight - 1) / 2;
  const ys = [0, 1, 2, 3, 4, 5].map((i) => Math.round(cy + ry * Math.sin(radians(60 * i + 30))));
  return Math.max(Math.max(...ys) - Math.min(...ys), 1);
}

function isoLatticeVerticalPeriodPx(topH: number): number {
  const span = topH - 2;
  return span >= 1 ? span : topH;
}

function isoLatticeHorizontalPeriodPx(tileW: number): number {
  const span = tileW - 2;
  return span >= 1 ? span : tileW;
}

function isoDiamondSpriteCentroidPx(tileW: number, topH: number): { icx: number; icy: number } {
  const hw = tileW / 2;
  const hh = topH / 2;
  const pts: Array<[number, number]> = [
    [Math.round(hw), 1],
    [tileW - 1, Math.trunc(hh + 0.5)],
    [Math.round(hw), topH - 1],
    [1, Math.trunc(hh + 0.5)],
  ];
  return {
    icx: pts.reduce((sum, [x]) => sum + x, 0) / 4,
    icy: pts.reduce((sum, [, y]) => sum + y, 0) / 4,
  };
}

// --- geometry (port of _resolved_tile_layer_depth_ratio / _tile_layer_geometry) ---

interface TileLayerGeometry {
  tileType: string;
  tileW: number;
  topH: number;
  imageH: number;
  /** Visible wall rows; a fixed frame can contain transparent rows below it. */
  wallDepth?: number;
}

interface PublishedObliqueGeometry {
  groundFacePx: number;
  framePx: number;
  wallDepthPx: number;
}

interface PublishedObliqueBuildingGeometry {
  groundFacePx: number;
  stackStridePx: number;
}

function logicalTileSize(layer: TileLayerJson): number {
  return typeof layer.tileSize === "number" && layer.tileSize > 0
    ? layer.tileSize
    : layer.tileW;
}

function publishedObliqueCornerGeometry(
  layer: TileLayerJson,
): PublishedObliqueGeometry | null {
  if (
    resolveTileType(layer) !== "oblique"
    || layer.tileRules?.rule_type !== "corner"
  ) {
    return null;
  }
  const rules = layer.tileRules;
  const values = [
    rules.top_face_px,
    rules.frame_px,
    rules.oblique_lean,
    rules.wall_depth_px,
  ];
  const present = values.map((value) => value !== undefined && value !== null);
  if (present.every((value) => !value)) {
    return null;
  }
  if (!present.every(Boolean)) {
    throw new Error(
      "oblique corner-Wang geometry requires top_face_px, frame_px, "
      + "oblique_lean, and wall_depth_px together",
    );
  }

  const groundFacePx = rules.top_face_px!;
  const framePx = rules.frame_px!;
  const wallDepthPx = rules.wall_depth_px!;
  const lean = rules.oblique_lean!;
  if (
    !Number.isInteger(groundFacePx)
    || groundFacePx < 1
    || groundFacePx > framePx
  ) {
    throw new Error(
      "oblique corner-Wang top_face_px must be a positive integer no larger than frame_px",
    );
  }
  if (!Number.isInteger(framePx) || framePx !== logicalTileSize(layer)) {
    throw new Error("oblique corner-Wang frame_px must equal tileSize");
  }
  if (
    !Number.isInteger(wallDepthPx)
    || wallDepthPx < 0
    || groundFacePx + wallDepthPx > framePx
  ) {
    throw new Error(
      "oblique corner-Wang wall_depth_px must be a non-negative integer that fits below top_face_px",
    );
  }
  if (!Number.isFinite(lean) || lean < 0 || lean > 1) {
    throw new Error("oblique corner-Wang oblique_lean must be 0.0-1.0");
  }
  return { groundFacePx, framePx, wallDepthPx };
}

function publishedObliqueBuildingGeometry(
  layer: TileLayerJson,
): PublishedObliqueBuildingGeometry | null {
  const rules = layer.tileRules;
  if (
    resolveTileType(layer) !== "oblique"
    || (rules?.rule_type !== "outline" && rules?.rule_type !== "composed")
    || typeof rules.ground_face_px !== "number"
    || typeof rules.stack_stride_px !== "number"
    || typeof rules.oblique_lean !== "number"
  ) {
    return null;
  }
  if (!Number.isInteger(rules.ground_face_px) || rules.ground_face_px < 1) {
    throw new Error("oblique Building ground_face_px must be a positive integer");
  }
  if (!Number.isInteger(rules.stack_stride_px) || rules.stack_stride_px < 1) {
    throw new Error("oblique Building stack_stride_px must be a positive integer");
  }
  if (
    !Number.isFinite(rules.oblique_lean)
    || rules.oblique_lean < 0
    || rules.oblique_lean > 1
  ) {
    throw new Error("oblique Building oblique_lean must be 0.0-1.0");
  }
  return {
    groundFacePx: rules.ground_face_px,
    stackStridePx: rules.stack_stride_px,
  };
}

function resolvedDepthRatio(layer: TileLayerJson): number {
  const tileW = layer.tileW;
  const rawThickness = layer.tileDepthRatio ?? DEFAULT_THICKNESS;
  const view = layer.tileView ?? "low top-down";
  const visibility = layer.tileViewAngle !== undefined && layer.tileViewAngle !== null
    ? Math.cos(radians(layer.tileViewAngle))
    : VIEW_VISIBILITY_FACTORS[view];
  const tileType = resolveTileType(layer);

  if (tileType === "oblique") {
    return layer.tileDepthRatio ?? 0.25;
  }

  const wxh = layer.tileHeight !== undefined && layer.tileHeight !== null && layer.tileHeight > tileW;
  const angle = layer.tileViewAngle ?? VIEW_ANGLES[view] ?? 20;
  const sinA = Math.sin(radians(angle));

  if (tileType === "square_topdown") {
    // The export's square rule since 0dd7636429 (top face = tileW * sin(angle)),
    // which this port missed: a 64px low top-down floor drew on 46px rows here
    // and on 22px rows in the editor and map-composite.png.
    const topH = sinA > 0.01 ? Math.max(Math.round(tileW * sinA), 2) : 0;
    const targetTotal = wxh
      ? tileW + rawThickness * (layer.tileHeight! - tileW)
      : topH + rawThickness * Math.max(0, tileW - topH);
    return tileW > 0 ? Math.max(0, targetTotal - topH) / tileW : 0;
  }

  if (!wxh) {
    return rawThickness * visibility;
  }

  const targetTotal = tileW + rawThickness * (layer.tileHeight! - tileW);

  let fullTopH: number;
  if (tileType === "hex") {
    fullTopH = Math.floor(tileW * 0.866);
  } else if (tileType === "hex_pointy") {
    const r = (tileW / 2 - 1) / Math.cos(radians(30));
    fullTopH = Math.trunc(2 * r) + 1;
  } else {
    fullTopH = tileW;
  }

  let topH: number;
  let depthBase: number;
  if (tileType === "isometric") {
    topH = sinA > 0.01 ? Math.max(Math.trunc(tileW * sinA), 2) : 0;
    depthBase = tileW * 0.5;
  } else {
    topH = sinA > 0.01 ? Math.max(Math.floor(fullTopH * sinA), 2) : 0;
    depthBase = fullTopH;
  }

  const targetDepth = Math.max(0, targetTotal - topH);
  return depthBase > 0 ? targetDepth / depthBase : 0;
}

export function tileLayerGeometry(layer: TileLayerJson): TileLayerGeometry {
  const tileType = resolveTileType(layer);
  const publishedCorner = publishedObliqueCornerGeometry(layer);
  if (publishedCorner) {
    return {
      tileType,
      tileW: publishedCorner.groundFacePx,
      topH: publishedCorner.groundFacePx,
      imageH: publishedCorner.framePx,
      wallDepth: publishedCorner.wallDepthPx,
    };
  }
  const publishedBuilding = publishedObliqueBuildingGeometry(layer);
  if (publishedBuilding) {
    const floorDepth = fixedFrameObliqueDepthPx(layer);
    return {
      tileType,
      tileW: publishedBuilding.groundFacePx,
      topH: publishedBuilding.groundFacePx,
      imageH: publishedBuilding.groundFacePx + floorDepth,
      wallDepth: floorDepth,
    };
  }

  const tileW = layer.tileW;
  const view = layer.tileView ?? "low top-down";
  const viewAngle = layer.tileViewAngle ?? VIEW_ANGLES[view] ?? 20;
  const dRatio = resolvedDepthRatio(layer);

  if (tileType === "oblique") {
    const depth = Math.min(Math.round(tileW * dRatio), tileW);
    return { tileType, tileW, topH: tileW, imageH: tileW + depth };
  }

  if (tileType === "square_topdown" && layer.tileRules?.rule_type === "corner") {
    // Published square corner-Wang sets carry their own face and frame
    // (export `_tile_layer_geometry`); both or neither.
    const face = layer.tileRules.top_face_px;
    const frame = layer.tileRules.frame_px;
    const given = [face, frame].filter((value) => value !== undefined && value !== null);
    if (given.length === 1) {
      throw new Error("square corner-Wang geometry requires top_face_px and frame_px together");
    }
    if (given.length === 2) {
      if (!Number.isInteger(face) || !Number.isInteger(frame) || face! < 1 || face! > frame!) {
        throw new Error("square corner-Wang top_face_px and frame_px must be positive integers, face <= frame");
      }
      return { tileType, tileW, topH: face!, imageH: frame! };
    }
  }

  if (tileType === "square_topdown") {
    const depth = Math.min(Math.round(tileW * dRatio), tileW);
    const topH = Math.max(Math.round(tileW * Math.sin(radians(viewAngle))), 2);
    return { tileType, tileW, topH, imageH: Math.max(topH + depth, layer.tileH, 1) };
  }

  let fullTopH: number;
  if (tileType === "hex") {
    fullTopH = Math.floor(tileW * 0.866);
  } else if (tileType === "hex_pointy") {
    const rHp = (tileW / 2 - 1) / Math.cos(radians(30));
    fullTopH = Math.trunc(2 * rHp) + 1;
  } else {
    fullTopH = tileW;
  }

  const topVis = Math.sin(radians(viewAngle));
  const topH = Math.max(Math.floor(fullTopH * topVis), 2);
  const depth = tileType === "isometric"
    ? Math.floor(tileW * dRatio * 0.5)
    : Math.floor(fullTopH * dRatio);
  return {
    tileType,
    tileW,
    topH,
    imageH: Math.max(topH + depth, layer.tileH, 1),
  };
}

// --- placement (port of _tile_layer_cell_anchor / _tile_layer_sprite_dest) ---

export function tileLayerStackStridePx(layer: TileLayerJson): number {
  const publishedBuilding = publishedObliqueBuildingGeometry(layer);
  if (publishedBuilding) {
    return publishedBuilding.stackStridePx;
  }
  const publishedCorner = publishedObliqueCornerGeometry(layer);
  if (publishedCorner) {
    return Math.max(1, publishedCorner.wallDepthPx);
  }
  const geom = tileLayerGeometry(layer);
  return Math.max(1, geom.imageH - geom.topH);
}

function obliqueLean(layer: TileLayerJson): number {
  const lean = layer.tileRules?.oblique_lean;
  if (typeof lean === "number") {
    return lean;
  }
  return layer.tileRules?.rule_type === "outline" || layer.tileRules?.rule_type === "composed"
    ? 0.5
    : 1;
}

/** Quantized shear repeated at each published storey, matching generator pixels. */
function publishedObliqueShearPx(layer: TileLayerJson, height: number): number {
  const stride = tileLayerStackStridePx(layer);
  const lean = obliqueLean(layer);
  const completeStoreys = Math.floor(height / stride);
  const remainder = height - completeStoreys * stride;
  const storeyShear = Math.floor(stride * lean + 0.5);
  if (remainder === 0) {
    return completeStoreys * storeyShear;
  }
  return (
    (completeStoreys + 1) * storeyShear
    - Math.floor((stride - remainder) * lean + 0.5)
  );
}

function tileLayerStackOffset(
  layer: TileLayerJson,
  layerY: number,
): { x: number; y: number } {
  const stride = tileLayerStackStridePx(layer) * layerY;
  if (resolveTileType(layer) !== "oblique") {
    return { x: 0, y: -stride };
  }
  const published = publishedObliqueCornerGeometry(layer) !== null
    || publishedObliqueBuildingGeometry(layer) !== null;
  const shear = published
    ? publishedObliqueShearPx(layer, stride)
    : Math.floor(stride * obliqueLean(layer));
  return { x: -shear, y: -stride };
}

function fixedFrameObliqueDepthPx(layer: TileLayerJson): number {
  const frame = logicalTileSize(layer);
  const ratio = layer.tileDepthRatio ?? 0.25;
  const maximumDepth = Math.floor(frame / 3 + 0.5);
  return Math.floor(maximumDepth * ratio + 0.5);
}

export function tileLayerCellAnchor(layer: TileLayerJson, q: number, r: number): { x: number; y: number } {
  const geom = tileLayerGeometry(layer);
  const { tileType, tileW, topH } = geom;
  if (tileType === "hex") {
    const hx = flatTopHexProjectedAxialHxPx(tileW);
    const py = flatTopHexProjectedAxialPyPx(tileW, topH);
    return { x: Math.round(hx * q), y: Math.round(py * (r + q / 2)) };
  }
  if (tileType === "hex_pointy") {
    const hx = hexPointyLatticeHorizontalPitchPx(tileW);
    const py = 0.75 * hexPointyLatticeVerticalSpanPx(topH);
    return { x: Math.round(hx * (q + r / 2)), y: Math.round(py * r) };
  }
  if (tileType === "isometric") {
    const vx = isoLatticeHorizontalPeriodPx(tileW);
    const vy = isoLatticeVerticalPeriodPx(topH);
    return { x: Math.round(((q - r) * vx) / 2), y: Math.round(((q + r) * vy) / 2) };
  }
  return { x: q * tileW + tileW / 2, y: r * topH + topH / 2 };
}

export function tileLayerSpriteTopLeft(
  layer: TileLayerJson,
  q: number,
  r: number,
  spriteWidth: number,
  spriteHeight: number,
  layerY: number,
): { x: number; y: number } {
  const geom = tileLayerGeometry(layer);
  const { tileType, tileW, topH } = geom;
  const layerOffset = tileLayerStackOffset(layer, layerY);
  const publishedBuilding = publishedObliqueBuildingGeometry(layer);
  if (publishedBuilding) {
    // Building frames include a padded footprint and the complete wall above
    // it. Pin the ground cell inside that native frame exactly as MapEditor
    // does; changing thickness must never change the ground lattice.
    const t = publishedBuilding.groundFacePx;
    const margin = Math.max(
      0,
      Math.floor(t / 2) - Math.max(4, Math.round(t * 0.2)),
    );
    const paddedGround = t + 2 * margin;
    const wallHeight = Math.max(0, spriteHeight - paddedGround);
    const frameLean = Math.max(0, spriteWidth - paddedGround);
    const slabShear = publishedObliqueShearPx(layer, fixedFrameObliqueDepthPx(layer));
    const groundOriginX = frameLean + margin - slabShear;
    const groundOriginY = wallHeight + margin;
    return {
      x: Math.round(q * t - groundOriginX) + layerOffset.x,
      y: Math.round(r * t - groundOriginY) + layerOffset.y,
    };
  }
  const anchorHeight = geom.wallDepth !== undefined
    ? geom.topH + geom.wallDepth
    : spriteHeight;
  if (tileType === "hex") {
    const hx = flatTopHexProjectedAxialHxPx(tileW);
    const py = flatTopHexProjectedAxialPyPx(tileW, topH);
    const ax = hx * q;
    const ay = py * (r + q / 2) + layerOffset.y;
    return { x: Math.round(ax - spriteWidth / 2), y: Math.round(ay - anchorHeight) };
  }
  if (tileType === "hex_pointy") {
    const hx = hexPointyLatticeHorizontalPitchPx(tileW);
    const py = 0.75 * hexPointyLatticeVerticalSpanPx(topH);
    const ax = hx * (q + r / 2);
    const ay = py * r + layerOffset.y;
    return { x: Math.round(ax - spriteWidth / 2), y: Math.round(ay - anchorHeight) };
  }
  if (tileType === "isometric") {
    const vx = isoLatticeHorizontalPeriodPx(tileW);
    const vy = isoLatticeVerticalPeriodPx(topH);
    const { icx } = isoDiamondSpriteCentroidPx(tileW, topH);
    const ax = ((q - r) * vx) / 2;
    const ay = ((q + r) * vy) / 2 + layerOffset.y;
    return { x: Math.round(ax - icx), y: Math.round(ay - anchorHeight) };
  }
  if (tileType === "octagon") {
    const anchor = tileLayerCellAnchor(layer, q, r);
    return {
      x: Math.round(anchor.x - spriteWidth / 2),
      y: Math.round(anchor.y - anchorHeight + layerOffset.y),
    };
  }
  return {
    x: Math.round(q * tileW) + layerOffset.x,
    y: Math.round((r + 1) * topH - anchorHeight) + layerOffset.y,
  };
}

/**
 * Southern tip of the cell's DRAWN ground face — same convention as
 * map-object foot depth, so characters standing in front (foot below this
 * line) draw over the tile and characters behind draw under it. Iso anchors
 * are the sprite's bottom tip (face drawn imageH - icy above);
 * square/oblique anchors are already the face centre.
 */
export function tileLayerFaceDepth(layer: TileLayerJson, q: number, r: number): number {
  const geom = tileLayerGeometry(layer);
  const anchor = tileLayerCellAnchor(layer, q, r);
  let faceCenterY = anchor.y;
  if (geom.tileType === "isometric") {
    faceCenterY = anchor.y - (geom.imageH - isoDiamondSpriteCentroidPx(geom.tileW, geom.topH).icy);
  } else if (geom.tileType === "square_topdown" || geom.tileType === "oblique") {
    // Bottom-anchored sprites draw the face one depth apron above the anchor
    // band — use the DRAWN face for depth like the pick does.
    faceCenterY = anchor.y - (geom.wallDepth ?? Math.max(0, geom.imageH - geom.topH));
  }
  return faceCenterY + geom.topH / 2;
}

function tileLayerSortValue(layer: TileLayerJson, cell: TileLayerCell): number {
  const layerY = cell.layerY ?? 0;
  const anchor = tileLayerCellAnchor(layer, cell.q, cell.r);
  return layerY * 1e12 + anchor.y * 1e6 + anchor.x;
}

// --- world → cell (port of ProjectedTileLayer.worldToCell, formula variant) ---

export function tileLayerWorldToCell(layer: TileLayerJson, worldX: number, worldY: number): { q: number; r: number } {
  const geom = tileLayerGeometry(layer);
  const { tileType, tileW, topH } = geom;
  if (tileType === "isometric") {
    const vx = isoLatticeHorizontalPeriodPx(tileW);
    const vy = isoLatticeVerticalPeriodPx(topH);
    const { icy } = isoDiamondSpriteCentroidPx(tileW, topH);
    // Sprites draw with their bottom at the lattice anchor, so the visible
    // top face is centred (imageH - icy) above it — a world point (character
    // foot, mouse pick) belongs to the cell whose DRAWN face contains it.
    const wyPick = worldY + (geom.imageH - icy);
    const q = wyPick / vy + worldX / vx;
    const r = wyPick / vy - worldX / vx;
    return { q: Math.round(q), r: Math.round(r) };
  }
  if (tileType === "hex") {
    const hx = flatTopHexProjectedAxialHxPx(tileW);
    const py = flatTopHexProjectedAxialPyPx(tileW, topH);
    return { q: Math.round(worldX / hx), r: Math.round(worldY / py - worldX / (2 * hx)) };
  }
  if (tileType === "hex_pointy") {
    const hx = hexPointyLatticeHorizontalPitchPx(tileW);
    const py = 0.75 * hexPointyLatticeVerticalSpanPx(topH);
    return { q: Math.round(worldX / hx - worldY / (2 * py)), r: Math.round(worldY / py) };
  }
  if (tileType === "octagon") {
    return { q: Math.floor(worldX / tileW), r: Math.floor(worldY / topH) };
  }
  // square_topdown / oblique: sprites are bottom-anchored at (r+1)*topH, so
  // the drawn top face sits one visible wall apron above the raw row band
  // (editor: ProjectedTileLayer.worldToVertex). Fixed frames can have
  // transparent padding below that wall, which must not move the pick.
  const apron = geom.wallDepth ?? Math.max(0, geom.imageH - topH);
  return { q: Math.floor(worldX / tileW), r: Math.floor((worldY + apron) / topH) };
}

// --- rendering ---

function tileTextureKey(mapFolder: string, groupId: string, tileIndex: number): string {
  return `tile-layer-${mapFolder}-${groupId}-${tileIndex}`;
}

export function paintedTileLayers(mapData: LoadedMap): TileLayerJson[] {
  return (mapData.tileLayers?.layers ?? []).filter((layer) => layer.cells.length > 0);
}

export function preloadTileLayers(scene: Phaser.Scene, mapData: LoadedMap): void {
  for (const layer of paintedTileLayers(mapData)) {
    for (const [index, path] of Object.entries(layer.assetPaths)) {
      const key = tileTextureKey(mapData.folder, layer.tileGroupId, Number(index));
      if (!scene.textures.exists(key)) {
        scene.load.image(key, assetUrl("maps", mapData.folder, ...path.split("/")));
      }
    }
  }
}

/**
 * Occluding cells take part in the world y-sort (characters can walk behind
 * them); ground cells stay in the flat terrain band. Raised cells
 * (layerY > 0) and structure-role layers (building kit walls) occlude.
 */
function isOccludingCell(layer: TileLayerJson, cell: TileLayerCell): boolean {
  return (cell.layerY ?? 0) > 0 || layer.role === "structure";
}

/**
 * Only cliff-front tiles belong in the world y-sort: a raised cell whose
 * drawn southern edges adjoin equal-or-higher cells is interior plateau
 * floor — nothing vertical faces the camera, so y-sorting it would overdraw
 * the feet of characters standing on neighbouring cells. Structure walls
 * always occlude.
 */
function isFrontExposed(mapData: LoadedMap, layer: TileLayerJson, cell: TileLayerCell): boolean {
  if (layer.role === "structure") {
    return true;
  }
  const cellLevels = mapData.tileLayerWalkability?.cellLevels;
  if (!cellLevels) {
    return true;
  }
  const level = cell.layerY ?? 0;
  const southNeighbours = resolveTileType(layer) === "isometric"
    ? [[cell.q + 1, cell.r], [cell.q, cell.r + 1]]
    : [[cell.q, cell.r + 1]];
  return southNeighbours.some(([q, r]) => (cellLevels.get(`${q},${r}`) ?? 0) < level);
}

export function renderTileLayers(scene: Phaser.Scene, mapData: LoadedMap): TileLayerStats {
  const stats: TileLayerStats = { rendered: 0, gameObjects: [] };
  for (const layer of paintedTileLayers(mapData)) {
    const sortedCells = [...layer.cells].sort(
      (a, b) => tileLayerSortValue(layer, a) - tileLayerSortValue(layer, b),
    );
    for (const [paintOrder, cell] of sortedCells.entries()) {
      const key = tileTextureKey(mapData.folder, layer.tileGroupId, cell.tileIndex);
      if (!scene.textures.exists(key)) {
        throw new Error(
          `Tile layer ${layer.tileGroupId} tile ${cell.tileIndex} has no texture — `
          + `missing from tile-layers.json assetPaths or preload not run`,
        );
      }
      const source = scene.textures.get(key).getSourceImage();
      const publishedCorner = publishedObliqueCornerGeometry(layer);
      if (
        publishedCorner
        && (
          source.width !== publishedCorner.framePx
          || source.height !== publishedCorner.framePx
        )
      ) {
        throw new Error(
          `Oblique corner-Wang tile ${cell.tileIndex} is ${source.width}x${source.height}; `
          + `expected native ${publishedCorner.framePx}x${publishedCorner.framePx}`,
        );
      }
      const layerY = cell.layerY ?? 0;
      const topLeft = tileLayerSpriteTopLeft(
        layer,
        cell.q,
        cell.r,
        source.width,
        source.height,
        layerY,
      );
      const image = scene.add.image(topLeft.x, topLeft.y, key);
      image.setOrigin(0, 0);
      if (isOccludingCell(layer, cell) && isFrontExposed(mapData, layer, cell)) {
        // Depth = south tip of the DRAWN face (lifted by the stack level):
        // a character whose feet are below this line stands in front of the
        // face and draws over the tile; feet above it means the character is
        // behind the face and the tile draws over them. Using the base
        // footprint here made front tiles swallow characters standing in
        // the walkable strip their lifted face vacates.
        image.setDepth(
          tileLayerFaceDepth(layer, cell.q, cell.r) - tileLayerStackStridePx(layer) * layerY,
        );
      } else {
        image.setDepth(TERRAIN_DEPTH + (paintOrder + 1) * 1e-4);
      }
      stats.rendered += 1;
      stats.gameObjects.push(image);
    }
  }
  return stats;
}

// --- walkability ---

export interface TileLayerWalkability {
  /** Geometry source for world→cell lookups. */
  layer: TileLayerJson;
  /** Pixels one elevation level lifts a drawn face above the base lattice. */
  stridePx: number;
  /** Highest level present in cellLevels (0 on flat maps). */
  maxLevel: number;
  /**
   * Standing level per painted, enterable cell: 0 = ground floor, N = top of
   * a tile stacked at layerY N. Whether a character may step between levels
   * is the mover's business (collider maxStepUp/maxStepDown).
   */
  cellLevels: Map<string, number>;
  /** Cells no character may enter at any level (structure walls, water-like material). */
  blockedCells: Set<string>;
}

/**
 * Corner-wang layers know their two materials (tileRules.terrains, mask bit
 * 1 = upper / 0 = lower). A cell whose material is uniformly water-like
 * (`collisionModeForLabel` → block) is unwalkable; mixed coastline cells stay
 * walkable so the shoreline is reachable. Authored collision annotations
 * still override either way.
 */
function materialBlocksCell(layer: TileLayerJson, cell: TileLayerCell): boolean {
  const rules = layer.tileRules;
  if (!rules || rules.rule_type !== "corner" || rules.terrains?.length !== 2) {
    return false;
  }
  const mask = rules.tiles?.[`tile_${cell.tileIndex}`]?.mask ?? cell.tileIndex;
  const bits = (mask & 0b1111).toString(2).split("1").length - 1;
  if (bits !== 0 && bits !== 4) {
    return false;
  }
  const material = (bits === 4 ? rules.terrains[0] : rules.terrains[1]).toLowerCase();
  const mode = MATERIAL_WALKABILITY_OVERRIDES[material] ?? collisionModeForLabel(material);
  return mode === "block";
}

export function tileLayerWalkabilityFor(mapData: LoadedMap): TileLayerWalkability | null {
  const layers = paintedTileLayers(mapData);
  if (layers.length === 0) {
    return null;
  }
  // Layers of one map share a lattice; use the densest layer for geometry.
  const layer = layers.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  const cellLevels = new Map<string, number>();
  const blockedCells = new Set<string>();
  for (const l of layers) {
    for (const cell of l.cells) {
      const key = `${cell.q},${cell.r}`;
      // Structure layers (building-kit walls) are solid regardless of level;
      // raised terrain tiles are standable surfaces at their layerY.
      if (l.role === "structure" || materialBlocksCell(l, cell)) {
        blockedCells.add(key);
      } else {
        const level = cell.layerY ?? 0;
        cellLevels.set(key, Math.max(cellLevels.get(key) ?? 0, level));
      }
    }
  }
  let maxLevel = 0;
  for (const level of cellLevels.values()) {
    maxLevel = Math.max(maxLevel, level);
  }
  return { layer, stridePx: tileLayerStackStridePx(layer), maxLevel, cellLevels, blockedCells };
}

export type TileLayerStanding =
  | { kind: "blocked" }
  | { kind: "empty" }
  | { kind: "surface"; level: number; q: number; r: number };

/**
 * Which drawn top face is under a world point — the mover-facing mirror of
 * the editor's `ProjectedTileLayer.hitTestPaintedCell`: the pick for stack
 * level L reverses that level's complete (shear, rise) offset and the topmost
 * painted level wins. Character positions live in DRAWN space, so a raised
 * cell is entered exactly when the foot visually touches its lifted face,
 * never its base footprint.
 * "empty" includes the drawn side face of a cliff (no face to stand on).
 */
export function tileLayerStandingAt(
  walkability: TileLayerWalkability,
  worldX: number,
  worldY: number,
): TileLayerStanding {
  for (let level = walkability.maxLevel; level >= 0; level -= 1) {
    const layerOffset = tileLayerStackOffset(walkability.layer, level);
    const { q, r } = tileLayerWorldToCell(
      walkability.layer,
      worldX - layerOffset.x,
      worldY - layerOffset.y,
    );
    const key = `${q},${r}`;
    if (level === 0 && walkability.blockedCells.has(key)) {
      return { kind: "blocked" };
    }
    if (walkability.cellLevels.get(key) === level) {
      return { kind: "surface", level, q, r };
    }
  }
  return { kind: "empty" };
}

export interface TileLayerElevation {
  level: number;
  /** Depth override while standing on a raised face (over the stood-on block, under blocks further south); null at ground level. */
  depth: number | null;
}

export function tileLayerElevationAt(
  walkability: TileLayerWalkability,
  worldX: number,
  worldY: number,
): TileLayerElevation {
  const standing = tileLayerStandingAt(walkability, worldX, worldY);
  if (standing.kind !== "surface" || standing.level === 0) {
    return { level: 0, depth: null };
  }
  // One row of depth headroom: same-level tiles are the floor being walked
  // on and must never draw over the character — their images can overlap the
  // sprite from up to one row south, and each row adds `rowPitch` depth.
  const anchor = tileLayerCellAnchor(walkability.layer, standing.q, standing.r);
  const rowPitch = tileLayerCellAnchor(walkability.layer, standing.q, standing.r + 1).y - anchor.y;
  return {
    level: standing.level,
    depth: tileLayerFaceDepth(walkability.layer, standing.q, standing.r)
      - walkability.stridePx * standing.level + rowPitch + 1,
  };
}
