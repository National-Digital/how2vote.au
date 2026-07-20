/**
 * @fileoverview Content-Security-Policy directives, derived from the
 * third-party services registry.
 *
 * `svelte.config.js` owns the hand-written BASE policy (first-party 'self'
 * tokens, hashing mode, etc.). This module reads the SAME registry JSON the
 * consent UI and privacy policy read, and merges each service's declared CSP
 * sources into that base — so the policy can never allow more (or less) than
 * the registry declares. No separate drift-guard is needed: the CSP is a pure
 * function of the registry at build time.
 *
 * Plain JS (not TS) and dependency-free so `svelte.config.js` can import it
 * directly under Node, before Vite/TS tooling is in play. It reads the JSON via
 * `fs` rather than an `import ... with { type: 'json' }` assertion to stay
 * portable across the Node/Vite/Vitest loaders that all consume this file.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** @typedef {{ services?: Array<{ csp?: Record<string, string[]> }> }} Registry */

/** @returns {Registry} the parsed third-party services registry. */
export function readRegistry() {
  return JSON.parse(readFileSync(join(HERE, "third-party-services.json"), "utf8"));
}

/**
 * Merge every registered service's CSP sources into a base directive map,
 * de-duplicated and appended after the base tokens (so 'self'/keywords lead).
 * A service directive not present in `base` is added, so the registry can
 * introduce a new directive without editing the base by hand.
 *
 * @param {Record<string, string[]>} base directive -> source list (keywords bare, e.g. "self")
 * @param {Registry} [reg] parsed registry (defaults to the committed JSON)
 * @returns {Record<string, string[]>} a new, merged directive map
 */
export function mergeRegistryCsp(base, reg = readRegistry()) {
  const services = reg.services ?? [];
  /** @type {Record<string, string[]>} */
  const out = {};

  // Union of base directives and any directive a service introduces.
  const names = new Set(Object.keys(base));
  for (const service of services) {
    for (const name of Object.keys(service.csp ?? {})) names.add(name);
  }

  for (const name of names) {
    const merged = [...(base[name] ?? [])];
    for (const service of services) {
      for (const source of service.csp?.[name] ?? []) {
        if (!merged.includes(source)) merged.push(source);
      }
    }
    // 'none' means "match nothing" and, per the CSP spec, must be the ONLY value in a directive.
    // If a service contributes a real source to a directive the base pinned to ['none'] (e.g.
    // frame-src for the Turnstile challenge), drop 'none' so the added source actually takes effect.
    out[name] = merged.length > 1 ? merged.filter((source) => source !== "none") : merged;
  }
  return out;
}
