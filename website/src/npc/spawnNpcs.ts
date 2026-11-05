import { GAME_CONFIG, TEMPLATE_SPAWNS } from "../config";
import {
  BEAR_CHARACTER_ID,
  FARMER_GIRL_CHARACTER_ID,
  NPC_CHARACTER_ID,
} from "../pixellab/templateAssetPaths";
import { resolveWalkableSpawnPoint } from "../pixellab/spawns";
import type { LoadedMap } from "../pixellab/types";
import {
  characterAtlasKey,
  characterManifest,
  preloadCharacterAtlas,
} from "../shared/animation";
import type { Collider } from "../shared/collision";
import { CharacterAgent } from "./CharacterAgent";

export function preloadNpcs(scene: Phaser.Scene): void {
  preloadCharacterAtlas(scene, NPC_CHARACTER_ID);
  preloadCharacterAtlas(scene, FARMER_GIRL_CHARACTER_ID);
  preloadCharacterAtlas(scene, BEAR_CHARACTER_ID);
}

export function spawnNpcs(scene: Phaser.Scene, mapData: LoadedMap): CharacterAgent[] {
  const npcCollider: Collider = {
    width: 8,
    height: 4,
    footOffsetY: GAME_CONFIG.npc.footOffsetY,
  };
  const bearCollider: Collider = {
    width: 8,
    height: 4,
    footOffsetY: GAME_CONFIG.npc.bearFootOffsetY,
  };
  const npcSpawn = resolveWalkableSpawnPoint(mapData, "npc", TEMPLATE_SPAWNS.npc, npcCollider);
  const farmerSpawn = resolveWalkableSpawnPoint(mapData, "farmer", TEMPLATE_SPAWNS.farmer, npcCollider);
  const bearSpawn = resolveWalkableSpawnPoint(mapData, "bear", TEMPLATE_SPAWNS.bear, bearCollider);

  const npcManifest = characterManifest(scene, NPC_CHARACTER_ID);
  const farmerManifest = characterManifest(scene, FARMER_GIRL_CHARACTER_ID);
  const bearManifest = characterManifest(scene, BEAR_CHARACTER_ID);

  const agents: CharacterAgent[] = [];
  if (npcSpawn) {
    agents.push(new CharacterAgent(scene, mapData, {
      atlasKey: characterAtlasKey(NPC_CHARACTER_ID),
      id: NPC_CHARACTER_ID,
      role: "npc",
      manifest: npcManifest,
      preferredClips: ["walk"],
      ...npcSpawn,
    }));
  }
  if (farmerSpawn) {
    agents.push(new CharacterAgent(scene, mapData, {
      atlasKey: characterAtlasKey(FARMER_GIRL_CHARACTER_ID),
      id: FARMER_GIRL_CHARACTER_ID,
      role: "farmer",
      manifest: farmerManifest,
      preferredClips: ["walk"],
      ...farmerSpawn,
    }));
  }
  if (bearSpawn) {
    agents.push(new CharacterAgent(scene, mapData, {
      atlasKey: characterAtlasKey(BEAR_CHARACTER_ID),
      id: BEAR_CHARACTER_ID,
      role: "bear",
      manifest: bearManifest,
      preferredClips: ["walk"],
      speed: GAME_CONFIG.npc.walkSpeed * 0.6,
      footOffsetY: GAME_CONFIG.npc.bearFootOffsetY,
      ...bearSpawn,
    }));
  }
  return agents;
}

export function destroyNpcs(agents: CharacterAgent[]): void {
  for (const agent of agents) {
    agent.destroy();
  }
  agents.length = 0;
}

export function replaceNpcs(
  currentAgents: CharacterAgent[],
  nextAgents: CharacterAgent[],
): CharacterAgent[] {
  destroyNpcs(currentAgents);
  return nextAgents;
}
