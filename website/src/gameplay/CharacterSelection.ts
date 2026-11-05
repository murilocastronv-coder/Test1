import Phaser from "phaser";
import type { PlayerController } from "../player/PlayerController";

import { PLAYER_CHARACTER_ID } from "../pixellab/templateAssetPaths";
import { characterAssetUrl, characterManifest, preloadCharacterAtlas, selectCharacterState } from "../shared/animation";

const ELF_CHARACTER_ID = "6ccddda9-6d64-45f5-95c1-855975586e53";

/** Select a real character on the existing player, without a duplicate visual sprite. */
export class CharacterSelection {
  private selected: string = "hero";
  private readonly container: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly status: HTMLDivElement;

  static preload(scene: Phaser.Scene): void {
    preloadCharacterAtlas(scene, ELF_CHARACTER_ID);
  }

  constructor(private readonly scene: Phaser.Scene, private readonly player: PlayerController) {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;right:16px;bottom:20px;max-width:calc(100% - 32px);pointer-events:auto;color:#e2e8f0;font:14px sans-serif;z-index:20";
    this.menu = document.createElement("div");
    this.menu.style.cssText = "padding:16px;border:1px solid #74618c;border-radius:12px;background:rgba(20,18,32,.95);max-width:310px;box-sizing:border-box;margin-bottom:8px";
    const heading = document.createElement("strong");
    heading.textContent = "Escolha seu personagem";
    const preview = document.createElement("img");
    const elfState = selectCharacterState(characterManifest(scene, ELF_CHARACTER_ID));
    preview.src = characterAssetUrl(ELF_CHARACTER_ID, `${elfState.stateFolder}/rotations/south.png`);
    preview.alt = "Fairy Elf com asas brancas";
    preview.style.cssText = "display:block;width:112px;height:112px;image-rendering:pixelated;margin:8px auto";
    const note = document.createElement("p");
    note.textContent = "Fairy Elf: arco, armadura verde e dourada e asas brancas. Caminhada em oito direções; asas integradas ao visual.";
    note.style.cssText = "font-size:12px;line-height:1.5;color:#beb3cf";
    this.status = document.createElement("div");
    this.status.style.cssText = "margin:8px 0;color:#81e6d9";
    this.menu.append(heading, preview, note, this.status);
    this.button("Herói original", () => this.select("hero"), this.menu);
    this.button("Jogar com Fairy Elf", () => this.select("elf"), this.menu);
    this.container.append(this.menu);
    this.button("Escolher personagem", () => { this.menu.hidden = !this.menu.hidden; }, this.container);
    document.getElementById("hud-root")!.append(this.container);
    const globals = window as unknown as Record<string, unknown>;
    globals.selectCharacter = (name: string) => this.select(name);
    globals.characterStatus = () => ({ selected: this.selected, x: player.sprite.x, y: player.sprite.y, texture: player.sprite.texture.key, frame: player.sprite.frame.name, facing: player.facing, menuOpen: !this.menu.hidden });
    let saved = "elf";
    try { saved = localStorage.getItem("lorencia-character") ?? "elf"; } catch { /* storage may be unavailable */ }
    this.select(saved === "hero" ? "hero" : "elf", false);
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
    if (name !== "hero" && name !== "elf") return;
    this.selected = name;
    this.status.textContent = `Selecionado: ${name === "elf" ? "Fairy Elf" : "Herói original"}`;
    try { localStorage.setItem("lorencia-character", name); } catch { /* storage may be unavailable */ }
    if (close) this.menu.hidden = true;
    this.player.setCharacter(name === "elf" ? ELF_CHARACTER_ID : PLAYER_CHARACTER_ID);
    this.scene.game.canvas.focus();
  }

  update(): void {
    // PlayerController owns movement and the selected character animations.
  }
}
