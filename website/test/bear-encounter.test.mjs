import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { existsSync } from "node:fs";
import { createServer } from "vite";

// The bear is the template's demo encounter; a game that drops it drops this test too.
const skip = !existsSync(new URL("../src/gameplay/BearEncounter.ts", import.meta.url))
  && "src/gameplay/BearEncounter.ts is not in this project; delete this test file";

let vite;
let BearEncounter;
before(async () => {
  if (skip) return;
  vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ BearEncounter } = await vite.ssrLoadModule("/src/gameplay/BearEncounter.ts"));
});
after(async () => vite?.close());

function encounter() {
  const clips = [];
  const sprite = { x: 0, y: 0, clearTint() {}, setTint() {}, setAlpha() {} };
  const bear = {
    sprite, hitRadius: 10, stunned: false,
    hit() { return !this.stunned; },
    holdControlled() {},
    playControlled(clip) { clips.push(clip); return clip === "attack" ? 900 : 800; },
  };
  const player = { worldPosition: { x: 20, y: 0 }, sprite: { setAlpha() {} }, airborne: false };
  return { game: new BearEncounter(bear, player, {}), bear, player, clips };
}

test("bear telegraphs a sweep, damages once, recovers, then selects its jump attack", { skip }, () => {
  const { game, clips } = encounter();
  game.update(16);
  assert.equal(game.status.phase, "windup");
  game.update(599);
  assert.equal(game.status.playerHealth, 3);
  game.update(1);
  assert.equal(game.status.phase, "attack");
  assert.deepEqual(clips, ["walk", "attack"]);
  game.update(450);
  assert.equal(game.status.playerHealth, 2);
  game.update(100);
  assert.equal(game.status.playerHealth, 2);
  game.update(350);
  assert.equal(game.status.phase, "recover");
  assert.equal(game.status.attack, "jump-attack");
  game.update(1000);
  game.update(16);
  game.update(600);
  assert.equal(clips.at(-1), "jump-attack");
});

test("jumping over the sweep avoids damage", { skip }, () => {
  const { game, player } = encounter();
  game.update(16);
  game.update(600);
  player.airborne = true;
  game.update(450);
  assert.equal(game.status.playerHealth, 3);
});

test("moving behind or beyond a locked attack avoids damage", { skip }, () => {
  for (const x of [-20, 100]) {
    const { game, player } = encounter();
    game.update(16);
    game.update(600);
    player.worldPosition.x = x;
    game.update(450);
    assert.equal(game.status.playerHealth, 3);
  }
});

test("hits interrupt windup, respect hit stun, and finish the encounter exactly once", { skip }, () => {
  const { game, bear } = encounter();
  game.update(16);
  assert.equal(game.hit(20, 0, 200), true);
  assert.equal(game.status.phase, "recover");
  bear.stunned = true;
  assert.equal(game.hit(20, 0, 200), false);
  assert.equal(game.status.bearHealth, 5);
  bear.stunned = false;
  for (let i = 0; i < 5; i++) assert.equal(game.hit(20, 0, 200), true);
  assert.equal(game.status.phase, "won");
  assert.equal(game.hit(20, 0, 200), false);
  game.update(10000);
  assert.equal(game.status.bearHealth, 0);
});
