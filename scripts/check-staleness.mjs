#!/usr/bin/env node
/**
 * @fileoverview CI guard: the stale-data predicate stays pure and channel-independent.
 *
 * apps/web/src/lib/staleness.ts decides WHEN the stale-data notice fires and on which dataVersion.
 * That decision must be identical on web, iOS and Android and must never touch the network — the
 * product's "nothing is fetched at runtime" invariant, and the "one trigger, all channels" design
 * in docs/store-distribution.md. This guard enforces, statically, that the predicate module:
 *   - contains NO network call (fetch / XMLHttpRequest / sendBeacon / an `/api/` endpoint), and
 *   - contains NO channel branch (isNativeShell / PUBLIC_DIST_CHANNEL / Capacitor).
 * The cross-channel behaviour itself is additionally covered by staleness.test.ts.
 *
 * Only the REMEDY (reload vs open store) differs by channel, and that lives in the component
 * (StaleDataNotice.svelte), never in the predicate — so this guard scopes to the predicate module.
 *
 * Pure decision logic is exported as verdict() for unit tests; fs/CLI plumbing runs only when
 * executed directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const MODULE_REL = "apps/web/src/lib/staleness.ts";

const FORBIDDEN = [
  { label: "a network fetch", re: /\bfetch\s*\(/ },
  { label: "an XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { label: "a sendBeacon call", re: /\bsendBeacon\b/ },
  { label: "an /api/ endpoint", re: /["'`]\/api\// },
  { label: "a channel branch (isNativeShell)", re: /\bisNativeShell\b/ },
  { label: "a channel env read (PUBLIC_DIST_CHANNEL)", re: /\bPUBLIC_DIST_CHANNEL\b/ },
  { label: "a Capacitor reference", re: /\bCapacitor\b/ },
];

/** Strip block + line comments (the module documents these very tokens in its own docstring), being
 *  careful never to treat the `//` inside a `://` URL as a line comment. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** @param {string} source @returns {{ ok: boolean, errors: string[] }} */
export function verdict(source) {
  const errors = [];
  if (typeof source !== "string" || source.trim() === "") {
    return { ok: false, errors: [`${MODULE_REL}: empty or unreadable (fail-closed)`] };
  }
  const code = stripComments(source);
  for (const { label, re } of FORBIDDEN) {
    if (re.test(code)) {
      errors.push(
        `${MODULE_REL}: contains ${label} — the stale-data predicate must be pure and channel-independent`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing */
function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let source = "";
  try {
    source = readFileSync(resolve(root, MODULE_REL), "utf8");
  } catch {
    /* left empty → fail-closed */
  }
  const { ok, errors } = verdict(source);
  if (!ok) {
    console.error("✗ stale-data predicate check:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.info("✓ staleness predicate OK — no network, no channel branch (pure, cross-channel)");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
