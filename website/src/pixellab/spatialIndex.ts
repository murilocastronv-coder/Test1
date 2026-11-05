import type { Rectangle } from "./types";

export interface RectSpatialIndex<T extends Rectangle> {
  cellSize: number;
  cells: Map<string, T[]>;
  largeItems: T[];
}

const MAX_INDEXED_CELLS_PER_RECT = 128;

export function buildRectSpatialIndex<T extends Rectangle>(
  rects: T[],
  cellSize: number,
): RectSpatialIndex<T> {
  const cells = new Map<string, T[]>();
  const largeItems: T[] = [];

  for (const rect of rects) {
    const bounds = rectCellBounds(rect, cellSize);
    const cellCount = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
    if (cellCount > MAX_INDEXED_CELLS_PER_RECT) {
      largeItems.push(rect);
      continue;
    }

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const key = cellKey(x, y);
        const bucket = cells.get(key);
        if (bucket) {
          bucket.push(rect);
        } else {
          cells.set(key, [rect]);
        }
      }
    }
  }

  return { cellSize, cells, largeItems };
}

export function rectsNear<T extends Rectangle>(
  index: RectSpatialIndex<T>,
  rect: Rectangle,
): T[] {
  const bounds = rectCellBounds(rect, index.cellSize);
  const seen = new Set<T>();
  const result: T[] = [];

  for (const item of index.largeItems) {
    seen.add(item);
    result.push(item);
  }

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const bucket = index.cells.get(cellKey(x, y));
      if (!bucket) {
        continue;
      }
      for (const item of bucket) {
        if (seen.has(item)) {
          continue;
        }
        seen.add(item);
        result.push(item);
      }
    }
  }

  return result;
}

function rectCellBounds(rect: Rectangle, cellSize: number): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: Math.floor(rect.x / cellSize),
    minY: Math.floor(rect.y / cellSize),
    maxX: Math.floor((rect.x + Math.max(rect.width, 1)) / cellSize),
    maxY: Math.floor((rect.y + Math.max(rect.height, 1)) / cellSize),
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}
