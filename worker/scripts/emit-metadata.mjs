/**
 * Build-time: convert wrangler.jsonc → dist/cf-metadata.json (Cloudflare upload-API shape).
 *
 * The platform deploy (/sandbox/deploy-worker) reads this JSON directly instead of
 * parsing wrangler.jsonc — JSONC has comments and the wrangler shape differs from the
 * Workers upload-API shape. `wrangler.jsonc` stays the dev source of truth (works with
 * `wrangler dev`); this is its compiled, machine-readable form.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const raw = readFileSync(join(workerRoot, "wrangler.jsonc"), "utf8")

// Strip /* */ block comments and // line comments. The `[^:]` guard before // avoids
// clobbering `https://` inside string values (always preceded by a colon).
const stripped = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n\r]*/g, "$1")
const cfg = JSON.parse(stripped)

const bindings = (cfg.durable_objects && cfg.durable_objects.bindings) || []
const sqliteClasses = (cfg.migrations || []).flatMap((m) => m.new_sqlite_classes || [])

const metadata = {
  main_module: "index.js",
  compatibility_date: cfg.compatibility_date,
  bindings: bindings.map((b) => ({
    type: "durable_object_namespace",
    name: b.name,
    class_name: b.class_name,
  })),
  // do_classes / sqlite_classes are consumed by the platform to compute the
  // migration delta (which classes are new vs already deployed for this project).
  do_classes: bindings.map((b) => b.class_name),
  sqlite_classes: sqliteClasses,
  // If this worker serves a static frontend, emit the assets config. The platform
  // uploads website/out and injects assets.jwt; presence of `assets` here is the
  // signal to run that upload flow. `assets_dir` tells the platform what to ship.
  assets: cfg.assets
    ? {
        assets_dir: cfg.assets.directory,
        binding: cfg.assets.binding || "ASSETS",
        config: { html_handling: "auto-trailing-slash", not_found_handling: "single-page-application" },
      }
    : undefined,
}

const distDir = join(workerRoot, "dist")
mkdirSync(distDir, { recursive: true })
const outPath = join(distDir, "cf-metadata.json")
writeFileSync(outPath, JSON.stringify(metadata, null, 2))
console.log(`[worker] wrote ${outPath}`)
