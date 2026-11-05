/**
 * Where this project's Cloudflare Worker (the game server: /api/*, /room/:id) lives.
 *
 * Normally the worker serves the game itself at `{slug}.pixellab.run`, so the server
 * is simply same-origin and relative fetches work. But the game can also be served
 * from a static preview — `{slug}.dev.pixellab.run` or a branch preview
 * `{slug}--{branch}.dev.pixellab.run` (S3/CloudFront) — where /api and /room don't
 * exist. There the server is still the project's MAIN worker, reached cross-origin
 * (the worker sends CORS headers for *.dev.pixellab.run and Origin-checks the socket).
 *
 * Use these helpers for every server call so gameplay code never hard-codes a domain.
 */
const WORKER_DOMAIN = "pixellab.run";

/** "" when the server is same-origin; otherwise "https://{slug}.pixellab.run". */
export function workerOrigin(): string {
  const host = location.hostname;
  if (!host.endsWith(`.dev.${WORKER_DOMAIN}`)) return ""; // served by the worker itself
  const slug = host.split(".")[0].split("--")[0]; // strip any branch-preview suffix
  return `https://${slug}.${WORKER_DOMAIN}`;
}

/** WebSocket base for the worker ("wss://..."), matching workerOrigin(). */
export function workerWsBase(): string {
  const origin = workerOrigin();
  return origin ? origin.replace(/^https:/, "wss:") : `wss://${location.host}`;
}
