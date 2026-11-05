/**
 * The always-on text panel (top-left) plus optional clickable buttons.
 *
 * Text and buttons live in SEPARATE containers on purpose: `setText` is called
 * from `update()`, so if buttons shared the text container every HUD refresh
 * would silently delete them.
 *
 * For pixel-art screen UI the user generated in the UI Creator, use `UiLayout`
 * instead — see `AGENTS.md` in this folder.
 */
export class HudOverlay {
  private readonly element: HTMLDivElement;
  private readonly textElement: HTMLDivElement;
  private readonly buttonElement: HTMLDivElement;
  private text: string | null = null;

  constructor() {
    const root = document.getElementById("hud-root");
    if (!root) {
      throw new Error("Missing #hud-root");
    }

    this.element = document.createElement("div");
    this.element.className = "hud-panel";
    this.textElement = document.createElement("div");
    this.buttonElement = document.createElement("div");
    this.element.append(this.textElement, this.buttonElement);
    root.appendChild(this.element);
  }

  setText(lines: string[]): void {
    // Safe to call every frame: rebuilding these nodes on an unchanged string is
    // pure layout churn.
    const text = lines.join("\n");
    if (text === this.text) return;
    this.text = text;
    this.textElement.replaceChildren(
      ...lines.map((line) => {
        const div = document.createElement("div");
        div.textContent = line;
        return div;
      }),
    );
  }

  /** A real DOM button — the playtest tool can click this; a canvas button it cannot. */
  addButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.className = "hud-button";
    button.addEventListener("click", onClick);
    this.buttonElement.appendChild(button);
    return button;
  }

  clearButtons(): void {
    this.buttonElement.replaceChildren();
  }

  destroy(): void {
    this.element.remove();
  }
}
