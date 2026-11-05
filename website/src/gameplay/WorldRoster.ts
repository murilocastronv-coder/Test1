import type Phaser from "phaser";
import { preloadCharacterAtlas } from "../shared/animation";
export const WING_MASTER = "886cef61-2e1b-4383-83c1-1336588c3261";
export const MONSTERS = [
  { id: "765a1ab1-0538-4101-9520-bae405d3cbd4", name: "Goblin Saqueador" },
  { id: "298c63d1-7fe8-4b3a-b9ec-dc7b3650aa30", name: "Guerreiro Esqueleto" },
  { id: "6446a239-4e41-4526-89f2-763f6ea9c9a6", name: "Demônio das Brasas" },
] as const;
export function preloadWorldRoster(scene: Phaser.Scene): void {
  for (const id of [WING_MASTER, ...MONSTERS.map(m => m.id)]) preloadCharacterAtlas(scene, id);
}
