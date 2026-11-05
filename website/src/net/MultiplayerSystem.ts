import Phaser from "phaser";
import { connectMultiplayer, type MultiplayerHandle, type RemoteEvent } from "./multiplayer";

/**
 * Shared-movement multiplayer for the top-down game. Connects to this project's worker
 * (`{slug}.pixellab.run/room/:id`, resolved by workerWsBase()), streams the local
 * player's position, and renders every other connected player as a coloured marker
 * that updates in real time.
 *
 * Wire it from GameScene: construct in create() with a getter for the local position,
 * call update(deltaMs) each frame. No auth token — the worker Origin-checks the socket
 * and the Durable Object assigns each player an ephemeral id.
 */
export class MultiplayerSystem {
  private handle: MultiplayerHandle;
  private remotes = new Map<string, Phaser.GameObjects.Rectangle>();
  private myId: string | null = null;
  private sinceSend = 0;

  constructor(
    private scene: Phaser.Scene,
    private getPos: () => { x: number; y: number },
    roomId = "lobby",
  ) {
    this.handle = connectMultiplayer(roomId, (e) => this.onEvent(e));
  }

  private onEvent(e: RemoteEvent): void {
    if (e.type === "snapshot") {
      this.myId = e.you ?? null;
      for (const p of e.players ?? []) if (p.pos) this.upsert(p.id, p.pos);
    } else if (e.type === "move" && e.id && e.pos) {
      this.upsert(e.id, e.pos);
    } else if (e.type === "leave" && e.id) {
      this.remotes.get(e.id)?.destroy();
      this.remotes.delete(e.id);
    }
  }

  private upsert(id: string, pos: { x: number; y: number }): void {
    if (id === this.myId) return;
    let marker = this.remotes.get(id);
    if (!marker) {
      marker = this.scene.add
        .rectangle(pos.x, pos.y, 16, 22, 0xff5566)
        .setStrokeStyle(2, 0xffffff)
        .setDepth(10000);
      this.remotes.set(id, marker);
    }
    marker.setPosition(pos.x, pos.y);
  }

  update(deltaMs: number): void {
    this.sinceSend += deltaMs;
    if (this.sinceSend >= 80) {
      this.sinceSend = 0;
      const p = this.getPos();
      this.handle.sendPosition({ x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  destroy(): void {
    this.handle.close();
    for (const m of this.remotes.values()) m.destroy();
    this.remotes.clear();
  }
}
