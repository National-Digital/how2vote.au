import { z } from "zod";

/**
 * Zod runtime configuration. Must be applied before any schema in this package is constructed, so
 * every schema-defining module here imports it: ESM evaluates a module's dependencies before its own
 * body, which fixes the ordering however a bundler chunks the graph. Importing it only from
 * `index.ts` is not sufficient, because a bundler may place the config and Zod's core in separate
 * chunks whose relative order then varies.
 *
 * Zod compiles a JIT validator with `new Function(...)` and probes for that capability when a schema
 * is built. The probe throws under a strict Content-Security-Policy and Zod falls back to the
 * interpreted path, but the browser still reports a `script-src` violation. Declaring `jitless` skips
 * the probe: identical validation results, no violation.
 *
 * Browser only. The site's CSP has no `unsafe-eval` (apps/web/svelte.config.js) so the JIT is
 * unusable there anyway, while Node keeps it for the data pipeline, which validates the whole
 * committed dataset through these schemas.
 */
// Probed through `globalThis` because this package is built without the DOM lib.
if (typeof globalThis === "object" && "document" in globalThis) {
  z.config({ jitless: true });
}
