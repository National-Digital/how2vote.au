#!/usr/bin/env node
/**
 * Service-worker precache gate. Run after `vite build`.
 *
 * The service worker precaches its asset list with one atomic `cache.addAll()`, so a single
 * unfetchable path rejects the install and disables offline support. This asserts the built worker
 * references no path that Cloudflare Pages refuses to serve.
 *
 * Only the Pages edge 404s those paths — `vite preview` serves them — so this is the layer that
 * catches it; the offline e2e specs cannot. The check reads the emitted `service-worker.js` rather
 * than the source, so it holds however the list is assembled.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES_CONTROL_PATHS } from "../src/lib/pages-control-files.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = join(ROOT, "build", "service-worker.js");

let source;
try {
  source = await readFile(WORKER, "utf8");
} catch {
  console.error(`Precache gate: no built worker at ${WORKER} — run the build first.`);
  process.exit(1);
}

// Every string literal in the bundle that looks like an absolute site path. Deliberately broader than
// the precache array: a control path must not appear anywhere in the worker.
const paths = new Set([...source.matchAll(/["'`](\/[A-Za-z0-9_./-]*)["'`]/g)].map((m) => m[1]));

const offenders = PAGES_CONTROL_PATHS.filter((path) => paths.has(path));

if (offenders.length > 0) {
  console.error(
    `Precache gate: the built service worker references ${offenders.length} path(s) that Cloudflare Pages does not serve:\n` +
      offenders.map((p) => `  ${p}  → 404 in production`).join("\n") +
      `\n\nThese reject the atomic cache.addAll() on install, which disables offline support entirely.\n` +
      `Exclude them via kit.serviceWorker.files in svelte.config.js (see src/lib/pages-control-files.js).`,
  );
  process.exit(1);
}

console.info(
  `✓ Precache gate OK: ${paths.size} site paths in the worker, none of them Pages control files.`,
);
