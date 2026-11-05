import Phaser from "phaser";
import { GAME_CONFIG } from "../config";
import { HudOverlay } from "../hud/HudOverlay";
import { renderMap } from "../pixellab/renderMap";
import { resolvePlayerSpawnPoint } from "../pixellab/spawns";
import type { LoadedMap } from "../pixellab/types";
import { PlayerController } from "../player/PlayerController";
import { spawnNpcs } from "../npc/spawnNpcs";
import type { CharacterAgent } from "../npc/CharacterAgent";
import { MAP_DATA_REGISTRY_KEY } from "./BootScene";
import { MultiplayerSystem } from "../net/MultiplayerSystem";
import { RealmRpg } from "../gameplay/RealmRpg";
import { FireProjectileSystem } from "../gameplay/FireProjectileSystem";
import { type Direction } from "../shared/direction";

export class GameScene extends Phaser.Scene {
  private mapData!: LoadedMap;
  private player!: PlayerController;
  private agents: CharacterAgent[] = [];
  private hud!: HudOverlay;
  private multiplayer!: MultiplayerSystem;
  private fireProjectiles!: FireProjectileSystem;
  private rpg!: RealmRpg;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.mapData = this.registry.get(MAP_DATA_REGISTRY_KEY) as LoadedMap;
    renderMap(this, this.mapData);
    const spawn = resolvePlayerSpawnPoint(this.mapData);
    this.fireProjectiles = new FireProjectileSystem(this);
    this.player = new PlayerController(this, this.mapData, spawn.x, spawn.y, {
      onSpellCast: (origin, direction) => { if (this.rpg?.allowSpell() && !this.rpg.weaponRanged(origin, direction)) this.fireProjectiles.cast(origin, direction); },
      onSlashSwing: (origin, direction) => this.checkSlashHits(origin, direction),
    });
    this.agents = spawnNpcs(this, this.mapData);
    this.agents = this.agents.filter(agent => { if (agent.role === "bear") { agent.destroy(); return false; } return true; });

    this.startGameplayCamera();

    this.hud = new HudOverlay();
    this.hud.setText([]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.rpg.destroy();
      this.hud.destroy();
      this.multiplayer.destroy();
    });

    // === NEW SYSTEMS (add new module instances here) ===
    this.rpg = new RealmRpg(this, this.player, this.mapData);

    // Real-time multiplayer: stream this player's position to the project worker and
    // render other connected players. Room = the current map name (one room per map).
    this.multiplayer = new MultiplayerSystem(
      this,
      () => ({ x: this.player.sprite.x, y: this.player.sprite.y }),
      this.mapData.map.name,
    );

    // EXAMPLE of persistent SERVER state (delete to remove): a global jump counter
    // shared by all players, stored in a Durable Object via /api/jumps.


    // Focus canvas to ensure keyboard input and full frame rate from start.
    // tabIndex is required for canvas to be focusable (especially in iframes).
    this.game.canvas.tabIndex = 1;
    this.game.canvas.style.outline = "none";
    this.game.canvas.focus();

    // Signal to smoke test that game is fully loaded
    (window as unknown as Record<string, unknown>).gameReady = true;
  }

  private startGameplayCamera(): void {
    const camera = this.cameras.main;
    camera.setZoom(GAME_CONFIG.camera.zoom);
    camera.startFollow(this.player.sprite, true, GAME_CONFIG.camera.followLerp, GAME_CONFIG.camera.followLerp);
  }

  private checkSlashHits(origin: { x: number; y: number }, direction: Direction): void {
    this.rpg?.slash(origin, direction);
  }

  update(_time: number, deltaMs: number): void {
    // Skip frame entirely if delta is too large (tab switch, initial load)
    // rather than clamping which makes characters move slowly
    if (deltaMs > 200) {
      return;
    }
    if (this.rpg.active) this.player.update(deltaMs);
    if (this.rpg.active) this.fireProjectiles.update(deltaMs, this.rpg.targets, this.mapData);
    for (const agent of this.agents) {
      agent.update(deltaMs);
    }
    this.rpg.update(deltaMs);
    // === NEW UPDATES (add new update calls here) ===
    this.multiplayer.update(deltaMs);
  }

}
