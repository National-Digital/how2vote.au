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

// The prerenderer's env shim cuts the other way: it must be PRESENT in the precache, not absent.
// Every prerendered page boots through `import("./_app/env.js")`, so if it is missing from the cache
// the page renders offline and never hydrates — visually intact, entirely inert. It is written by the
// prerenderer, so it is in neither `build` nor `files` and has to be listed explicitly.
//
// Both directions are failures, hence two assertions: listed but not built rejects the atomic addAll
// (killing offline outright), and built but not listed is the silent-inert case.
const ENV_SHIM = "/_app/env.js";
const shimBuilt = await readFile(join(ROOT, "build", ENV_SHIM), "utf8").then(
  () => true,
  () => false,
);
const shimListed = paths.has(ENV_SHIM);

if (shimBuilt && !shimListed) {
  console.error(
    `Precache gate: the build emits ${ENV_SHIM} but the service worker does not precache it.\n` +
      `Every prerendered page boots via import("./_app/env.js"), so offline it renders and then never\n` +
      `hydrates — no quiz, no card, no router, with nothing on screen to say so. Add it to PRECACHE.`,
  );
  process.exit(1);
}
if (!shimBuilt && shimListed) {
  console.error(
    `Precache gate: the service worker precaches ${ENV_SHIM}, but the build does not emit it.\n` +
      `An unfetchable entry rejects the atomic cache.addAll() and disables offline support entirely.\n` +
      `The shim only exists while a client module reads $env/dynamic/public — if none does, drop it.`,
  );
  process.exit(1);
}

console.info(
  `✓ Precache gate OK: ${paths.size} site paths in the worker, none of them Pages control files` +
    `${shimListed ? `, env shim precached` : ""}.`,
);
