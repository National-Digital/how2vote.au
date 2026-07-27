#!/usr/bin/env node
/**
 * @fileoverview CI guard: the "clear all my How2Vote data" action is COMPLETE.
 *
 * The clear-all control (apps/web/src/lib/privacy/local-data.ts) wipes on-device state by SWEEPING a
 * namespace rather than hand-listing keys: every localStorage / sessionStorage key under
 * "how2vote:" and every Cache Storage cache under "how2vote-". That is only complete if EVERY store
 * actually keeps its key inside that namespace and the service worker names every cache inside the
 * cache namespace. This guard fails the build if any of that stops holding — so a store added (or a
 * key renamed) tomorrow can never quietly escape the wipe.
 *
 * It checks three things, fail-closed:
 *   (a) CLEAR-ALL MODULE — local-data.ts declares both prefixes and genuinely sweeps localStorage,
 *       sessionStorage AND the caches by those prefixes.
 *   (b) STORAGE NAMESPACE — every localStorage / sessionStorage key used anywhere in the web app
 *       resolves to a string literal starting with "how2vote:". A key it cannot resolve is an error
 *       (an unprovable key can't be proven swept).
 *   (c) CACHE NAMESPACE — the service worker names its cache(s) under "how2vote-" and opens no cache
 *       under any other name.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing only runs when the
 * script is executed directly.
 *
 * Usage:
 *   node scripts/check-clear-all.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const STORAGE_KEY_PREFIX = "how2vote:";
export const CACHE_NAME_PREFIX = "how2vote-";

/* (a) The clear-all module actually sweeps every area by the two prefixes. */

/**
 * @param {{ path: string, text: string } | null | undefined} mod
 * @returns {string[]} errors
 */
export function verifyClearAllModule(mod) {
  if (!mod || typeof mod.text !== "string") {
    return [
      "clear-all module: could not read apps/web/src/lib/privacy/local-data.ts (fail closed)",
    ];
  }
  const errors = [];
  const { path, text } = mod;
  const requireIn = (re, what) => {
    if (!re.test(text)) errors.push(`${path}: ${what}`);
  };
  requireIn(
    new RegExp(`STORAGE_KEY_PREFIX\\s*=\\s*["']${STORAGE_KEY_PREFIX}["']`),
    `must declare STORAGE_KEY_PREFIX = "${STORAGE_KEY_PREFIX}"`,
  );
  requireIn(
    new RegExp(`CACHE_NAME_PREFIX\\s*=\\s*["']${CACHE_NAME_PREFIX}["']`),
    `must declare CACHE_NAME_PREFIX = "${CACHE_NAME_PREFIX}"`,
  );
  requireIn(/\blocalStorage\b/, "must clear localStorage");
  requireIn(/\bsessionStorage\b/, "must clear sessionStorage (defence in depth)");
  requireIn(/\bremoveItem\b/, "must remove the namespaced storage keys");
  requireIn(/caches\s*\.\s*keys\s*\(/, "must enumerate the Cache Storage caches");
  requireIn(/caches\s*\.\s*delete\s*\(/, "must delete the namespaced caches");
  requireIn(
    /startsWith\(\s*STORAGE_KEY_PREFIX\s*\)/,
    "must sweep storage keys by STORAGE_KEY_PREFIX",
  );
  requireIn(/startsWith\(\s*CACHE_NAME_PREFIX\s*\)/, "must sweep caches by CACHE_NAME_PREFIX");
  return errors;
}

/* (b) Every localStorage / sessionStorage key is under the "how2vote:" prefix */

/** Strip line/block comments so a key mentioned in prose isn't mistaken for a call. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Consts a file (or the whole app) binds to a plain string literal, e.g. `const KEY = "how2vote:…"`.
 * @param {string} text
 * @returns {Map<string, string>} name -> literal value
 */
export function literalConsts(text) {
  const out = new Map();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])((?:\\.|(?!\2).)*)\2/g;
  let m;
  while ((m = re.exec(text)) !== null) out.set(m[1], m[3]);
  return out;
}

/**
 * Consts a file binds to a key-BUILDER whose prefix is a known literal const, e.g.
 * `const key = (id) => KEY_PREFIX + id` or `const k = PREFIX + x`. Resolved against `literals`.
 * @param {string} text
 * @param {Map<string,string>} literals
 * @returns {Map<string, string>} name -> resolved prefix value
 */
export function prefixConsts(text, literals) {
  const out = new Map();
  // arrow builder: const NAME = (...) => OTHER + ...   OR   const NAME = arg => OTHER + ...
  // Tolerates a TypeScript return-type annotation between the params and the arrow, e.g.
  // `const key = (electionId: string): string => KEY_PREFIX + electionId`.
  const arrow =
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[\w.<>[\]| ]+)?=>\s*([A-Za-z_$][\w$]*)\s*\+/g;
  // plain concat: const NAME = OTHER + ...
  const concat = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\+/g;
  for (const re of [arrow, concat]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const val = literals.get(m[2]);
      if (val !== undefined && !out.has(m[1])) out.set(m[1], val);
    }
  }
  return out;
}

/**
 * The first argument of a call, given the index just past its opening "(". Respects nested parens,
 * brackets and braces so `key(id)` or `f({a:1})` are returned whole, and stops at the first top-level
 * comma or the matching close paren. Quotes are skipped so a comma inside a string literal is ignored.
 * @param {string} text
 * @param {number} start index of the first char after "("
 * @returns {string} the trimmed first-argument source
 */
export function firstArg(text, start) {
  let depth = 0;
  let quote = "";
  let out = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break; // closing the storage call
      depth--;
    } else if (c === "," && depth === 0) break; // end of the first argument
    out += c;
  }
  return out.trim();
}

/**
 * Every localStorage / sessionStorage key must resolve to a literal under STORAGE_KEY_PREFIX.
 *
 * @param {{ path: string, text: string }[]} sources every non-test web-app source file
 * @returns {string[]} errors
 */
export function verifyStorageNamespace(sources) {
  const errors = [];
  // Global maps for cross-file imports (e.g. CONSENT_STORAGE_KEY defined in registry.ts).
  const globalLiterals = new Map();
  const perFileLiterals = new Map();
  const perFilePrefixes = new Map();
  for (const { path, text } of sources) {
    const clean = stripComments(text);
    const lits = literalConsts(clean);
    perFileLiterals.set(path, lits);
    perFilePrefixes.set(path, prefixConsts(clean, lits));
    for (const [name, val] of lits) {
      if (!globalLiterals.has(name)) globalLiterals.set(name, val);
    }
  }

  // The head of a Web Storage operation; the first argument (the key) is parsed out manually below so
  // nested calls like `key(id)` and trailing args like `setItem(K, value)` are handled correctly.
  const headRe = /(?:localStorage|sessionStorage)\s*\.\s*(?:get|set|remove)Item\s*\(/g;
  for (const { path, text } of sources) {
    // The clear-all sweeper itself legitimately iterates dynamic, already-namespaced keys — it is the
    // thing doing the sweeping, not a store, so it is exempt from the per-key resolution below.
    if (path.endsWith("/privacy/local-data.ts")) continue;
    const clean = stripComments(text);
    const lits = perFileLiterals.get(path);
    const prefixes = perFilePrefixes.get(path);
    // headRe only positions us at each call; the key argument is parsed from headRe.lastIndex.
    while (headRe.exec(clean) !== null) {
      const raw = firstArg(clean, headRe.lastIndex);
      const check = (value, how) => {
        if (typeof value !== "string") {
          errors.push(
            `${path}: cannot resolve localStorage key ${how} — an unresolvable key cannot be proven swept by clear-all`,
          );
        } else if (!value.startsWith(STORAGE_KEY_PREFIX)) {
          errors.push(
            `${path}: localStorage key ${how} = "${value}" is outside the "${STORAGE_KEY_PREFIX}" namespace clear-all sweeps`,
          );
        }
      };

      let lit;
      if ((lit = /^(["'])((?:\\.|(?!\1).)*)\1/.exec(raw)) !== null) {
        check(lit[2], `(literal)`);
        continue;
      }
      const builder = /^([A-Za-z_$][\w$]*)\s*\(/.exec(raw);
      if (builder !== null) {
        const name = builder[1];
        check(prefixes.get(name), `(builder ${name})`);
        continue;
      }
      const ident = /^([A-Za-z_$][\w$]*)$/.exec(raw);
      if (ident !== null) {
        const name = ident[1];
        const val = lits.get(name) ?? prefixes.get(name) ?? globalLiterals.get(name);
        check(val, `(const ${name})`);
        continue;
      }
      errors.push(
        `${path}: unparseable localStorage key expression "${raw}" — cannot prove it is swept by clear-all`,
      );
    }
  }
  return errors;
}

/* (c) The service worker names every cache under the cache prefix. */

/**
 * @param {{ path: string, text: string } | null | undefined} sw
 * @returns {string[]} errors
 */
export function verifyCacheNamespace(sw) {
  if (!sw || typeof sw.text !== "string") {
    return ["service worker: could not read apps/web/src/service-worker.ts (fail closed)"];
  }
  const errors = [];
  const { path, text } = sw;
  const clean = stripComments(text);

  // The cache name const must start with the prefix (literal or template-literal head).
  const cacheName =
    /\bconst\s+CACHE\s*=\s*[`"']([^`"'$]*)/.exec(clean) ??
    /\bcaches\s*\.\s*open\s*\(\s*[`"']([^`"'$]*)/.exec(clean);
  if (cacheName === null) {
    errors.push(
      `${path}: could not find the service-worker cache name — cannot prove caches are swept`,
    );
  } else if (!cacheName[1].startsWith(CACHE_NAME_PREFIX)) {
    errors.push(
      `${path}: cache name "${cacheName[1]}…" is outside the "${CACHE_NAME_PREFIX}" namespace clear-all sweeps`,
    );
  }

  // No caches.open on a raw string literal that isn't prefixed (defence against a stray second cache).
  const openRe = /caches\s*\.\s*open\s*\(\s*(["'`])([^"'`$]*)\1/g;
  let m;
  while ((m = openRe.exec(clean)) !== null) {
    if (!m[2].startsWith(CACHE_NAME_PREFIX)) {
      errors.push(`${path}: opens a cache "${m[2]}" outside the "${CACHE_NAME_PREFIX}" namespace`);
    }
  }
  return errors;
}

/**
 * @param {{ clearAllModule?: {path:string,text:string}, storageSources?: {path:string,text:string}[], serviceWorker?: {path:string,text:string} }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  if (input.clearAllModule !== undefined)
    errors.push(...verifyClearAllModule(input.clearAllModule));
  if (input.storageSources) errors.push(...verifyStorageNamespace(input.storageSources));
  if (input.serviceWorker !== undefined) errors.push(...verifyCacheNamespace(input.serviceWorker));
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- fs/CLI plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const CLEAR_ALL = "apps/web/src/lib/privacy/local-data.ts";
const SERVICE_WORKER = "apps/web/src/service-worker.ts";
const WEB_SRC = "apps/web/src";

function read(rel) {
  return { path: rel, text: readFileSync(new URL(rel, ROOT), "utf8") };
}

/** Every non-test .ts / .svelte under a directory, relative to the repo root. */
function collectSources(relDir) {
  const out = [];
  const base = new URL(relDir + "/", ROOT);
  const walk = (dirUrl, prefix) => {
    for (const entry of readdirSync(dirUrl)) {
      const childUrl = new URL(
        entry + (statSync(new URL(entry, dirUrl)).isDirectory() ? "/" : ""),
        dirUrl,
      );
      const relPath = prefix + entry;
      if (statSync(childUrl).isDirectory()) {
        walk(childUrl, relPath + "/");
      } else if (/\.(ts|svelte)$/.test(entry) && !/\.(test|spec)\./.test(entry)) {
        out.push({ path: relDir + "/" + relPath, text: readFileSync(childUrl, "utf8") });
      }
    }
  };
  walk(base, "");
  return out;
}

function main() {
  /** @type {Parameters<typeof verdict>[0]} */
  let input;
  try {
    input = {
      clearAllModule: read(CLEAR_ALL),
      storageSources: collectSources(WEB_SRC),
      serviceWorker: read(SERVICE_WORKER),
    };
  } catch (err) {
    console.error(`::error::clear-all: cannot read a required source file: ${err.message}`);
    process.exit(1);
  }

  const result = verdict(input);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::clear-all: ${e}`);
    console.error(`clear-all: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    'clear-all OK — every localStorage/sessionStorage key is under "how2vote:", every cache under "how2vote-", and local-data.ts sweeps them all',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
