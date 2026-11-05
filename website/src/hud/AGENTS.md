# HUD And Screen Overlays

Screen-fixed UI: dialogue, menus, prompts, panels, tooltips, HUD. Render as DOM under `#hud-root`, not Phaser canvas — a canvas button can't be clicked or verified by the playtest tool, and a world-space `Container`/`Text`/`Rectangle` moves or vanishes as the camera follows the player.

- `#hud-root` is fixed over the canvas; keep it `pointer-events: none` so gameplay input reaches Phaser, and set `pointer-events: auto` only on the actual clickable controls.
- Bottom-center dialogue and the like: a child of `#hud-root` at `position:absolute; left:50%; bottom:24px; transform:translateX(-50%)` with explicit bg/border/padding/max-width/color, removed on close or scene shutdown.
- If a feature truly needs Phaser objects for fixed UI (decorative only, never clicked), position from `this.scale.width/height`, call `setScrollFactor(0)` on every root UI object, and set a high depth. Keep anything clickable in DOM though — playtest drives DOM, so a canvas control can't be verified even when it works.

## PixelLab UI assets + layouts
The user can generate pixel-art screen UI (panels, buttons, bars, split elements/states) in the UI Creator; it syncs to `assets/ui/{id}/ui.png` (transparent). It's screen UI — render it here. `assets/ui/index.json` lists each asset as `{id, name, kind: template|element|state, parent_id, nine_slice, size, file}` — a button's "pressed" is the entry with `kind:"state"` and `parent_id` = the element's id.

If `assets/ui/layouts.json` exists, the user arranged their UI into named screens — prefer their arrangement over inventing positions. `x/y/width/height` are 0..1 fractions of `screen` (the reference aspect they laid out against), so a layout reflows to any resolution:
```jsonc
{ "layouts": [ { "name": "in-game HUD", "screen": { "width": 480, "height": 270 },
  "placements": [ { "ui_asset_id": "...", "name": "health bar", "file": "assets/ui/<id>/ui.png",
                    "x": 0.05, "y": 0.04, "width": 0.3, "height": 0.06 } ] } ] }
```
Render with the `UiLayout` helper (`UiLayout.ts`) — it handles the fractions, `image-rendering: pixelated`, and `nineSlice` via CSS `border-image` (crisp corners at any size):
```ts
const hud = await UiLayout.mount("in-game HUD");
hud.onClick("start button", () => this.startGame()); // real <button> — playtest can click it
hud.setState("start button", "pressed");             // swap to the state image
hud.setState("start button", null);                  // back to base
hud.destroy();                                        // on scene shutdown
```
States (pressed/hover) are behaviors you swap on interaction, not separate placements. Place UI manually from `index.json` only when there's no layout.
