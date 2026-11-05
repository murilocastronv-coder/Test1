/**
 * Worker entry — one origin serves the whole game: frontend, API, and multiplayer.
 *
 *   GET  /            → the static Phaser build (Workers Static Assets, env.ASSETS)
 *   *    /api/*        → server-side HTTP API (game logic, leaderboards, ...)
 *   WS   /room/:id     → the room's Durable Object (real-time multiplayer/presence)
 *
 * Because the frontend is served by THIS worker, the game's own calls are same-origin
 * (no CORS needed). The Origin allowlist stays as defense-in-depth for the WebSocket,
 * and CORS headers are added for any genuinely cross-origin caller (e.g. a dev preview
 * still on *.dev.pixellab.run, or the PixelLab editor).
 *
 * env.PIXELLAB_API_TOKEN (a worker SECRET set at deploy) is available for server-side
 * calls back to PixelLab — never exposed to the browser.
 */
import { GameMap } from "./durable-objects/GameMap"

// Re-export so wrangler can bind the Durable Object class.
export { GameMap }

export interface Env {
  ASSETS: Fetcher
  MAP: DurableObjectNamespace
  PIXELLAB_API_TOKEN?: string
}

// Allow the game's own origins: the worker itself `{slug}.pixellab.run` and static
// previews `{slug}[--branch].dev.pixellab.run`. The `[a-z0-9.-]+` allows multi-label
// preview subdomains; pixelheart.run is kept for legacy deploys on the old domain.
const allowedOrigin = (o: string): boolean =>
  /^https:\/\/[a-z0-9.-]+\.(pixelheart\.run|pixellab\.run)$/i.test(o)

function withCors(res: Response, origin: string): Response {
  if (origin && allowedOrigin(origin)) {
    // A Response returned from `fetch()` / a Durable Object `stub.fetch()` has IMMUTABLE
    // headers — calling res.headers.set() on it throws ("Can't modify immutable headers"),
    // which surfaces as a 500 "Worker threw exception". The browser sends an Origin header
    // on same-origin POSTs (but not same-origin GETs), so this broke every DO-backed /api
    // route (e.g. POST /api/jumps) only from the browser. Copy into a fresh, mutable
    // Response before setting CORS headers.
    res = new Response(res.body, res)
    res.headers.set("Access-Control-Allow-Origin", origin)
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res.headers.set("Access-Control-Allow-Headers", "Content-Type")
  }
  return res
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const origin = req.headers.get("Origin") ?? ""

    if (req.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin)
    }

    // Multiplayer: /room/:id → that room's Durable Object instance (WebSocket).
    if (url.pathname.startsWith("/room/")) {
      if (!allowedOrigin(origin)) {
        return new Response("forbidden origin", { status: 403 })
      }
      if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 })
      }
      const roomId = url.pathname.split("/")[2]
      if (!roomId) return new Response("missing room id", { status: 400 })
      const stub = env.MAP.get(env.MAP.idFromName(roomId)) // one DO per room id
      return stub.fetch(req)
    }

    // HTTP API: add server-side game endpoints here (state, leaderboards, ...).
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health") {
        return withCors(Response.json({ ok: true }), origin)
      }
      // EXAMPLE — persistent server state: route /api/jumps to a single fixed
      // Durable Object instance ("global-stats") so all players share one counter
      // that survives restarts. See GameMap.handleApi + website/src/net/serverStats.ts.
      if (url.pathname === "/api/jumps") {
        const stub = env.MAP.get(env.MAP.idFromName("global-stats"))
        return withCors(await stub.fetch(req), origin)
      }
      return withCors(new Response("not found", { status: 404 }), origin)
    }

    // Hashed build assets AND atlases must fail LOUDLY when missing. With SPA `not_found_handling`
    // a missing `/assets/<hash>.js` or `/atlases/char-<id>.json` is otherwise served as 200
    // index.html, so the browser tries to execute/parse HTML ("Unexpected token '<'") — a
    // partial/stale deploy or an overflowed atlas turns into a cryptic runtime error instead of a
    // clean 404.
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/atlases/")) {
      const res = await env.ASSETS.fetch(req)
      if ((res.headers.get("content-type") ?? "").includes("text/html")) {
        return new Response("asset not found", { status: 404 })
      }
      return res
    }

    // Everything else → the static frontend (SPA fallback to index.html via the binding),
    // so a bare/shared deep link still loads the game.
    return env.ASSETS.fetch(req)
  },
}
