import Phaser from "phaser";
import { fetchGlobalJumps, recordGlobalJump } from "./serverStats";

/**
 * EXAMPLE: a self-contained widget that reads + writes persistent SERVER state.
 *
 * Shows a small "🦘 N jumps" counter (top-right) of the total jumps by everyone who
 * has ever played this game, and increments it server-side every time the player
 * jumps (Space). The count lives in a Durable Object (worker/src/durable-objects/
 * GameMap.ts → handleApi) and is reached via /api/jumps (serverStats.ts).
 *
 * Wire it from GameScene.create(): `new JumpCounterExample(this);`
 * Delete this file + serverStats.ts + the /api/jumps route to remove server state.
 */
export class JumpCounterExample {
  private readonly el: HTMLDivElement;
  private jumps = 0;

  constructor(scene: Phaser.Scene) {
    const root = document.getElementById("hud-root");
    if (!root) {
      throw new Error("Missing #hud-root");
    }
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:absolute;top:12px;right:12px;font-family:monospace;font-size:16px;" +
      "color:#fff;background:rgba(0,0,0,0.45);padding:4px 10px;border-radius:8px;" +
      "pointer-events:none;z-index:1000;";
    this.el.textContent = "🦘 … jumps";
    root.appendChild(this.el);

    // Read the persisted global total once on load.
    fetchGlobalJumps().then((n) => {
      this.jumps = n;
      this.render();
    });

    // Increment server-side on each jump (Space fires keydown once per press).
    scene.input.keyboard?.on("keydown-SPACE", () => {
      recordGlobalJump().then((n) => {
        this.jumps = n;
        this.render();
      });
    });

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.el.remove());
  }

  private render(): void {
    this.el.textContent = `🦘 ${this.jumps.toLocaleString()} ${this.jumps === 1 ? "jump" : "jumps"}`;
  }
}
