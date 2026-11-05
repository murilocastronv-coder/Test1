/**
 * Mount a user-arranged PixelLab UI layout (assets/ui/layouts.json) as DOM
 * under #hud-root.
 *
 * Screen UI is DOM, not Phaser canvas: the playtest tool can only click DOM
 * elements, so canvas buttons read as broken even when they work. This helper
 * renders each placement as a screen-fixed <img> (or 9-sliced <div>), keeps
 * pixels crisp, and exposes state swapping (hover/pressed images) and click
 * wiring through real DOM elements.
 *
 * Usage:
 *   const hud = await UiLayout.mount("in-game HUD");
 *   hud.onClick("start button", () => this.startGame());
 *   hud.setState("start button", "pressed");   // swap to the pressed image
 *   hud.setState("start button", null);        // back to the base image
 *   hud.destroy();                              // on scene shutdown
 *
 * Data files (synced by the platform):
 *   assets/ui/layouts.json — named layouts; placements use 0..1 fractions.
 *   assets/ui/index.json    — per-asset {id, name, kind, parent_id, nine_slice,
 *                             size, file}; states reference their element via
 *                             parent_id.
 */
import { publicAssetUrl } from "../pixellab/templateAssetPaths";

export interface UiNineSlice {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface UiPlacement {
  ui_asset_id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  file: string;
  nineSlice?: UiNineSlice;
}

export interface UiLayoutDef {
  id?: string;
  name: string;
  screen?: { width: number; height: number };
  placements: UiPlacement[];
}

export interface UiIndexEntry {
  id: string;
  name: string;
  kind: "template" | "element" | "state";
  file: string;
  size?: { width: number; height: number } | null;
  parent_id?: string;
  group_id?: string;
  nine_slice?: UiNineSlice;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(publicAssetUrl(path));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function applyNineSlice(
  el: HTMLElement,
  file: string,
  slice: UiNineSlice,
  naturalSize: { width: number; height: number } | null | undefined,
  displayWidthPx: number,
): void {
  // border-image-slice is specified in SOURCE image pixels — exactly what the
  // stored insets are. Border widths scale with the same factor as the art so
  // corners stay chunky-pixel sized.
  const scale = naturalSize ? Math.max(1, displayWidthPx / naturalSize.width) : 1;
  el.style.borderStyle = "solid";
  el.style.borderWidth = `${slice.top * scale}px ${slice.right * scale}px ${slice.bottom * scale}px ${slice.left * scale}px`;
  el.style.borderImage = `url("${publicAssetUrl(file)}") ${slice.top} ${slice.right} ${slice.bottom} ${slice.left} fill stretch`;
  el.style.imageRendering = "pixelated";
}

export class UiLayout {
  private readonly container: HTMLDivElement;
  private readonly byName = new Map<string, HTMLElement>();
  private readonly placementByName = new Map<string, UiPlacement>();
  private readonly index: UiIndexEntry[];

  private constructor(layout: UiLayoutDef, index: UiIndexEntry[]) {
    this.index = index;
    const root = document.getElementById("hud-root");
    if (!root) {
      throw new Error("Missing #hud-root");
    }
    this.container = document.createElement("div");
    this.container.className = "ui-layout";
    this.container.dataset.layout = layout.name;
    // Fill the screen; individual controls re-enable pointer events.
    this.container.style.position = "absolute";
    this.container.style.inset = "0";
    this.container.style.pointerEvents = "none";
    root.appendChild(this.container);

    for (const placement of layout.placements) {
      const el = this.createPlacement(placement);
      this.container.appendChild(el);
      const key = (placement.name ?? placement.ui_asset_id).toLowerCase();
      this.byName.set(key, el);
      this.placementByName.set(key, placement);
    }
  }

  /** Load layouts.json (+ index.json) and mount the layout with this name. */
  static async mount(layoutName: string): Promise<UiLayout> {
    const overlays = await fetchJson<{ layouts: UiLayoutDef[] }>("assets/ui/layouts.json");
    const layout = overlays?.layouts.find(
      (candidate) =>
        candidate.name.toLowerCase() === layoutName.toLowerCase() ||
        candidate.id === layoutName,
    );
    if (!layout) {
      const names = overlays?.layouts.map((candidate) => candidate.name) ?? [];
      throw new Error(
        `UI layout "${layoutName}" not found. Available: ${names.join(", ") || "(none)"}`,
      );
    }
    const indexFile = await fetchJson<{ ui_assets: UiIndexEntry[] }>("assets/ui/index.json");
    return new UiLayout(layout, indexFile?.ui_assets ?? []);
  }

  private createPlacement(placement: UiPlacement): HTMLElement {
    let el: HTMLElement;
    if (placement.nineSlice) {
      el = document.createElement("div");
      const entry = this.index.find((candidate) => candidate.id === placement.ui_asset_id);
      applyNineSlice(
        el,
        placement.file,
        placement.nineSlice,
        entry?.size,
        placement.width * window.innerWidth,
      );
    } else {
      const img = document.createElement("img");
      img.src = publicAssetUrl(placement.file);
      img.alt = placement.name ?? "ui";
      img.draggable = false;
      img.style.imageRendering = "pixelated";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      el = document.createElement("div");
      el.appendChild(img);
    }
    el.style.position = "absolute";
    el.style.left = `${placement.x * 100}%`;
    el.style.top = `${placement.y * 100}%`;
    el.style.width = `${placement.width * 100}%`;
    el.style.height = `${placement.height * 100}%`;
    return el;
  }

  /** The DOM element for a placement (by its name in the layout). */
  element(name: string): HTMLElement | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /**
   * Make a placement clickable: wraps its content in a real <button> so the
   * playtest tool (DOM clicks only) can drive it. Returns the button.
   */
  onClick(name: string, handler: () => void): HTMLButtonElement {
    const el = this.element(name);
    if (!el) {
      throw new Error(`UI placement "${name}" not found in layout`);
    }
    let button = el.querySelector("button");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.style.all = "unset";
      button.style.position = "absolute";
      button.style.inset = "0";
      button.style.cursor = "pointer";
      button.setAttribute("aria-label", name);
      el.appendChild(button);
    }
    el.style.pointerEvents = "auto";
    button.addEventListener("click", handler);
    return button;
  }

  /**
   * Swap a placement's image to one of its element's states ("hover",
   * "pressed", ...), or back to the base image with stateName = null.
   * States are looked up in assets/ui/index.json via parent_id.
   */
  setState(name: string, stateName: string | null): void {
    const el = this.element(name);
    const placement = this.placementByName.get(name.toLowerCase());
    if (!el || !placement) {
      throw new Error(`UI placement "${name}" not found in layout`);
    }
    let file = placement.file;
    if (stateName) {
      const state = this.index.find(
        (candidate) =>
          candidate.kind === "state" &&
          candidate.parent_id === placement.ui_asset_id &&
          candidate.name.toLowerCase().includes(stateName.toLowerCase()),
      );
      if (!state) return; // no such state generated — keep the current image
      file = state.file;
    }
    const img = el.querySelector("img");
    if (img) {
      img.src = publicAssetUrl(file);
    } else if (placement.nineSlice) {
      const entry = this.index.find((candidate) => candidate.id === placement.ui_asset_id);
      applyNineSlice(el, file, placement.nineSlice, entry?.size, el.clientWidth);
    }
  }

  destroy(): void {
    this.container.remove();
  }
}
