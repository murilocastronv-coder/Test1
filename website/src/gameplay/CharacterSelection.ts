import Phaser from "phaser";
import type { PlayerController } from "../player/PlayerController";

import { ELF_CHARACTER_ID } from "../pixellab/templateAssetPaths";
import { characterAssetUrl, characterManifest, preloadCharacterAtlas, selectCharacterState } from "../shared/animation";

const CLASSES = [
  { key: "dark-knight", name: "Dark Knight", id: "402b7f00-0efc-4cfc-84f6-bed2fa0f2fcc" },
  { key: "dark-wizard", name: "Dark Wizard", id: "92af7d74-9de0-473a-8a1f-1db922d074aa" },
  { key: "dark-lord", name: "Dark Lord", id: "c1872986-a06b-45d1-a31a-9e1392c06810" },
  { key: "summoner", name: "Summoner", id: "1b1e6cbb-c572-408b-add7-9586455061b9" },
  { key: "elf", name: "Fairy Elf", id: ELF_CHARACTER_ID },
];

/** Select a real character on the existing player, without a duplicate visual sprite. */
export class CharacterSelection {
  private selected: string = "hero";
  private readonly container: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly status: HTMLDivElement;

  static preload(scene: Phaser.Scene): void {
    for (const character of CLASSES) preloadCharacterAtlas(scene, character.id);
  }

  constructor(private readonly scene: Phaser.Scene, private readonly player: PlayerController) {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;right:16px;bottom:20px;max-width:calc(100% - 32px);pointer-events:auto;color:#e2e8f0;font:14px sans-serif;z-index:20";
    this.menu = document.createElement("div");
    this.menu.style.cssText = "padding:16px;border:1px solid #74618c;border-radius:12px;background:rgba(20,18,32,.95);width:380px;max-width:100%;max-height:70vh;overflow-y:auto;box-sizing:border-box;margin-bottom:8px";
    const heading = document.createElement("strong");
    heading.textContent = "Escolha seu personagem";
    const note = document.createElement("p");
    note.textContent = "Escolha uma das cinco classes para jogar.";
    note.style.cssText = "font-size:12px;color:#beb3cf";
    this.status = document.createElement("div");
    this.status.style.cssText = "margin:8px 0;color:#81e6d9";
    this.menu.append(heading, note, this.status);
    const roster = document.createElement("div");
    roster.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px";
    for (const character of CLASSES) {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #554662;border-radius:8px;padding:6px;text-align:center";
      const preview = document.createElement("img");
      const state = selectCharacterState(characterManifest(scene, character.id));
      preview.src = characterAssetUrl(character.id, `${state.stateFolder}/rotations/south.png`);
      preview.alt = character.name;
      preview.style.cssText = "display:block;width:72px;height:72px;image-rendering:pixelated;margin:0 auto";
      card.append(preview);
      this.button(`Jogar com ${character.name}`, () => this.select(character.key), card);
      roster.append(card);
    }
    this.menu.append(roster);
    this.container.append(this.menu);
    this.button("Escolher personagem", () => { this.menu.hidden = !this.menu.hidden; }, this.container);
    document.getElementById("hud-root")!.append(this.container);
    const globals = window as unknown as Record<string, unknown>;
    globals.selectCharacter = (name: string) => this.select(name);
    globals.characterStatus = () => ({ selected: this.selected, x: player.sprite.x, y: player.sprite.y, texture: player.sprite.texture.key, frame: player.sprite.frame.name, facing: player.facing, menuOpen: !this.menu.hidden, available: CLASSES.map(({ key, name, id }) => ({ key, name, id })) });
    let saved = "elf";
    try { saved = localStorage.getItem("lorencia-character") ?? "elf"; } catch { /* storage may be unavailable */ }
    this.select(CLASSES.some((character) => character.key === saved) ? saved : "elf", false);
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
    const character = CLASSES.find((entry) => entry.key === name);
    if (!character) return;
    this.selected = name;
    this.status.textContent = `Selecionado: ${character.name}${name === "elf" ? " · Respira parada · Shift: correr · L: magia" : ""}`;
    try { localStorage.setItem("lorencia-character", name); } catch { /* storage may be unavailable */ }
    if (close) this.menu.hidden = true;
    this.player.setCharacter(character.id);
    this.scene.game.canvas.focus();
  }

  update(): void {
    // PlayerController owns movement and the selected character animations.
  }
}
