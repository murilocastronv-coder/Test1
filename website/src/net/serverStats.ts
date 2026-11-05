/**
 * EXAMPLE: calling the worker's server-side API.
 *
 * The pattern is: GET to read persisted state, POST to mutate it. The state lives in
 * a Durable Object (see worker/src/durable-objects/GameMap.ts → handleApi), so it
 * survives restarts and is shared across all players / sessions. `workerOrigin()`
 * resolves the server no matter where the game is served from — same-origin on the
 * worker (`{slug}.pixellab.run`), cross-origin from a static/branch preview.
 *
 * Extend this for leaderboards, save slots, daily challenges, etc. — or delete it
 * (and the /api/jumps route + JumpCounterExample) if your game needs no server state.
 *
 * NOTE: if the project's worker has never been deployed, `/api/jumps` fails;
 * these helpers degrade to 0.
 */
import { workerOrigin } from "./workerOrigin";

/** Total jumps by everyone who has ever played this game (persisted server-side). */
export async function fetchGlobalJumps(): Promise<number> {
  try {
    const res = await fetch(`${workerOrigin()}/api/jumps`);
    if (!res.ok) return 0;
    const data = (await res.json()) as { jumps?: number };
    return data.jumps ?? 0;
  } catch {
    return 0;
  }
}

/** Record one jump on the server and return the new global total. */
export async function recordGlobalJump(): Promise<number> {
  try {
    const res = await fetch(`${workerOrigin()}/api/jumps`, { method: "POST" });
    if (!res.ok) return 0;
    const data = (await res.json()) as { jumps?: number };
    return data.jumps ?? 0;
  } catch {
    return 0;
  }
}
