export function terrainCellForPhaserWorld(value: number, tileSize: number): number {
  return Math.floor(value / tileSize + 0.5);
}
