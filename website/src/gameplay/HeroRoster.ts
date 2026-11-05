import type Phaser from "phaser";
import { preloadCharacterAtlas, characterAssetUrl, characterManifest, characterRotationFrameName, selectCharacterState } from "../shared/animation";

export const HEROES = [
  { name: "Cavaleiro", id: "a186e0b5-46cf-4259-b791-d06d5dece872", description: "Armadura carmesim · resistência e combate próximo" },
  { name: "Feiticeiro", id: "e15cb620-66b4-457e-af22-7357de16bbef", description: "Mago arcano · vestes azuis e poder mágico" },
  { name: "Arqueiro", id: "d3c19f60-17ec-49ef-8b75-586ace0a2413", description: "Elfa esmeralda · arco e armadura verde" },
  { name: "Gladiador", id: "9af51a54-5b5a-4c0f-af85-e60403f64df9", description: "Guerreiro violeta · espada e armadura pesada" },
  { name: "Lorde Sombrio", id: "3a46a0b9-fba0-476d-9085-06ad60a89811", description: "Armadura negra e dourada · presença imponente" },
] as const;
export type HeroClass = typeof HEROES[number]["name"];
export function preloadHeroes(scene: Phaser.Scene): void {
  for (const hero of HEROES) preloadCharacterAtlas(scene, hero.id);
}
export function heroPreview(scene: Phaser.Scene, hero: typeof HEROES[number]): string {
  const state = selectCharacterState(characterManifest(scene, hero.id));
  return characterAssetUrl(hero.id, `${characterRotationFrameName(state.stateFolder, "south")}.png`);
}
