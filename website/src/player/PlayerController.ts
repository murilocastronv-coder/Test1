import Phaser from "phaser";
import { GAME_CONFIG } from "../config";
import { PLAYER_CHARACTER_ID } from "../pixellab/templateAssetPaths";
import type { LoadedMap } from "../pixellab/types";
import {
  CharacterAnimationResolver,
  SpriteAnimator,
  type CharacterAnimationResolution,
  type CharacterStateSelection,
  characterAtlasKey,
  characterManifest,
  characterRotationFrameName,
  preloadCharacterAtlas,
  selectCharacterState,
} from "../shared/animation";
import { elevationAt, moveWithCollision, type Collider } from "../shared/collision";
import type { TileLayerElevation } from "../pixellab/tileLayers";
import {
  isWithinStairSpan,
  movementAlongStairs,
  stairAreaAt,
  stairAreasFor,
  type StairArea,
} from "../pixellab/stairs";
import { setYDepth } from "../shared/depth";
import {
  DIRECTIONS,
  directionFromVector,
  vectorFromDirection,
  type Direction,
} from "../shared/direction";

type PlayerActionName = "slash" | "spell";
type PlayerAnimationRole = "idle" | "jump" | "run" | "walk";
const SPELL_CAST_FRAME_DELAY = 2;
const SLASH_SWING_FRAME_DELAY = 3;

interface ActivePlayerAction extends CharacterAnimationResolution {
  name: PlayerActionName;
  durationMs: number;
  effectDelayMs: number;
  effectTriggered: boolean;
}

interface PlayerControllerCallbacks {
  onSpellCast?: (origin: { x: number; y: number }, direction: Direction) => void;
  onSlashSwing?: (origin: { x: number; y: number }, direction: Direction) => void;
}

export class PlayerController {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;
  private animator: SpriteAnimator;
  private animationResolver: CharacterAnimationResolver;
  private poseState: CharacterStateSelection;
  private readonly collider: Collider = {
    width: GAME_CONFIG.player.colliderWidth,
    height: GAME_CONFIG.player.colliderHeight,
    footOffsetY: GAME_CONFIG.player.footOffsetY,
    maxStepUp: GAME_CONFIG.terrain.maxStepUp,
    maxStepDown: GAME_CONFIG.terrain.maxStepDown,
  };
  private groundX: number;
  private groundY: number;
  private elevation: TileLayerElevation = { level: 0, depth: null };
  private stairAreas: StairArea[];
  private activeStair: StairArea | null = null;
  /** Transient offset easing out a ledge hop so the sprite steps instead of teleporting. */
  private hopOffsetY = 0;
  /** While > 0, the jump clip plays so a ledge hop reads as a deliberate hop. */
  private hopAnimMs = 0;
  private touchX: number = 0;
  private touchY: number = 0;
  private direction: Direction = "south";
  private jumpElapsedMs = 0;
  private jumpSpeed = 0;
  private visualYOffset = 0;
  private jumping = false;
  private activeAction: ActivePlayerAction | null = null;
  private actionElapsedMs = 0;

  readonly sprite: Phaser.GameObjects.Sprite;

  static preload(scene: Phaser.Scene): void {
    preloadCharacterAtlas(scene, PLAYER_CHARACTER_ID);
  }

  constructor(
    scene: Phaser.Scene,
    private mapData: LoadedMap,
    x: number,
    y: number,
    private readonly callbacks: PlayerControllerCallbacks = {},
  ) {
    this.groundX = x;
    this.groundY = y;
    this.stairAreas = stairAreasFor(mapData.annotations);
    const atlasKey = characterAtlasKey(PLAYER_CHARACTER_ID);
    const manifest = characterManifest(scene, PLAYER_CHARACTER_ID);
    this.animationResolver = new CharacterAnimationResolver(manifest);
    const selected = selectCharacterState(
      manifest,
      { preferredClips: ["idle", "run", "walk"] },
    );
    this.poseState = selected;
    this.sprite = scene.add.sprite(
      x,
      y,
      atlasKey,
      characterRotationFrameName(selected.stateFolder, "south"),
    );
    this.elevation = elevationAt(mapData, x, y + this.collider.footOffsetY);
    this.syncSprite();
    this.animator = new SpriteAnimator(
      this.sprite,
      atlasKey,
      selected.animations,
      selected.stateFolder,
      this.stateDirections(selected),
    );

    this.keys = scene.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,J,L") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.playRole(["idle"]);
  }

  setCharacter(characterId: string): void {
    const manifest = characterManifest(this.sprite.scene, characterId);
    const selected = selectCharacterState(manifest, { preferredClips: ["walk"] });
    this.activeAction = null;
    this.actionElapsedMs = 0;
    this.animationResolver = new CharacterAnimationResolver(manifest);
    this.poseState = selected;
    this.animator = new SpriteAnimator(this.sprite, characterAtlasKey(characterId), selected.animations, selected.stateFolder, this.stateDirections(selected));
    this.sprite.clearTint();
    // Keep the 80px source art intact, but draw heroes at the map's scale.
    this.sprite.setScale(0.5);
    this.playRole(["idle"]);
  }

  setMapData(mapData: LoadedMap): void {
    this.mapData = mapData;
    this.stairAreas = stairAreasFor(mapData.annotations);
    this.activeStair = null;
  }

  get worldPosition(): { x: number; y: number } {
    return { x: this.groundX, y: this.groundY };
  }

  /** Direction the player is currently facing. Use for "shoot forward" gameplay. */
  get facing(): Direction {
    return this.direction;
  }

  get airborne(): boolean {
    return this.jumping;
  }

  teleportTo(x: number, y: number): void {
    this.groundX = x;
    this.groundY = y;
    this.visualYOffset = 0;
    this.hopOffsetY = 0;
    this.jumping = false;
    this.elevation = elevationAt(this.mapData, x, y + this.collider.footOffsetY);
    this.syncSprite();
  }

  /**
   * Positions live in drawn space (the foot stands on whatever face is
   * visually under it), so no lift is applied. Characters on a raised face
   * use the standing cell's face depth so they draw over their block but
   * under blocks further south.
   */
  private syncSprite(visualYOffset = 0): void {
    this.sprite.setPosition(this.groundX, this.groundY + visualYOffset);
    if (this.elevation.depth !== null) {
      this.sprite.setDepth(this.elevation.depth);
    } else {
      // Foot line, not sprite centre — tiles sort by their drawn face line
      // and map objects by their foot line, so the character must too.
      setYDepth(this.sprite, this.groundY + this.collider.footOffsetY);
    }
  }

  update(deltaMs: number): void {
    if (!this.activeAction) this.actionElapsedMs = Math.max(0, this.actionElapsedMs - deltaMs);
    const input = this.inputVector();
    const stair = this.stairForMovement(input, deltaMs);
    const movement = stair ? movementAlongStairs(input, stair) : input;
    const isMoving = movement.x !== 0 || movement.y !== 0;
    const isRunning = this.keys.SHIFT.isDown && !stair;

    if (!this.jumping && !this.activeAction) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.J) && this.startAction("slash")) {
        return;
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.L) && this.startAction("spell")) {
        return;
      }
    }

    if (this.activeAction && this.updateAction(deltaMs)) {
      return;
    }

    if (!stair && !this.jumping && Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) {
      this.jumping = true;
      this.jumpElapsedMs = 0;
      this.jumpSpeed = isRunning ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.walkSpeed;
      if (isMoving) {
        this.direction = directionFromVector(movement.x, movement.y);
      }
      this.playRole(["jump", "walk", "idle"]);
    }

    if (this.jumping) {
      this.updateJump(deltaMs);
    } else if (isMoving) {
      this.direction = stair
        ? movement.x < 0 ? "west" : "east"
        : directionFromVector(movement.x, movement.y);
      const speed = isRunning ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.walkSpeed;
      const moved = moveWithCollision(
        this.mapData,
        this.groundX,
        this.groundY,
        movement.x * speed * (deltaMs / 1000),
        movement.y * speed * (deltaMs / 1000),
        this.collider,
        this.elevation.level,
      );
      this.absorbLedgeHop(moved.y, speed, deltaMs);
      this.groundX = moved.x;
      this.groundY = moved.y;
      this.playRole(
        this.hopAnimMs > 0
          ? ["jump", "walk", "idle"]
          : isRunning
            ? ["run", "walk", "idle"]
            : ["walk", "idle"],
      );
    } else {
      this.visualYOffset = 0;
      this.playRole(["idle"]);
    }

    this.elevation = elevationAt(this.mapData, this.groundX, this.groundY + this.collider.footOffsetY);
    this.hopOffsetY *= Math.exp(-deltaMs / 60);
    if (Math.abs(this.hopOffsetY) < 0.5) {
      this.hopOffsetY = 0;
    }
    this.hopAnimMs = Math.max(0, this.hopAnimMs - deltaMs);
    this.syncSprite(this.visualYOffset + this.hopOffsetY);
    this.animator.update(deltaMs);
  }

  private stairForMovement(input: Phaser.Math.Vector2, deltaMs: number): StairArea | null {
    const footY = this.groundY + this.collider.footOffsetY;
    const current = stairAreaAt(this.stairAreas, this.groundX, footY);
    if (current) {
      this.activeStair = current;
      return current;
    }
    if (this.activeStair && isWithinStairSpan(this.activeStair, this.groundX, footY)) {
      return this.activeStair;
    }
    this.activeStair = null;
    if (input.lengthSq() === 0) {
      return null;
    }
    const entryDistance = GAME_CONFIG.player.walkSpeed * (deltaMs / 1000);
    this.activeStair = stairAreaAt(
      this.stairAreas,
      this.groundX + input.x * entryDistance,
      footY + input.y * entryDistance,
    );
    return this.activeStair;
  }

  /**
   * A ledge hop teleports the ground position past the cliff side face in a
   * single frame. Fold the surplus into hopOffsetY (decayed each update) so
   * the sprite eases up/down the step instead of snapping.
   */
  private absorbLedgeHop(movedY: number, speed: number, deltaMs: number): void {
    const naturalStep = speed * (deltaMs / 1000) + 2;
    const frameDelta = movedY - this.groundY;
    if (Math.abs(frameDelta) > naturalStep) {
      this.hopOffsetY += this.groundY - movedY + Math.sign(frameDelta) * naturalStep;
      this.hopAnimMs = 240;
    }
  }

  get attackState(): { active: boolean; elapsedMs: number; durationMs: number; effectTriggered: boolean } {
    return { active: !!this.activeAction, elapsedMs: this.actionElapsedMs, durationMs: this.activeAction?.durationMs ?? 0, effectTriggered: this.activeAction?.effectTriggered ?? false };
  }

  performAttack(direction: Direction = this.direction): boolean {
    if (this.jumping || this.activeAction || this.actionElapsedMs > 0) return false;
    this.direction = direction;
    return this.startAction("slash");
  }

  private startAction(actionName: PlayerActionName): boolean {
    if (this.activeAction || this.actionElapsedMs > 0) return false;
    const action = this.resolveAnimation(["Ataque de Espada", "Ataque de Cajado", "Ataque de Arco", actionName]);
    if (!action) {
      // These heroes have walking clips only: retain combat without inventing attack art.
      if (this.actionElapsedMs > 0) return false;
      this.actionElapsedMs = 500;
      if (actionName === "spell") this.callbacks.onSpellCast?.(this.worldPosition, this.direction);
      else this.callbacks.onSlashSwing?.(this.worldPosition, this.direction);
      return false;
    }
    const clip = action.animations[action.clipName];
    const fps = clip.fps ?? GAME_CONFIG.animation.fps;
    const effectFrame = action.animation.display_name?.startsWith("Ataque") ? 4 : actionName === "spell" ? SPELL_CAST_FRAME_DELAY : SLASH_SWING_FRAME_DELAY;
    this.activeAction = {
      ...action,
      name: actionName,
      durationMs: (clip.frameCount * 1000) / fps,
      effectDelayMs: (effectFrame * 1000) / fps,
      effectTriggered: false,
    };
    this.actionElapsedMs = 0;
    this.visualYOffset = 0;
    this.animator.setAnimationMap(
      action.animations,
      action.stateFolder,
      this.stateDirections(action),
    );
    this.animator.setClip(action.clipName, this.direction, action.stateFolder);
    this.syncSprite();
    return true;
  }

  private updateAction(deltaMs: number): boolean {
    const action = this.activeAction;
    if (!action) return false;

    this.actionElapsedMs += deltaMs;
    if (!action.effectTriggered && this.actionElapsedMs >= action.effectDelayMs) {
      action.effectTriggered = true;
      if (action.name === "spell") {
        this.callbacks.onSpellCast?.(this.worldPosition, this.direction);
      } else if (action.name === "slash") {
        this.callbacks.onSlashSwing?.(this.worldPosition, this.direction);
      }
    }
    this.syncSprite();
    this.animator.update(deltaMs);
    if (this.actionElapsedMs < action.durationMs) {
      return true;
    }

    this.activeAction = null;
    this.actionElapsedMs = 0;
    return false;
  }

  private updateJump(deltaMs: number): void {
    this.jumpElapsedMs += deltaMs;
    const progress = Math.min(this.jumpElapsedMs / GAME_CONFIG.player.jumpDurationMs, 1);
    const dir = vectorFromDirection(this.direction);
    const moved = moveWithCollision(
      this.mapData,
      this.groundX,
      this.groundY,
      dir.x * this.jumpSpeed * (deltaMs / 1000),
      dir.y * this.jumpSpeed * (deltaMs / 1000),
      this.collider,
      this.elevation.level,
    );
    this.absorbLedgeHop(moved.y, this.jumpSpeed, deltaMs);
    this.groundX = moved.x;
    this.groundY = moved.y;
    this.visualYOffset = -Math.sin(progress * Math.PI) * GAME_CONFIG.player.jumpHeight;

    if (progress >= 1) {
      this.jumping = false;
      this.visualYOffset = 0;
    }
  }

  setTouchMovement(x: number, y: number): void {
    this.touchX = Number.isFinite(x) ? Phaser.Math.Clamp(x, -1, 1) : 0;
    this.touchY = Number.isFinite(y) ? Phaser.Math.Clamp(y, -1, 1) : 0;
  }

  private inputVector(): Phaser.Math.Vector2 {
    const axis = new Phaser.Math.Vector2(this.touchX, this.touchY);
    if (this.keys.A.isDown || this.keys.LEFT.isDown) axis.x -= 1;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) axis.x += 1;
    if (this.keys.W.isDown || this.keys.UP.isDown) axis.y -= 1;
    if (this.keys.S.isDown || this.keys.DOWN.isDown) axis.y += 1;
    if (axis.lengthSq() > 0) {
      axis.normalize();
    }
    return axis;
  }

  private playRole(roles: PlayerAnimationRole[]): void {
    const resolved = this.resolveAnimation(roles);
    if (resolved) {
      this.animator.setAnimationMap(
        resolved.animations,
        resolved.stateFolder,
        this.stateDirections(resolved),
      );
      this.animator.setClip(resolved.clipName, this.direction, resolved.stateFolder);
      return;
    }

    this.animator.setPose(
      this.direction,
      this.poseState.stateFolder,
      this.stateDirections(this.poseState),
    );
  }

  private resolveAnimation(
    candidates: string[],
  ): CharacterAnimationResolution | undefined {
    // Prefer the generated breathing clip when standing still; walking and
    // combat retain their existing resolution and the current sprite scale.
    const clips = candidates.flatMap((candidate) =>
      candidate === "idle" ? ["breathing-idle", "Parado", "idle"] : [candidate],
    );
    return this.animationResolver.resolve(clips, this.direction);
  }

  private stateDirections(selection: CharacterStateSelection): Direction[] {
    return selection.state.directions.filter(
      (value): value is Direction => DIRECTIONS.includes(value as Direction),
    );
  }
}
