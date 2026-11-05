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
import { JumpCounterExample } from "../net/JumpCounterExample";
import { FireProjectileSystem } from "../gameplay/FireProjectileSystem";
import { BearEncounter } from "../gameplay/BearEncounter";
import { CharacterSelection } from "../gameplay/CharacterSelection";
import { type Direction, vectorFromDirection } from "../shared/direction";

export class GameScene extends Phaser.Scene {
  private mapData!: LoadedMap;
  private player!: PlayerController;
  private agents: CharacterAgent[] = [];
  private hud!: HudOverlay;
  private multiplayer!: MultiplayerSystem;
  private fireProjectiles!: FireProjectileSystem;
  private encounter?: BearEncounter;
  private hudState = "";
  private characterSelection!: CharacterSelection;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.mapData = this.registry.get(MAP_DATA_REGISTRY_KEY) as LoadedMap;
    renderMap(this, this.mapData);
    const spawn = resolvePlayerSpawnPoint(this.mapData);
    this.fireProjectiles = new FireProjectileSystem(this);
    this.player = new PlayerController(this, this.mapData, spawn.x, spawn.y, {
      onSpellCast: (origin, direction) => this.fireProjectiles.cast(origin, direction),
      onSlashSwing: (origin, direction) => this.checkSlashHits(origin, direction),
    });
    this.agents = spawnNpcs(this, this.mapData);
    const bear = this.agents.find((agent) => agent.role === "bear");
    this.encounter = bear ? new BearEncounter(bear, this.player, this.mapData) : undefined;
    this.hudState = "";

    this.startGameplayCamera();

    this.hud = new HudOverlay();
    this.updateHud();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hud.destroy();
      this.multiplayer.destroy();
    });

    // === NEW SYSTEMS (add new module instances here) ===
    this.characterSelection = new CharacterSelection(this, this.player);

    // Real-time multiplayer: stream this player's position to the project worker and
    // render other connected players. Room = the current map name (one room per map).
    this.multiplayer = new MultiplayerSystem(
      this,
      () => ({ x: this.player.sprite.x, y: this.player.sprite.y }),
      this.mapData.map.name,
    );

    // EXAMPLE of persistent SERVER state (delete to remove): a global jump counter
    // shared by all players, stored in a Durable Object via /api/jumps.
    new JumpCounterExample(this);

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
    const vec = vectorFromDirection(direction);
    const range = GAME_CONFIG.combat.slashRange;
    const halfWidth = GAME_CONFIG.combat.slashWidth / 2;
    for (const agent of this.encounter ? [this.encounter] : []) {
      const dx = agent.sprite.x - origin.x;
      const dy = agent.sprite.y - origin.y;
      // Forward distance (dot product with facing direction)
      const forward = dx * vec.x + dy * vec.y;
      if (forward < 0 || forward > range) continue;
      // Perpendicular distance
      const side = Math.abs(dx * vec.y - dy * vec.x);
      if (side > halfWidth) continue;
      agent.hit(origin.x, origin.y, GAME_CONFIG.combat.knockbackStrength);
    }
  }

  update(_time: number, deltaMs: number): void {
    // Skip frame entirely if delta is too large (tab switch, initial load)
    // rather than clamping which makes characters move slowly
    if (deltaMs > 200) {
      return;
    }
    if (!this.encounter?.finished) this.player.update(deltaMs);
    this.fireProjectiles.update(deltaMs, this.encounter ? [this.encounter] : [], this.mapData);
    for (const agent of this.agents) {
      if (agent.role === "bear" && this.encounter?.finished) continue;
      agent.update(deltaMs);
    }
    this.encounter?.update(deltaMs);
    this.updateHud();
    // === NEW UPDATES (add new update calls here) ===
    this.characterSelection.update();
    this.multiplayer.update(deltaMs);
  }

  private updateHud(): void {
    const encounter = this.encounter;
    const state = encounter ? JSON.stringify(encounter.status) : "explore";
    if (state === this.hudState) return;
    this.hudState = state;
    this.hud.setText([
      "LORENCIA",
      encounter?.message ?? this.mapData.map.name,
      ...(encounter ? [`You ${encounter.status.playerHealth}/${encounter.status.playerMaxHealth} ${"♥".repeat(encounter.status.playerHealth)}  ·  Bear ${encounter.status.bearHealth}/${encounter.status.bearMaxHealth}`] : []),
      "WASD / arrows move · Shift runs · Space jumps",
      "J slash · L fireball",
    ]);
    // setText no longer wipes buttons (they are separate containers), so rebuild
    // them explicitly — this runs again on every status change, not just once.
    this.hud.clearButtons();
    if (encounter?.finished) this.hud.addButton("Play again", () => this.scene.restart());
  }
}
