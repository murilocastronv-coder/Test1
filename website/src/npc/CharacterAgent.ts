import { GAME_CONFIG } from "../config";
import type { LoadedMap } from "../pixellab/types";
import {
  CharacterAnimationResolver,
  SpriteAnimator,
  characterRotationFrameName,
  selectCharacterState,
  type AnimationMap,
  type CharacterAnimationResolution,
  type CharacterManifest,
} from "../shared/animation";
import { moveWithCollision, type Collider } from "../shared/collision";
import { setYDepth } from "../shared/depth";
import { DIRECTIONS, type Direction } from "../shared/direction";
import { findPath, nearestWalkable, type Point } from "../shared/navigation";

type AgentMode = "idle" | "walk" | "attack";

const WANDER_RADIUS_TILES = 5;
const WANDER_TARGET_ATTEMPTS = 8;
const ARRIVE_THRESHOLD_TILES = 0.35;
const BLOCKED_REPATH_MS = 180;

interface CharacterAgentConfigBase {
  atlasKey: string;
  id?: string;
  role?: string;
  x: number;
  y: number;
  speed?: number;
  footOffsetY?: number;
  roaming?: boolean;
  direction?: Direction;
}

interface CharacterAgentManifestConfig extends CharacterAgentConfigBase {
  manifest: CharacterManifest;
  state?: string;
  preferredClips?: string[];
  stateFolder?: never;
  animations?: never;
}

interface CharacterAgentAnimationConfig extends CharacterAgentConfigBase {
  manifest?: never;
  state?: never;
  preferredClips?: never;
  stateFolder: string;
  animations: AnimationMap;
}

export type CharacterAgentConfig = CharacterAgentManifestConfig | CharacterAgentAnimationConfig;

interface AgentPose {
  stateFolder: string;
  directions: Direction[];
}

function usesManifest(
  config: CharacterAgentConfig,
): config is CharacterAgentManifestConfig {
  return config.manifest !== undefined;
}

export class CharacterAgent {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly id?: string;
  readonly role?: string;

  private readonly animator: SpriteAnimator;
  private readonly collider: Collider;
  private readonly speed: number;
  private readonly hasAttack: boolean;
  private readonly pose: AgentPose;
  private readonly manualAnimations: AnimationMap | undefined;
  private readonly animationResolver: CharacterAnimationResolver | undefined;
  private mode: AgentMode = "idle";
  private direction: Direction = "south";
  private stateElapsedMs = 0;
  private stateDurationMs = 1200;
  private path: Point[] = [];
  private pathIndex = 0;
  private blockedElapsedMs = 0;
  private readonly arriveThreshold: number;
  private talking = false;
  private roaming: boolean;
  private hitStunMs = 0;
  private knockbackVx = 0;
  private knockbackVy = 0;
  private controlled = false;

  constructor(
    scene: Phaser.Scene,
    private readonly mapData: LoadedMap,
    config: CharacterAgentConfig,
  ) {
    const direction = config.direction ?? "south";
    let stateFolder: string;
    let animations: AnimationMap;
    let poseDirections: Direction[];
    let manualAnimations: AnimationMap | undefined;
    let animationResolver: CharacterAnimationResolver | undefined;
    if (usesManifest(config)) {
      const selected = selectCharacterState(config.manifest, {
        state: config.state,
        preferredClips: config.preferredClips,
      });
      stateFolder = selected.stateFolder;
      animations = selected.animations;
      poseDirections = selected.state.directions.filter(
          (value): value is Direction => DIRECTIONS.includes(value as Direction),
      );
      manualAnimations = undefined;
      animationResolver = new CharacterAnimationResolver(
        config.manifest,
        config.state,
      );
    } else {
      stateFolder = config.stateFolder;
      animations = config.animations;
      poseDirections = this.animationDirections(animations);
      manualAnimations = animations;
      animationResolver = undefined;
    }
    this.pose = {
      stateFolder,
      directions: poseDirections,
    };
    this.manualAnimations = manualAnimations;
    this.animationResolver = animationResolver;
    this.sprite = scene.add.sprite(
      config.x,
      config.y,
      config.atlasKey,
      characterRotationFrameName(stateFolder, direction),
    );
    setYDepth(this.sprite, config.y + (config.footOffsetY ?? GAME_CONFIG.npc.footOffsetY));
    this.id = config.id;
    this.role = config.role;
    this.animator = new SpriteAnimator(
      this.sprite,
      config.atlasKey,
      animations,
      stateFolder,
      poseDirections,
    );
    this.speed = config.speed ?? GAME_CONFIG.npc.walkSpeed;
    this.roaming = config.roaming ?? true;
    this.direction = direction;
    this.hasAttack = this.animationResolver
      ? this.resolveAnimation(["attack"]) !== undefined
      : this.animator.hasClip("attack");
    this.collider = {
      width: 8,
      height: 4,
      footOffsetY: config.footOffsetY ?? GAME_CONFIG.npc.footOffsetY,
    };
    this.arriveThreshold = ARRIVE_THRESHOLD_TILES * mapData.map.mapConfig.tileSize;
    this.playMode("idle");
    if (this.roaming) {
      this.chooseNextState();
    }
  }

  update(deltaMs: number): void {
    if (this.hitStunMs > 0) {
      // Controlled hurt/death clips must keep advancing during knockback stun.
      if (this.controlled) this.animator.update(deltaMs);
      this.hitStunMs -= deltaMs;
      if (Math.abs(this.knockbackVx) > 1 || Math.abs(this.knockbackVy) > 1) {
        const moved = moveWithCollision(
          this.mapData, this.sprite.x, this.sprite.y,
          this.knockbackVx * (deltaMs / 1000),
          this.knockbackVy * (deltaMs / 1000),
          this.collider,
        );
        this.sprite.setPosition(moved.x, moved.y);
        const decay = Math.exp(-deltaMs / 50);
        this.knockbackVx *= decay;
        this.knockbackVy *= decay;
      }
      setYDepth(this.sprite, this.sprite.y + this.collider.footOffsetY);
      if (this.hitStunMs <= 0) {
        this.hitStunMs = 0;
        this.sprite.clearTint();
      }
      return;
    }

    if (this.controlled) {
      this.animator.update(deltaMs);
      setYDepth(this.sprite, this.sprite.y + this.collider.footOffsetY);
      return;
    }

    if (this.talking || !this.roaming) {
      this.playMode("idle");
      this.animator.update(deltaMs);
      setYDepth(this.sprite, this.sprite.y + this.collider.footOffsetY);
      return;
    }

    this.stateElapsedMs += deltaMs;
    if (this.stateElapsedMs >= this.stateDurationMs) {
      this.chooseNextState();
    }

    if (this.mode === "walk") {
      this.followPath(deltaMs);
    }

    this.playMode(this.mode);
    setYDepth(this.sprite, this.sprite.y + this.collider.footOffsetY);
    this.animator.update(deltaMs);
  }

  destroy(): void {
    this.clearPath();
    this.sprite.destroy();
  }

  setDirection(direction: Direction): void {
    this.direction = direction;
    this.playMode(this.talking ? "idle" : this.mode);
  }

  lookAt(target: { x: number; y: number } | Direction): void {
    if (typeof target === "string") {
      this.setDirection(target);
      return;
    }

    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    this.setDirection(
      Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? "east" : "west")
        : (dy > 0 ? "south" : "north"),
    );
  }

  startTalking(): void {
    this.talking = true;
    this.playMode("idle");
  }

  stopTalking(): void {
    this.talking = false;
  }

  releaseDirectionControl(): void {
    this.stateElapsedMs = 0;
    if (this.roaming && !this.talking) {
      this.mode = "walk";
      this.stateDurationMs = this.range(GAME_CONFIG.npc.walkMinMs, GAME_CONFIG.npc.walkMaxMs);
      this.pickWanderPath();
      this.playMode("walk");
    }
  }

  startRoaming(immediate = true): void {
    this.talking = false;
    this.roaming = true;
    if (immediate) {
      this.mode = "walk";
      this.stateElapsedMs = 0;
      this.stateDurationMs = this.range(GAME_CONFIG.npc.walkMinMs, GAME_CONFIG.npc.walkMaxMs);
      this.pickWanderPath();
      this.playMode("walk");
    }
  }

  stopRoaming(): void {
    this.roaming = false;
    this.mode = "idle";
    this.stateElapsedMs = 0;
    this.stateDurationMs = this.range(GAME_CONFIG.npc.idleMinMs, GAME_CONFIG.npc.idleMaxMs);
    this.clearPath();
    this.playMode("idle");
  }

  get hitRadius(): number {
    return GAME_CONFIG.combat.npcHitRadius;
  }

  get stunned(): boolean {
    return this.hitStunMs > 0;
  }

  holdControlled(direction: Direction): void {
    this.controlled = true;
    this.direction = direction;
    this.animator.setPose(direction, this.pose.stateFolder, this.pose.directions);
  }

  /** Let a gameplay controller own movement and select an exact manifest clip. */
  playControlled(clip: string, direction: Direction, restart = false): number {
    this.controlled = true;
    this.direction = direction;
    const resolved = this.resolveAnimation([clip]);
    if (!resolved) throw new Error(`Missing controlled animation: ${clip}`);
    this.animator.setAnimationMap(resolved.animations, resolved.stateFolder, this.pose.directions);
    if (restart) this.animator.setPose(direction, resolved.stateFolder, this.pose.directions);
    this.animator.setClip(resolved.clipName, direction, resolved.stateFolder);
    return resolved.animation.frame_count * 1000 / (resolved.animation.fps ?? GAME_CONFIG.animation.fps);
  }

  /** Apply a hit: knockback away from (fromX, fromY), brief stun + red flash. */
  hit(fromX: number, fromY: number, strength: number): boolean {
    if (this.hitStunMs > 0) return false;
    const dx = this.sprite.x - fromX;
    const dy = this.sprite.y - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    this.knockbackVx = (dx / dist) * strength;
    this.knockbackVy = (dy / dist) * strength;
    this.hitStunMs = GAME_CONFIG.combat.hitStunMs;
    this.sprite.setTint(0xff4444);
    return true;
  }

  private chooseNextState(): void {
    this.stateElapsedMs = 0;
    this.blockedElapsedMs = 0;
    const roll = Math.random();
    this.direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];

    if (this.hasAttack && roll < GAME_CONFIG.npc.attackChance) {
      this.mode = "attack";
      this.stateDurationMs = 900;
      this.clearPath();
      return;
    }

    if (roll < 0.5) {
      this.mode = "idle";
      this.stateDurationMs = this.range(GAME_CONFIG.npc.idleMinMs, GAME_CONFIG.npc.idleMaxMs);
      this.clearPath();
    } else {
      this.mode = "walk";
      this.stateDurationMs = this.range(GAME_CONFIG.npc.walkMinMs, GAME_CONFIG.npc.walkMaxMs);
      this.pickWanderPath();
    }
  }

  private followPath(deltaMs: number): void {
    if (this.path.length === 0 || this.pathIndex >= this.path.length) {
      if (!this.pickWanderPath()) {
        this.chooseNextState();
        return;
      }
    }

    const target = this.path[this.pathIndex];
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= this.arriveThreshold) {
      this.pathIndex += 1;
      if (this.pathIndex >= this.path.length) {
        this.chooseNextState();
      }
      return;
    }

    const step = this.speed * (deltaMs / 1000);
    const scale = Math.min(step / distance, 1);
    const nextX = dx * scale;
    const nextY = dy * scale;

    const moved = moveWithCollision(
      this.mapData,
      this.sprite.x,
      this.sprite.y,
      nextX,
      nextY,
      this.collider,
    );
    if (moved.x === this.sprite.x && moved.y === this.sprite.y) {
      this.blockedElapsedMs += deltaMs;
      if (this.blockedElapsedMs >= BLOCKED_REPATH_MS) {
        this.chooseNextState();
      }
      return;
    }

    this.blockedElapsedMs = 0;
    this.direction = this.directionFromDelta(
      moved.x - this.sprite.x,
      moved.y - this.sprite.y,
    );
    this.sprite.setPosition(moved.x, moved.y);
  }

  private pickWanderPath(): boolean {
    const tileSize = this.mapData.map.mapConfig.tileSize;
    for (let attempt = 0; attempt < WANDER_TARGET_ATTEMPTS; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = tileSize * this.range(2, WANDER_RADIUS_TILES);
      const target = nearestWalkable(
        this.mapData,
        {
          x: this.sprite.x + Math.cos(angle) * distance,
          y: this.sprite.y + Math.sin(angle) * distance,
        },
        this.collider,
        2,
      );
      if (target === null) {
        continue;
      }

      const path = findPath(this.mapData, this.sprite, target, this.collider);
      if (path !== null && path.length > 0) {
        this.path = path;
        this.pathIndex = 0;
        this.blockedElapsedMs = 0;
        return true;
      }
    }

    this.clearPath();
    return false;
  }

  private clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
    this.blockedElapsedMs = 0;
  }

  private directionFromDelta(dx: number, dy: number): Direction {
    const horizontal = Math.abs(dx) > 0.35;
    const vertical = Math.abs(dy) > 0.35;
    if (horizontal && vertical) {
      if (dx > 0 && dy > 0) return "south-east";
      if (dx > 0 && dy < 0) return "north-east";
      if (dx < 0 && dy > 0) return "south-west";
      return "north-west";
    }
    if (horizontal) return dx > 0 ? "east" : "west";
    if (vertical) return dy > 0 ? "south" : "north";
    return this.direction;
  }

  private playMode(mode: AgentMode): void {
    const candidates = mode === "attack"
      ? ["attack", "idle"]
      : mode === "walk"
        ? ["walk", "run", "idle"]
        : ["idle"];
    const resolved = this.resolveAnimation(candidates);
    if (resolved) {
      const poseDirections = resolved.state.directions.filter(
        (value): value is Direction => DIRECTIONS.includes(value as Direction),
      );
      this.animator.setAnimationMap(
        resolved.animations,
        resolved.stateFolder,
        poseDirections,
      );
      this.animator.setClip(resolved.clipName, this.direction, resolved.stateFolder);
      return;
    }

    if (this.manualAnimations) {
      const clipName = this.animator.chooseClip(candidates, this.direction);
      if (clipName) {
        this.animator.setClip(clipName, this.direction);
        return;
      }
    }

    this.animator.setPose(
      this.direction,
      this.pose.stateFolder,
      this.pose.directions,
    );
  }

  private resolveAnimation(
    candidates: string[],
  ): CharacterAnimationResolution | undefined {
    return this.animationResolver?.resolve(candidates, this.direction);
  }

  private animationDirections(animations: AnimationMap): Direction[] {
    const directions = new Set(
      Object.values(animations).flatMap((animation) => animation.directions),
    );
    return directions.size > 0 ? [...directions] : [...DIRECTIONS];
  }

  private range(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
