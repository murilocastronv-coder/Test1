import Phaser from "phaser";
import type { PlayerController } from "../player/PlayerController";

const base = `${import.meta.env.BASE_URL}characters/summoner/`;
const texture = "uploaded-summoner";

/** Uses the uploaded frames unchanged; movement and combat remain owned by the player. */
export class CharacterSelection {
  private selected: string = "hero";
  private readonly visual: Phaser.GameObjects.Sprite;
  private readonly container: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly status: HTMLDivElement;

  static preload(scene: Phaser.Scene): void {
    scene.load.spritesheet(texture, `${base}idle.png`, { frameWidth: 56, frameHeight: 56 });
  }

  constructor(private readonly scene: Phaser.Scene, private readonly player: PlayerController) {
    if (!scene.anims.exists("summoner-upload-idle")) {
      scene.anims.create({ key: "summoner-upload-idle", frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: 7 }), frameRate: 5, repeat: -1 });
    }
    this.visual = scene.add.sprite(player.sprite.x, player.sprite.y, texture).setVisible(false);
    this.visual.play("summoner-upload-idle");
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;right:16px;bottom:20px;max-width:calc(100% - 32px);pointer-events:auto;color:#e2e8f0;font:14px sans-serif;z-index:20";
    this.menu = document.createElement("div");
    this.menu.style.cssText = "padding:16px;border:1px solid #74618c;border-radius:12px;background:rgba(20,18,32,.95);max-width:310px;box-sizing:border-box;margin-bottom:8px";
    const heading = document.createElement("strong");
    heading.textContent = "Escolha seu personagem";
    const preview = document.createElement("img");
    preview.src = `${base}preview.gif`;
    preview.alt = "Summoner enviada";
    preview.style.cssText = "display:block;width:112px;height:112px;image-rendering:pixelated;margin:8px auto";
    const note = document.createElement("p");
    note.textContent = "Summoner: GIF original, com uma direção. Movimento e combate usam os controles atuais.";
    note.style.cssText = "font-size:12px;line-height:1.5;color:#beb3cf";
    this.status = document.createElement("div");
    this.status.style.cssText = "margin:8px 0;color:#81e6d9";
    this.menu.append(heading, preview, note, this.status);
    this.button("Herói original", () => this.select("hero"), this.menu);
    this.button("Jogar com Summoner", () => this.select("summoner"), this.menu);
    this.container.append(this.menu);
    this.button("Escolher personagem", () => { this.menu.hidden = !this.menu.hidden; }, this.container);
    document.getElementById("hud-root")!.append(this.container);
    const globals = window as unknown as Record<string, unknown>;
    globals.selectCharacter = (name: string) => this.select(name);
    globals.characterStatus = () => ({ selected: this.selected, x: player.sprite.x, y: player.sprite.y, texture: this.selected === "summoner" ? this.visual.texture.key : player.sprite.texture.key, frame: this.visual.frame.name, menuOpen: !this.menu.hidden });
    let saved = "hero";
    try { saved = localStorage.getItem("lorencia-character") ?? "hero"; } catch { /* storage may be unavailable */ }
    this.select(saved, false);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.container.remove();
      delete globals.selectCharacter;
      delete globals.characterStatus;
    });
  }

  private button(label: string, action: () => void, parent: HTMLElement): void {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = "hud-button";
    button.style.cssText = "pointer-events:auto;margin:4px;max-width:100%;cursor:pointer";
    button.onclick = action;
    parent.append(button);
  }

  private select(name: string, close = true): void {
    if (name !== "hero" && name !== "summoner") return;
    this.selected = name;
    this.status.textContent = `Selecionado: ${name === "summoner" ? "Summoner" : "Herói original"}`;
    try { localStorage.setItem("lorencia-character", name); } catch { /* storage may be unavailable */ }
    if (close) this.menu.hidden = true;
    this.update();
    this.scene.game.canvas.focus();
  }

  update(): void {
    const source = this.player.sprite;
    const active = this.selected === "summoner";
    source.setAlpha(active ? 0 : 1);
    this.visual.setVisible(active).setPosition(source.x, source.y).setDepth(source.depth).setTint(source.tintTopLeft);
  }
}
