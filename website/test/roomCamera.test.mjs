import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createServer } from "vite";

let rc;
let vite;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  rc = await vite.ssrLoadModule("/src/pixellab/roomCamera.ts");
});

after(async () => {
  await vite.close();
});

// Doors as metadata.json gives them (picture px), for the full-grid rooms of the tests.
const DOORS = {
  e: { side: "e", anchor: [256, 112], trigger: [240, 152, 256, 176], arrive: [226, 160] },
  w: { side: "w", anchor: [0, 112], trigger: [0, 152, 16, 176], arrive: [30, 160] },
  s: { side: "s", anchor: [112, 256], trigger: [112, 240, 144, 256], arrive: [128, 226] },
  n: { side: "n", anchor: [112, 0], trigger: [112, 48, 144, 64], arrive: [128, 78] },
};
const visible = () => ({ shown: null, setVisible(v) { this.shown = v; } });
const room = (name, x, y, sides) => ({
  name, x, y, width: 256, height: 256, doors: sides.map((s) => DOORS[s]), objects: [visible()],
});
// The wizard house: library | study | bedroom, an observatory over the library, a cellar under the bedroom.
const house = () => [
  room("library", 0, 256, ["e", "n"]),
  room("study", 256, 256, ["w", "e"]),
  room("bedroom", 512, 256, ["w", "s"]),
  room("observatory", 0, 0, ["s"]),
  room("cellar", 512, 512, ["n"]),
];
const shown = (rooms) => Object.fromEntries(rooms.map((r) => [r.name, r.objects[0].shown]));

// An 800x800 screen: a 256 px room fits 3x.
function fakeScene() {
  const camera = {
    width: 800,
    height: 800,
    zoom: 1,
    calls: [],
    setZoom(z) { this.zoom = z; this.calls.push(["setZoom", z]); return this; },
    setBounds(...a) { this.calls.push(["setBounds", ...a]); return this; },
    startFollow() { this.calls.push(["startFollow"]); return this; },
    stopFollow() { this.calls.push(["stopFollow"]); return this; },
    centerOn(x, y) { this.calls.push(["centerOn", x, y]); return this; },
    fadeOut(ms, r, g, b, cb) { this.calls.push(["fadeOut"]); this.done = () => cb(this, 1); return this; },
    fadeIn(ms, r, g, b, cb) { this.calls.push(["fadeIn"]); this.done = () => cb(this, 1); return this; },
  };
  const scale = { listeners: [], on(e, f) { this.listeners.push(f); }, off(e, f) { this.listeners = this.listeners.filter((g) => g !== f); } };
  const events = { once(e, f) { this.shutdown = f; } };
  return { cameras: { main: camera }, scale, events, camera };
}
const last = (camera, name) => camera.calls.filter((c) => c[0] === name).at(-1);

describe("roomCamera", () => {
  it("links every door to the one its anchor meets, both ways", () => {
    const links = rc.linkRoomDoors(house()).map((l) => `${l.from.name}>${l.to.name}`).sort();
    assert.deepEqual(links, [
      "bedroom>cellar", "bedroom>study", "cellar>bedroom", "library>observatory",
      "library>study", "observatory>library", "study>bedroom", "study>library",
    ]);
  });

  it("zooms a room to the largest whole number that fits it on screen", () => {
    assert.equal(rc.fitZoom(room("r", 0, 0, []), 800, 800), 3);
    assert.equal(rc.fitZoom(room("r", 0, 0, []), 800, 600), 2);
    assert.equal(rc.fitZoom(room("r", 0, 0, []), 200, 200), 1);
  });

  it("starts on the player's room, zoomed to fit and centred, only that room shown", () => {
    const rooms = house();
    const scene = fakeScene();
    rc.startRoomCamera(scene, rooms, { x: 384, y: 406 }, { lerp: 0.1, place() {} });
    assert.equal(scene.camera.zoom, 3);
    assert.deepEqual(last(scene.camera, "centerOn"), ["centerOn", 384, 384]);
    assert.equal(shown(rooms).study, true);
    assert.equal(Object.values(shown(rooms)).filter(Boolean).length, 1);
  });

  it("goes up through a back door: fade, arrive inside the room above, never two rooms shown", () => {
    const rooms = house();
    const scene = fakeScene();
    const player = { x: 128, y: 330 }; // in the library, under its back door
    const phases = [];
    const cam = rc.startRoomCamera(scene, rooms, player, {
      lerp: 0.1,
      place: (x, y) => Object.assign(player, { x, y }),
      onTransition: (from, to, phase) => phases.push(`${from.name}>${to.name}:${phase}`),
    });
    player.y = 256 + 56; // walked up into the floor in front of the back door
    cam.update();
    assert.equal(cam.current.name, "observatory");
    assert.equal(shown(rooms).observatory, false); // still the library while it fades out
    scene.camera.done(); // black: moved and swapped
    assert.deepEqual(player, { x: 128, y: 226 }); // the observatory's bottom doorway, inside
    assert.equal(shown(rooms).observatory, true);
    assert.equal(shown(rooms).library, false);
    cam.update(); // arriving is outside every trigger: no bounce back
    assert.deepEqual(phases, ["library>observatory:start"]);
    scene.camera.done(); // faded in
    assert.deepEqual(phases, ["library>observatory:start", "library>observatory:end"]);
    cam.update();
    assert.equal(cam.current.name, "observatory");
  });

  it("goes through a side doorway to the next room's arrive point", () => {
    const rooms = house();
    const scene = fakeScene();
    const player = { x: 384, y: 416 };
    const cam = rc.startRoomCamera(scene, rooms, player, { lerp: 0.1, place: (x, y) => Object.assign(player, { x, y }) });
    player.x = 256 + 8; // into the study's left doorway, below the wall end at its top
    cam.update();
    scene.camera.done();
    assert.deepEqual(player, { x: 226, y: 416 });
    assert.equal(cam.current.name, "library");
  });

  it("does not take a player walking along the back wall past a back door through it", () => {
    const rooms = house();
    const scene = fakeScene();
    const player = { x: 100, y: 256 + 56 }; // feet against the library's back wall, left of its door
    const cam = rc.startRoomCamera(scene, rooms, player, { lerp: 0.1, place: (x, y) => Object.assign(player, { x, y }) });
    for (const x of [110, 120, 130, 140, 150]) {
      player.x = x; // sideways across the floor in front of the door
      cam.update();
    }
    assert.equal(cam.current.name, "library");
    assert.equal(scene.camera.calls.some((c) => c[0] === "fadeOut"), false);
  });

  it("with facing, goes through a back door a wall stops the player at, and not when facing along it", () => {
    const rooms = house();
    const scene = fakeScene();
    const player = { x: 128, y: 256 + 52 }; // already standing in front of the library's back door
    let facing = "east";
    const cam = rc.startRoomCamera(scene, rooms, player, {
      lerp: 0.1, facing: () => facing, place: (x, y) => Object.assign(player, { x, y }),
    });
    cam.update(); // walked here sideways: no
    assert.equal(cam.current.name, "library");
    facing = "north"; // pushing up against the wall: does not move, goes through
    cam.update();
    assert.equal(cam.current.name, "observatory");
  });

  it("ends an unjoined doorway at the picture's edge, a joined one runs on into the next room", () => {
    const study = room("study", 256, 256, ["s"]);
    study.areas = [
      { x: 272, y: 304, width: 224, height: 192 }, // floor
      { x: 368, y: 496, width: 32, height: 16 }, // the bottom doorway's gap, joining no room
    ];
    const blockers = rc.roomBlockers([study]);
    const blocked = (x, y) => blockers.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);
    assert.equal(blocked(384, 505), false); // in the gap: a game's own exit can fire there
    assert.equal(blocked(384, 515), true); // past the picture's edge: no walking into empty space
    const below = { name: "cellar", x: 256, y: 512, width: 256, height: 256, areas: [{ x: 368, y: 512, width: 32, height: 40 }] };
    const both = rc.roomBlockers([study, below]);
    assert.equal(both.some((b) => 384 >= b.x && 384 < b.x + b.width && 515 >= b.y && 515 < b.y + b.height), false);
  });

  it("drops its resize listener when the scene shuts down", () => {
    const scene = fakeScene();
    rc.startRoomCamera(scene, house(), { x: 384, y: 406 }, { lerp: 0.1, place() {} });
    assert.equal(scene.scale.listeners.length, 1);
    scene.events.shutdown();
    assert.equal(scene.scale.listeners.length, 0);
  });

  it("needs place() when rooms have linked doors, and refuses a player in no room", () => {
    assert.throws(() => rc.startRoomCamera(fakeScene(), house(), { x: 384, y: 406 }, { lerp: 0.1 }), /place/);
    assert.throws(
      () => rc.startRoomCamera(fakeScene(), [room("study", 256, 0, [])], { x: 10, y: 10 }, { lerp: 0.1 }),
      /in none of the rooms/,
    );
  });

  it("walls are exactly each picture minus the walkable areas, nothing of the floor or doorways", () => {
    // a 256 px room: floor 16..240 x 48..240, a bottom doorway gap 112..144 x 240..256
    const r = {
      name: "r", x: 100, y: 100, width: 256, height: 256,
      areas: [{ x: 116, y: 148, width: 224, height: 192 }, { x: 212, y: 340, width: 32, height: 16 }],
    };
    const blockers = rc.roomBlockers([r]);
    const blocked = (x, y) => blockers.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);
    let area = 0;
    for (const b of blockers) area += b.width * b.height;
    // the picture and the 16 px band closing its edge, minus the floor and the gap
    assert.equal(area, 288 * 288 - 224 * 192 - 32 * 16);
    assert.equal(blocked(200, 250), false); // floor
    assert.equal(blocked(220, 345), false); // the doorway gap
    assert.equal(blocked(150, 345), true); // the bottom wall's top beside it: no standing on it
    assert.equal(blocked(200, 120), true); // the back wall
    assert.ok(blockers.length < 12);
  });

  it("goes by the player's feet when given footOffsetY, and places the sprite above its feet", () => {
    const rooms = house();
    const scene = fakeScene();
    const player = { x: 128, y: 330 };
    const cam = rc.startRoomCamera(scene, rooms, player, {
      lerp: 0.1, footOffsetY: 10, place: (x, y) => Object.assign(player, { x, y }),
    });
    player.y = 256 + 56 - 10; // feet in the floor strip before the library's back door
    cam.update();
    scene.camera.done();
    assert.deepEqual(player, { x: 128, y: 216 }); // feet on the observatory's arrive point (226)
    assert.equal(cam.current.name, "observatory");
  });

  it("goes by a room's walkable areas where pictures overlap", () => {
    const hall = { name: "hall", x: 0, y: 0, width: 256, height: 256, areas: [{ x: 16, y: 48, width: 224, height: 208 }] };
    const cellar = { name: "cellar", x: 0, y: 200, width: 256, height: 256, areas: [{ x: 16, y: 312, width: 224, height: 128 }] };
    assert.equal(rc.roomAt([hall, cellar], 100, 230).name, "hall");
    assert.equal(rc.roomAt([hall, cellar], 100, 320).name, "cellar");
    assert.equal(rc.roomAt([hall, cellar], 100, 280), undefined);
  });
});
