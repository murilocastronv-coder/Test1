# Worker (server) — `worker/`

A Cloudflare Worker serves the game AND a server-side backend on one origin (`{slug}.pixellab.run`). Use it for anything shared between players or persisted between sessions — leaderboards, saves, global counters, presence/multiplayer. You can edit it; `wrangler deploy` ships it automatically when a `worker/` folder exists (frontend + `/api` + `/room`).

## Files
- `src/index.ts` — router: `/` → static game, `/api/*` → HTTP API, `/room/:id` → multiplayer DO.
- `src/durable-objects/GameMap.ts` — the Durable Object: real-time rooms (`webSocketMessage`/`webSocketClose`) AND the HTTP API (`handleApi`). `this.ctx.storage` is a small persistent KV store.
- `wrangler.jsonc` — bindings (`ASSETS` static files, `MAP` the GameMap DO). `scripts/emit-metadata.mjs` — deploy metadata (DO migrations, asset config).

## Add a server feature (pattern — there's a worked `/api/jumps` example)
1. **Route** in `src/index.ts` → a DO instance; one fixed id = global state:
```ts
if (url.pathname === "/api/jumps") {
  const stub = env.MAP.get(env.MAP.idFromName("global-stats"))
  return withCors(await stub.fetch(req), origin)
}
```
2. **Handle + persist** in `GameMap.handleApi()` with `this.ctx.storage`. VALIDATE the body first — it's untrusted (`req.json()` throws on bad JSON → return 400; bound type/finite/range; never store a client number raw):
```ts
const n = (await this.ctx.storage.get("jumps")) as number | undefined
if (req.method === "POST") await this.ctx.storage.put("jumps", (n ?? 0) + 1)
return Response.json({ jumps: n ?? 0 })
```
3. **Call from the game** with `fetch(`${workerOrigin()}/api/...`)` (no token). `workerOrigin()` (`website/src/net/workerOrigin.ts`) is `""` same-origin and the worker's URL from a static/branch preview, so calls work from either — never hard-code a domain (use `workerWsBase()` for WebSockets). If the worker was never deployed, `/api/*` fails from a preview, so degrade gracefully.

- One `GameMap` **class**, many **instances**: a per-room id for multiplayer, a fixed id for global state; each instance has its own storage. A new DO **class** needs a `wrangler.jsonc` binding + an `emit-metadata.mjs` migration, so reusing `GameMap` with a fixed instance avoids that.
- The owner's PixelLab token is server-side only as `env.PIXELLAB_API_TOKEN` (a worker secret) — never expose it to the browser.

## Deploy + debug (`wrangler`, restricted to `deploy`+`tail`, via `bash`)
- `wrangler deploy` — build + deploy (frontend + `/api` + `/room`), then a page-load smoke test reporting `game loaded without errors` or the runtime errors it found. Run it plain — not `npx wrangler`, and don't `cd` first (it auto-detects the worker and always builds the whole project).
- `wrangler tail` — this worker's live logs including uncaught exceptions. The smoke test can't see a 500 on an `/api` POST (Cloudflare shows an opaque "Worker threw exception" 1101 while the page still loads), so after deploying, exercise the route then `wrangler tail` for the real stack.
- 1101 gotcha: `res.headers.set()` throws on a Response from `fetch()` or a DO `stub.fetch()` (immutable headers). Browsers send `Origin` on same-origin POSTs (not GETs), so a CORS-wrapping helper can 500 every `/api` POST while curl/GET look fine — copy into `new Response(res.body, res)` before setting headers.
