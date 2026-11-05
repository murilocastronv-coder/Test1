/**
 * Minimal multiplayer client.
 *
 * Opens a WebSocket to this project's worker for a given room and relays player
 * positions. There is NO auth token in the client — the worker Origin-checks the
 * connection and the Durable Object assigns an ephemeral player id. The room id is
 * any string that groups players together (e.g. the current map/level id). The
 * worker is resolved via workerWsBase(), so this works from the worker origin and
 * from static/branch previews alike.
 *
 * Not wired into the game by default. Call connectMultiplayer() from your scene once
 * you want shared movement, e.g.:
 *
 *   const mp = connectMultiplayer(roomId, (e) => { ... })
 *   // each tick:  mp.sendPosition({ x: player.x, y: player.y })
 */
import { workerWsBase } from "./workerOrigin";

export interface RemoteEvent {
  type: "snapshot" | "move" | "leave"
  /** present on "snapshot": your DO-assigned id */
  you?: string
  /** present on "move" / "leave": the other player's id */
  id?: string
  /** present on "move" */
  pos?: { x: number; y: number } | null
  /** present on "snapshot": everyone else's current positions */
  players?: { id: string; pos: { x: number; y: number } | null }[]
}

export interface MultiplayerHandle {
  sendPosition: (pos: { x: number; y: number }) => void
  close: () => void
}

/**
 * @param roomId the room the player is in (e.g. the map/level id)
 * @param onEvent receives snapshot / move / leave events from the worker
 */
export function connectMultiplayer(
  roomId: string,
  onEvent: (event: RemoteEvent) => void,
): MultiplayerHandle {
  const ws = new WebSocket(`${workerWsBase()}/room/${encodeURIComponent(roomId)}`)

  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data as string) as RemoteEvent)
    } catch {
      /* ignore malformed frames */
    }
  }

  return {
    sendPosition: (pos) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pos))
    },
    close: () => ws.close(),
  }
}
