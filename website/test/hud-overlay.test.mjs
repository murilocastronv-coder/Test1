import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { createServer } from "vite";

let HudOverlay;
let vite;

/** Just enough DOM for HudOverlay — it touches nothing else. */
function fakeElement(tag) {
  return {
    tag,
    className: "",
    textContent: "",
    children: [],
    listeners: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    remove() {
      this.removed = true;
    },
  };
}

function installDom() {
  const root = fakeElement("div");
  globalThis.document = {
    getElementById: (id) => (id === "hud-root" ? root : null),
    createElement: (tag) => fakeElement(tag),
  };
  return root;
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function buttonsUnder(root) {
  return descendants(root).filter((node) => node.className === "hud-button");
}

function textLinesUnder(root) {
  const panel = root.children[0];
  return panel.children[0].children.map((line) => line.textContent);
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  installDom();
  ({ HudOverlay } = await vite.ssrLoadModule("/src/hud/HudOverlay.ts"));
});

after(async () => {
  await vite.close();
  delete globalThis.document;
});

describe("HudOverlay", () => {
  let root;

  beforeEach(() => {
    root = installDom();
  });

  it("renders one div per line", () => {
    const hud = new HudOverlay();
    hud.setText(["SCORE 0", "press E"]);
    assert.deepEqual(textLinesUnder(root), ["SCORE 0", "press E"]);
  });

  it("rebuilds nothing when the text is unchanged", () => {
    const hud = new HudOverlay();
    hud.setText(["SCORE 0"]);
    const firstNode = root.children[0].children[0].children[0];
    hud.setText(["SCORE 0"]);
    assert.equal(root.children[0].children[0].children[0], firstNode);
    hud.setText(["SCORE 1"]);
    assert.notEqual(root.children[0].children[0].children[0], firstNode);
  });

  it("keeps buttons alive across a text update", () => {
    // setText runs from update(); when buttons shared the text container, every
    // HUD refresh silently deleted them.
    const hud = new HudOverlay();
    hud.addButton("Play again", () => {});
    hud.setText(["SCORE 1"]);
    assert.equal(buttonsUnder(root).length, 1);
  });

  it("does not stack buttons when the caller rebuilds them", () => {
    // The flip side: because setText no longer wipes buttons, a caller that adds
    // one on every state change must clear first. GameScene.updateHud does.
    const hud = new HudOverlay();
    for (const score of [1, 2, 3]) {
      hud.setText([`SCORE ${score}`]);
      hud.clearButtons();
      hud.addButton("Play again", () => {});
    }
    assert.equal(buttonsUnder(root).length, 1);
  });

  it("wires the click handler onto the button", () => {
    const hud = new HudOverlay();
    let clicks = 0;
    const button = hud.addButton("Play again", () => {
      clicks += 1;
    });
    button.listeners.click();
    assert.equal(clicks, 1);
    assert.equal(button.className, "hud-button");
  });

  it("removes the whole panel on destroy", () => {
    const hud = new HudOverlay();
    hud.setText(["SCORE 0"]);
    hud.destroy();
    assert.equal(root.children[0].removed, true);
  });
});
