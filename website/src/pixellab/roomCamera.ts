import type Phaser from "phaser";

/**
 * Rooms (Create room, `assets/rooms/<id>/metadata.json`) one at a time. The camera keeps to
 * the room the player is in, zoomed to the largest whole number that fits it on screen
 * (pixel perfect, no empty margin), following the player inside a room bigger than that.
 *
 * Doors go by their `trigger`/`arrive` rects from the metadata. Two rooms' doors whose
 * anchors meet in the world are linked on their own; stepping into a linked door's trigger
 * fades to black, puts the player at the other door's `arrive` point (`place`), shows that
 * room and fades back in. The room left behind is never drawn beside the next one (a scroll
 * showing both read badly), and nobody walks over a back door painted in its wall: back doors
 * are not walkable, their trigger is the floor in front. Hold the player's input from
 * `onTransition`'s "start" to its "end".
 *
 * Collision: `roomBlockers(rooms)` is every wall exactly (each picture minus all rooms' walkable
 * areas), as rects for the map's blockers; walls guessed by hand let the player stand on a
 * wall top (2026-11-02). It also closes each picture's edge where no room's floor goes on, so a
 * doorway that joins no room (an exit the game handles itself) ends at the picture's edge.
 * A door fires only when the player heads into it (`facing`, else its movement): walking along a
 * back wall past its door crosses the floor in front of it, and a wall stops a player pushing
 * up against a back door, so movement alone would miss the push.
 */
export interface RoomDoor {
  side: string;
  /** Picture px, from metadata.json. */
  anchor: [number, number];
  trigger: [number, number, number, number];
  arrive: [number, number];
}

export interface CameraRoom {
  name: string;
  /** Where the room's picture stands, in world px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** metadata.json `doors`; left out, the room changes when the player walks out of `areas`. */
  doors?: RoomDoor[];
  /**
   * Where the player counts as in this room, in world px: the room's walkable rects moved to
   * where it stands. Left out, the picture. Needed when pictures overlap (shaped rooms).
   */
  areas?: Array<{ x: number; y: number; width: number; height: number }>;
  /** Shown only while the camera is on this room: its picture, furniture, NPCs... */
  objects?: Array<{ setVisible(visible: boolean): unknown }>;
}

export interface RoomCameraOptions {
  /** Camera follow lerp inside a room bigger than the view (the template's `GAME_CONFIG.camera.followLerp`). */
  lerp: number;
  /** Moves the player's sprite (world px) when it goes through a door. Needed when rooms have doors. */
  place?: (x: number, y: number) => void;
  /**
   * How far below the target's position its feet are (`GAME_CONFIG.player.footOffsetY`): rooms,
   * doors and arrivals go by the feet, which is where the walkable rects are.
   */
  footOffsetY?: number;
  /**
   * Which way the player is heading, from its input even when a wall stops it (the template's
   * `PlayerController.facing`: "north", "south-east"...). Left out, its movement is used.
   */
  facing?: () => string;
  /** Zoom each room to the largest whole number that fits it on screen (default true). */
  fit?: boolean;
  /** The fade out and back in together. */
  durationMs?: number;
  /** Called as a transition starts and ends: hold the player's input in between. */
  onTransition?: (from: CameraRoom, to: CameraRoom, phase: "start" | "end") => void;
}

export interface RoomCamera {
  /** The room the camera is on (the one it is moving to, during a transition). */
  readonly current: CameraRoom;
  readonly moving: boolean;
  /** Call every frame from the scene's update(). */
  update(): void;
}

/** A door of one room linked to the door it meets in another, in world px. */
export interface DoorLink {
  /** The door's side in `from`: the way the player must move to go through it. */
  side: string;
  from: CameraRoom;
  to: CameraRoom;
  trigger: { x: number; y: number; width: number; height: number };
  arrive: { x: number; y: number };
}

const DEFAULT_MS = 360;
const JOINS: Record<string, string> = { e: "w", w: "e", s: "n", n: "s" };

type Rect = { x: number; y: number; width: number; height: number };
const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/** The room whose areas (or picture) hold the point (x, y), right and bottom edges excluded. */
export function roomAt(rooms: readonly CameraRoom[], x: number, y: number): CameraRoom | undefined {
  return rooms.find((r) => (r.areas ?? [r]).some((a) => inside(a, x, y)));
}

/**
 * Every door that meets another room's: a right doorway and a left one, or a bottom doorway and
 * a back door, whose anchors stand on the same world point (rooms set by the anchors always do).
 */
export function linkRoomDoors(rooms: readonly CameraRoom[]): DoorLink[] {
  const links: DoorLink[] = [];
  for (const from of rooms) {
    for (const door of from.doors ?? []) {
      const ax = from.x + door.anchor[0];
      const ay = from.y + door.anchor[1];
      for (const to of rooms) {
        if (to === from) continue;
        const other = (to.doors ?? []).find(
          (d) => d.side === JOINS[door.side] && to.x + d.anchor[0] === ax && to.y + d.anchor[1] === ay,
        );
        if (!other) continue;
        const [x0, y0, x1, y1] = door.trigger;
        links.push({
          side: door.side,
          from,
          to,
          trigger: { x: from.x + x0, y: from.y + y0, width: x1 - x0, height: y1 - y0 },
          arrive: { x: to.x + other.arrive[0], y: to.y + other.arrive[1] },
        });
      }
    }
  }
  return links;
}

const EDGE = 16;

/**
 * Every wall of the rooms, exactly: each room's picture minus every room's walkable areas, as
 * rects in world px for the player's blockers (`objectBlockerIndex`), plus a band round each
 * picture where no room's floor goes on (an unjoined doorway's gap ends there, not in empty
 * space). Rooms without `areas` block nothing. Rects are merged along rows: a few dozen a room.
 */
export function roomBlockers(rooms: readonly CameraRoom[]): Rect[] {
  const walled = rooms
    .filter((r) => r.areas)
    .map((r) => ({ x: r.x - EDGE, y: r.y - EDGE, width: r.width + 2 * EDGE, height: r.height + 2 * EDGE }));
  const areas = rooms.flatMap((r) => r.areas ?? []);
  const xs = [...new Set(walled.flatMap((r) => [r.x, r.x + r.width]).concat(areas.flatMap((a) => [a.x, a.x + a.width])))].sort((a, b) => a - b);
  const ys = [...new Set(walled.flatMap((r) => [r.y, r.y + r.height]).concat(areas.flatMap((a) => [a.y, a.y + a.height])))].sort((a, b) => a - b);
  const blockers: Rect[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    let run: Rect | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const wall = walled.some((r) => inside(r, cx, cy)) && !areas.some((a) => inside(a, cx, cy));
      if (wall && run && run.x + run.width === xs[i]) run.width = xs[i + 1] - run.x;
      else if (wall) blockers.push((run = { x: xs[i], y: ys[j], width: xs[i + 1] - xs[i], height: ys[j + 1] - ys[j] }));
      else run = null;
    }
  }
  return blockers;
}

/** The largest whole-number zoom that shows all of the room (at least 1). */
export function fitZoom(room: CameraRoom, screenWidth: number, screenHeight: number): number {
  return Math.max(1, Math.floor(Math.min(screenWidth / room.width, screenHeight / room.height)));
}

/**
 * Where the camera centres on a room for a target at (x, y): on the target, kept inside the
 * room on each axis, or on the room's middle along an axis where the room is smaller than
 * the view. The same place follow + `roomCameraBounds` settle on.
 */
export function roomCameraCenter(
  room: CameraRoom,
  viewWidth: number,
  viewHeight: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const axis = (start: number, size: number, view: number, at: number) =>
    size <= view ? start + size / 2 : Math.min(Math.max(at, start + view / 2), start + size - view / 2);
  return {
    x: axis(room.x, room.width, viewWidth, x),
    y: axis(room.y, room.height, viewHeight, y),
  };
}

/**
 * Camera bounds for a room: the room, grown to the view's size round its middle where it is
 * smaller. Phaser pins a camera to the top-left of bounds smaller than its view, which drew a
 * small room in the screen's corner.
 */
export function roomCameraBounds(room: CameraRoom, viewWidth: number, viewHeight: number): Rect {
  const width = Math.max(room.width, viewWidth);
  const height = Math.max(room.height, viewHeight);
  return { x: room.x + (room.width - width) / 2, y: room.y + (room.height - height) / 2, width, height };
}

export function startRoomCamera(
  scene: Phaser.Scene,
  rooms: readonly CameraRoom[],
  target: { x: number; y: number },
  options: RoomCameraOptions,
): RoomCamera {
  const camera = scene.cameras.main;
  const half = (options.durationMs ?? DEFAULT_MS) / 2;
  const foot = options.footOffsetY ?? 0;
  const links = linkRoomDoors(rooms);
  if (links.length && !options.place) {
    throw new Error("startRoomCamera: rooms with linked doors need options.place to move the player through them");
  }
  const first = roomAt(rooms, target.x, target.y + foot);
  if (!first) {
    throw new Error(
      `startRoomCamera: the target at (${target.x}, ${target.y}) is in none of the rooms ` +
        `(${rooms.map((r) => `${r.name} ${r.x},${r.y} ${r.width}x${r.height}`).join("; ")})`,
    );
  }
  let current = first;
  let moving = false;
  let last = { x: target.x, y: target.y };
  // heading into the door: east for a right doorway, north for a back door...
  const WAYS: Record<string, string> = { e: "east", w: "west", s: "south", n: "north" };
  const into = (side: string, dx: number, dy: number) =>
    options.facing
      ? options.facing().includes(WAYS[side])
      : ({ e: dx > 0, w: dx < 0, s: dy > 0, n: dy < 0 })[side] ?? false;

  const show = (room: CameraRoom, visible: boolean) => room.objects?.forEach((o) => o.setVisible(visible));
  const settle = (room: CameraRoom) => {
    if (options.fit ?? true) camera.setZoom(fitZoom(room, camera.width, camera.height));
    const viewWidth = camera.width / camera.zoom;
    const viewHeight = camera.height / camera.zoom;
    const b = roomCameraBounds(room, viewWidth, viewHeight);
    camera.setBounds(b.x, b.y, b.width, b.height);
    const c = roomCameraCenter(room, viewWidth, viewHeight, target.x, target.y);
    camera.centerOn(c.x, c.y);
    camera.startFollow(target, true, options.lerp, options.lerp);
  };

  const go = (to: CameraRoom, arrive?: { x: number; y: number }) => {
    const from = current;
    current = to;
    moving = true;
    options.onTransition?.(from, to, "start");
    camera.stopFollow();
    camera.fadeOut(half, 0, 0, 0, (_cam: Phaser.Cameras.Scene2D.Camera, out: number) => {
      if (out < 1) return;
      if (arrive) {
        options.place!(arrive.x, arrive.y - foot);
        last = { x: arrive.x, y: arrive.y - foot };
      }
      show(from, false);
      show(to, true);
      settle(to);
      camera.fadeIn(half, 0, 0, 0, (_c: Phaser.Cameras.Scene2D.Camera, back: number) => {
        if (back < 1) return;
        moving = false;
        options.onTransition?.(from, to, "end");
      });
    });
  };

  for (const room of rooms) show(room, room === current);
  settle(current);
  // The scale manager is the game's: a scene restarted (back from another map) would otherwise
  // leave its old listener settling a camera that is gone.
  const onResize = () => {
    if (!moving) settle(current);
  };
  scene.scale.on("resize", onResize);
  scene.events.once("shutdown", () => scene.scale.off("resize", onResize));

  return {
    get current() {
      return current;
    },
    get moving() {
      return moving;
    },
    update() {
      const dx = target.x - last.x;
      const dy = target.y - last.y;
      last = { x: target.x, y: target.y };
      if (moving) return;
      const door = links.find(
        (l) => l.from === current && into(l.side, dx, dy) && inside(l.trigger, target.x, target.y + foot),
      );
      if (door) {
        go(door.to, door.arrive);
        return;
      }
      const next = roomAt(rooms, target.x, target.y + foot);
      if (next && next !== current) go(next);
    },
  };
}
