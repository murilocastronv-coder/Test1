import type { PlayerController } from "../player/PlayerController";

/** Real touch controls: pointer capture keeps movement alive during a held press. */
export class TouchMovement {
  private readonly root: HTMLDivElement;
  private readonly held = new Map<number, { x: number; y: number }>();
  constructor(private readonly player: PlayerController) {
    this.root = document.createElement("div");
    this.root.className = "rpg-touch-movement";
    this.root.setAttribute("aria-label", "Mover personagem");
    const directions = [["↖", -1, -1], ["↑", 0, -1], ["↗", 1, -1], ["←", -1, 0], ["•", 0, 0], ["→", 1, 0], ["↙", -1, 1], ["↓", 0, 1], ["↘", 1, 1]] as const;
    for (const [label, x, y] of directions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", `Mover ${label}`);
      button.disabled = x === 0 && y === 0;
      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.held.set(event.pointerId, { x, y });
        this.sync();
      });
      const release = (event: PointerEvent) => { this.held.delete(event.pointerId); this.sync(); };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      this.root.append(button);
    }
    document.getElementById("hud-root")!.append(this.root);
    window.addEventListener("blur", this.clear);
  }
  private sync(): void {
    let x = 0, y = 0;
    for (const vector of this.held.values()) { x += vector.x; y += vector.y; }
    this.player.setTouchMovement(x, y);
  }
  private clear = (): void => { this.held.clear(); this.sync(); };
  setActive(active: boolean): void { this.root.hidden = !active; if (!active) this.clear(); }
  destroy(): void { this.clear(); window.removeEventListener("blur", this.clear); this.root.remove(); }
}
