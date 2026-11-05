/**
 * GameMap — one Durable Object instance per map.
 *
 * Holds the players currently connected to this map and broadcasts their movement.
 * Hibernation-safe: per-connection state lives in the WebSocket *attachment*, so it
 * survives the DO hibernating between messages (in-memory vars do not). On a new
 * connection we send a join snapshot; on disconnect we broadcast a leave.
 */
import { DurableObject } from "cloudflare:workers"

type Pos = { x: number; y: number } | null

interface PlayerAttachment {
  id: string
  pos: Pos
  // rolling 1s window for per-connection rate limiting
  window: { start: number; count: number }
}

interface PlayerSnapshot {
  id: string
  pos: Pos
}

const MAX_MESSAGES_PER_SECOND = 30

// A position frame is tiny (e.g. {"x":-12345,"y":-12345} ~30 bytes). Anything bigger
// is rejected so a client can't rebroadcast a large payload to every peer (amplification).
const MAX_FRAME_BYTES = 128
// World-coordinate clamp; non-finite or out-of-range coords are rejected.
const COORD_LIMIT = 1_000_000

/**
 * Parse + validate an UNTRUSTED position frame from a client. Returns a clean
 * {x, y} (extra fields stripped, coords finite + clamped) or null to ignore the
 * frame. Never trust the wire: clients can send any JSON, and whatever we accept
 * is rebroadcast to every other player in the room.
 */
function parsePosition(text: string): { x: number; y: number } | null {
  if (text.length > MAX_FRAME_BYTES) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const { x, y } = raw as { x?: unknown; y?: unknown }
  if (typeof x !== "number" || typeof y !== "number") return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const clamp = (v: number): number => Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(v)))
  return { x: clamp(x), y: clamp(y) }
}

export class GameMap extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    // Non-WebSocket requests hit this DO's server-side HTTP API (see handleApi).
    // The same DO class serves both: per-room instances handle multiplayer sockets,
    // and a fixed "global-stats" instance (routed from index.ts) handles /api/jumps.
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return this.handleApi(req)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.ctx.acceptWebSocket(server) // hibernatable WebSocket → idle = $0

    const att: PlayerAttachment = {
      id: crypto.randomUUID(), // ephemeral, DO-assigned player id
      pos: null,
      window: { start: 0, count: 0 },
    }
    server.serializeAttachment(att)

    // Join snapshot: tell the newcomer where everyone else currently is.
    server.send(
      JSON.stringify({ type: "snapshot", you: att.id, players: this.otherPlayers(server) }),
    )

    return new Response(null, { status: 101, webSocket: client })
  }

  // ── EXAMPLE: server-side persistence ──────────────────────────────────────
  // A global "jumps" counter, shared by everyone who plays this game and saved in
  // Durable Object storage so it survives restarts / sessions. `ctx.storage` is a
  // tiny per-DO key-value store. GET reads it; POST increments it. Copy this
  // pattern (route in index.ts → this DO → ctx.storage) for leaderboards, save
  // slots, daily challenges, etc. — or delete it if your game needs no server state.
  // Client: website/src/net/serverStats.ts + JumpCounterExample.ts.
  private async handleApi(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === "/api/jumps") {
      const stored = (await this.ctx.storage.get("jumps")) as number | undefined
      if (req.method === "GET") {
        return Response.json({ jumps: stored ?? 0 })
      }
      if (req.method === "POST") {
        const jumps = (stored ?? 0) + 1
        await this.ctx.storage.put("jumps", jumps)
        return Response.json({ jumps })
      }
    }
    return new Response("not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as PlayerAttachment | null
    if (!att) return
    if (this.rateLimited(ws, att)) return

    const text = typeof message === "string" ? message : new TextDecoder().decode(message)
    const pos = parsePosition(text)
    if (!pos) return // ignore malformed / oversized / out-of-range frames

    att.pos = pos
    ws.serializeAttachment(att)

    const out = JSON.stringify({ type: "move", id: att.id, pos })
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws) peer.send(out)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as PlayerAttachment | null
    if (!att) return
    const out = JSON.stringify({ type: "leave", id: att.id })
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== ws) peer.send(out)
    }
  }

  private otherPlayers(self: WebSocket): PlayerSnapshot[] {
    const players: PlayerSnapshot[] = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === self) continue
      const att = ws.deserializeAttachment() as PlayerAttachment | null
      if (att && att.pos) players.push({ id: att.id, pos: att.pos })
    }
    return players
  }

  /** Per-connection rolling-window rate limit; persists the window in the attachment. */
  private rateLimited(ws: WebSocket, att: PlayerAttachment): boolean {
    const now = Date.now()
    if (now - att.window.start >= 1000) {
      att.window.start = now
      att.window.count = 0
    }
    att.window.count += 1
    ws.serializeAttachment(att)
    return att.window.count > MAX_MESSAGES_PER_SECOND
  }
}
