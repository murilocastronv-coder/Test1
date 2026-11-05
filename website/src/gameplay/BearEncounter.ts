import { GAME_CONFIG } from "../config";
import type { CharacterAgent } from "../npc/CharacterAgent";
import type { LoadedMap } from "../pixellab/types";
import type { PlayerController } from "../player/PlayerController";
import { moveWithCollision, type Collider } from "../shared/collision";
import { directionFromVector, vectorFromDirection, type Direction } from "../shared/direction";
import { findPath, nearestWalkable, type Point } from "../shared/navigation";

const RULES = {
  playerHealth: 3,
  bearHealth: 6,
  walkSpeed: 95,
  runSpeed: 175,
  leapSpeed: 220,
  runDistance: 90,
  attackDistance: 40,
  sweepReach: 52,
  leapReach: 42,
  windupMs: 600,
  recoveryMs: 1000,
  repathMs: 450,
  invulnerabilityMs: 1200,
  approachMs: 1800,
  arrivalDistance: 5,
  strikeProgress: 0.45,
  leapStartProgress: 0.15,
  leapEndProgress: 0.65,
  attackRearTolerance: 8,
} as const;

type Phase = "approach" | "chase" | "windup" | "attack" | "recover" | "won" | "lost";
type Attack = "attack" | "jump-attack";

/** A small encounter with readable attacks, counterattack windows, and a replay. */
export class BearEncounter {
  private phase: Phase = "approach";
  private elapsedMs = 0;
  private attack: Attack = "attack";
  private direction: Direction = "west";
  private attackDurationMs = 0;
  private dealtDamage = false;
  private playerHealth: number = RULES.playerHealth;
  private bearHealth: number = RULES.bearHealth;
  private invulnerabilityMs = 0;
  private path: Point[] = [];
  private repathMs = 0;
  private readonly collider: Collider = { width: 12, height: 8, footOffsetY: GAME_CONFIG.npc.bearFootOffsetY };

  constructor(
    readonly bear: CharacterAgent,
    private readonly player: PlayerController,
    private readonly map: LoadedMap,
  ) {
    bear.playControlled("walk", this.direction);
  }

  get sprite(): CharacterAgent["sprite"] { return this.bear.sprite; }
  get hitRadius(): number { return this.bear.hitRadius; }
  get finished(): boolean { return this.phase === "won" || this.phase === "lost"; }

  get status() {
    return {
      phase: this.phase,
      playerHealth: this.playerHealth,
      playerMaxHealth: RULES.playerHealth,
      bearHealth: this.bearHealth,
      bearMaxHealth: RULES.bearHealth,
      attack: this.attack,
    };
  }

  get message(): string {
    if (this.phase === "won") return "The clearing is safe! You defeated the bear.";
    if (this.phase === "lost") return "The bear caught you. Try again!";
    if (this.phase === "windup") return this.attack === "attack" ? "Bear winding up — dodge the sweep!" : "Bear ready to pounce — move aside!";
    if (this.phase === "recover") return "An opening! Strike back with J or L.";
    return "Drive the bear away. Dodge its attacks, then counter.";
  }

  hit(fromX: number, fromY: number, strength: number): boolean {
    if (this.finished || !this.bear.hit(fromX, fromY, strength)) return false;
    this.bearHealth -= 1;
    if (this.bearHealth === 0) {
      this.phase = "won";
      this.sprite.clearTint();
      this.sprite.setAlpha(0.45);
      this.player.sprite.setAlpha(1);
    } else {
      // A successful counter interrupts the attack; invulnerability prevents
      // one held slash or overlapping projectiles from counting twice.
      this.transition("recover");
    }
    return true;
  }

  update(deltaMs: number): void {
    if (this.finished) return;
    this.invulnerabilityMs = Math.max(0, this.invulnerabilityMs - deltaMs);
    this.player.sprite.setAlpha(this.invulnerabilityMs > 0 ? 0.55 : 1);
    if (this.bear.stunned) return;
    this.elapsedMs += deltaMs;
    const target = this.player.worldPosition;
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const distance = Math.hypot(dx, dy);

    if (this.phase === "windup") {
      if (this.elapsedMs >= RULES.windupMs) {
        this.transition("attack");
        this.attackDurationMs = this.bear.playControlled(this.attack, this.direction);
      }
      return;
    }
    if (this.phase === "attack") {
      const progress = this.elapsedMs / this.attackDurationMs;
      if (this.attack === "jump-attack" && progress > RULES.leapStartProgress && progress < RULES.leapEndProgress) {
        const forward = vectorFromDirection(this.direction);
        this.move(forward.x * RULES.leapSpeed, forward.y * RULES.leapSpeed, deltaMs);
      }
      if (!this.dealtDamage && progress >= RULES.strikeProgress) {
        this.dealtDamage = true;
        const forward = vectorFromDirection(this.direction);
        const hitX = target.x - this.sprite.x;
        const hitY = target.y - this.sprite.y;
        const reach = this.attack === "attack" ? RULES.sweepReach : RULES.leapReach;
        if (Math.hypot(hitX, hitY) <= reach && hitX * forward.x + hitY * forward.y >= -RULES.attackRearTolerance) {
          this.damagePlayer();
        }
      }
      if (!this.finished && progress >= 1) {
        this.attack = this.attack === "attack" ? "jump-attack" : "attack";
        this.transition("recover");
      }
      return;
    }
    if (this.phase === "recover") {
      if (this.elapsedMs >= RULES.recoveryMs) this.transition("chase");
      return;
    }
    if (distance <= RULES.attackDistance) {
      this.direction = directionFromVector(dx, dy);
      this.transition("windup");
      this.sprite.setTint(0xffc56e);
      return;
    }

    const walking = (this.phase === "approach" && this.elapsedMs < RULES.approachMs) || distance < RULES.runDistance;
    this.follow(target, walking ? RULES.walkSpeed : RULES.runSpeed, deltaMs);
    this.bear.playControlled(walking ? "walk" : "run", this.direction);
  }

  private transition(phase: Phase): void {
    this.phase = phase;
    this.elapsedMs = 0;
    this.dealtDamage = false;
    this.sprite.clearTint();
    if (phase === "windup" || phase === "recover") this.bear.holdControlled(this.direction);
    if (phase === "chase") this.repathMs = 0;
  }

  private damagePlayer(): void {
    if (this.invulnerabilityMs > 0 || this.player.airborne) return;
    this.playerHealth -= 1;
    this.invulnerabilityMs = RULES.invulnerabilityMs;
    if (this.playerHealth === 0) this.transition("lost");
  }

  private follow(target: Point, speed: number, deltaMs: number): void {
    this.repathMs -= deltaMs;
    if (this.repathMs <= 0) {
      this.repathMs = RULES.repathMs;
      const goal = nearestWalkable(this.map, target, this.collider, 3);
      this.path = goal ? findPath(this.map, this.sprite, goal, this.collider) ?? [] : [];
    }
    while (this.path.length && Math.hypot(this.path[0].x - this.sprite.x, this.path[0].y - this.sprite.y) < RULES.arrivalDistance) {
      this.path.shift();
    }
    const waypoint = this.path[0];
    if (!waypoint) return;
    const dx = waypoint.x - this.sprite.x;
    const dy = waypoint.y - this.sprite.y;
    const distance = Math.hypot(dx, dy);
    this.direction = directionFromVector(dx, dy);
    const step = Math.min(speed, distance * 1000 / deltaMs);
    this.move(dx / distance * step, dy / distance * step, deltaMs);
  }

  private move(vx: number, vy: number, deltaMs: number): void {
    const position = moveWithCollision(this.map, this.sprite.x, this.sprite.y, vx * deltaMs / 1000, vy * deltaMs / 1000, this.collider);
    this.sprite.setPosition(position.x, position.y);
  }
}
