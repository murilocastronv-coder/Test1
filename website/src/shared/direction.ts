export const DIRECTIONS = [
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
  "east",
  "south-east",
] as const;

export type Direction = (typeof DIRECTIONS)[number];

export function directionFromVector(x: number, y: number): Direction {
  const angle = Math.atan2(y, x);
  const eighth = Math.round(angle / (Math.PI / 4));
  const index = (eighth + 8) % 8;
  return [
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
    "north",
    "north-east",
  ][index] as Direction;
}

export function vectorFromDirection(direction: Direction): { x: number; y: number } {
  switch (direction) {
    case "south":
      return { x: 0, y: 1 };
    case "south-west":
      return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    case "west":
      return { x: -1, y: 0 };
    case "north-west":
      return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    case "north":
      return { x: 0, y: -1 };
    case "north-east":
      return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    case "east":
      return { x: 1, y: 0 };
    case "south-east":
      return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  }
}
