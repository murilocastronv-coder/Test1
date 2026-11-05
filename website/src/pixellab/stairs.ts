import type { AnnotationLayer, AnnotationsJson, Rectangle } from "./types";

export interface StairArea {
  id: string;
  rects: Rectangle[];
  axis: { x: number; y: number };
  minProjection: number;
  maxProjection: number;
}

const STAIR_LABEL = /\b(stairs?|staircase|steps?)\b/;
const MIN_STAIR_INPUT = 0.35;

export function stairAreasFor(annotations: AnnotationsJson): StairArea[] {
  return annotations.layers.flatMap((layer) => {
    const rects = layer.rects ?? [];
    if (!isStairLayer(layer) || rects.length === 0) {
      return [];
    }
    const axis = principalAxisFor(rects);
    const { minProjection, maxProjection } = projectionRangeFor(rects, axis);
    return [{ id: layer.id, rects, axis, minProjection, maxProjection }];
  });
}

export function isWithinStairSpan(stair: StairArea, x: number, y: number): boolean {
  const projection = x * stair.axis.x + y * stair.axis.y;
  return projection >= stair.minProjection && projection <= stair.maxProjection;
}

export function stairAreaAt(
  areas: StairArea[],
  x: number,
  y: number,
): StairArea | null {
  return areas.find((area) => area.rects.some((rect) => pointInsideRect(x, y, rect))) ?? null;
}

export function movementAlongStairs(
  input: { x: number; y: number },
  stair: StairArea,
): { x: number; y: number } {
  const along = input.x * stair.axis.x + input.y * stair.axis.y;
  if (Math.abs(along) < MIN_STAIR_INPUT) {
    return { x: 0, y: 0 };
  }
  const direction = Math.sign(along);
  return { x: stair.axis.x * direction, y: stair.axis.y * direction };
}

function isStairLayer(layer: AnnotationLayer): boolean {
  return [layer.name, ...(layer.tags ?? [])]
    .filter((label): label is string => typeof label === "string")
    .some((label) => STAIR_LABEL.test(normalizeLabel(label)));
}

/**
 * Derive the authored stair direction from its exported mask instead of
 * hard-coding a map-specific diagonal. The largest covariance axis follows
 * horizontal, vertical, and diagonal stair corridors alike.
 */
function principalAxisFor(rects: Rectangle[]): { x: number; y: number } {
  const samples = rects.map((rect) => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    weight: rect.width * rect.height,
    varianceX: rect.width ** 2 / 12,
    varianceY: rect.height ** 2 / 12,
  }));
  const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
  const meanX = samples.reduce((total, sample) => total + sample.x * sample.weight, 0) / totalWeight;
  const meanY = samples.reduce((total, sample) => total + sample.y * sample.weight, 0) / totalWeight;
  const varianceX = samples.reduce(
    (total, sample) => total + sample.weight * ((sample.x - meanX) ** 2 + sample.varianceX),
    0,
  ) / totalWeight;
  const varianceY = samples.reduce(
    (total, sample) => total + sample.weight * ((sample.y - meanY) ** 2 + sample.varianceY),
    0,
  ) / totalWeight;
  const covariance = samples.reduce(
    (total, sample) => total + sample.weight * (sample.x - meanX) * (sample.y - meanY),
    0,
  ) / totalWeight;
  const angle = Math.atan2(2 * covariance, varianceX - varianceY) / 2;
  let x = Math.cos(angle);
  let y = Math.sin(angle);
  if (y < 0 || (Math.abs(y) < Number.EPSILON && x < 0)) {
    x *= -1;
    y *= -1;
  }
  return { x, y };
}

function projectionRangeFor(
  rects: Rectangle[],
  axis: { x: number; y: number },
): { minProjection: number; maxProjection: number } {
  const projections = rects.flatMap((rect) => [
    rect.x * axis.x + rect.y * axis.y,
    (rect.x + rect.width) * axis.x + rect.y * axis.y,
    rect.x * axis.x + (rect.y + rect.height) * axis.y,
    (rect.x + rect.width) * axis.x + (rect.y + rect.height) * axis.y,
  ]);
  // A loop, not Math.min(...): stair rects come from map cells, and a spread
  // overflows the call stack past ~120k arguments.
  let minProjection = Infinity;
  let maxProjection = -Infinity;
  for (const projection of projections) {
    if (projection < minProjection) minProjection = projection;
    if (projection > maxProjection) maxProjection = projection;
  }
  return { minProjection, maxProjection };
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, " ");
}

function pointInsideRect(x: number, y: number, rect: Rectangle): boolean {
  return x >= rect.x
    && x < rect.x + rect.width
    && y >= rect.y
    && y < rect.y + rect.height;
}
