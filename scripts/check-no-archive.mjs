#!/usr/bin/env node
/**
 * @fileoverview CI guard: no Internet Archive / Wayback usage anywhere in the operational tree.
 *
 * Every party-position snapshot is now a DIRECT TVFY API capture. This scan fails the build if any
 * operational archive artefact reappears — archive URLs, the former Internet-Archive S3 env vars,
 * the retired snapshot-archive/backfill commands, the `wayback-backfill` source value, the deleted
 * archive-client identifiers, or an `archives.json` manifest. It covers code, data, tests and config
 * (the "no production exception" rule); documentation under docs/ is out of scope (it may narrate
 * the migration), as is this guard and its test, which necessarily name the tokens.
 *
 * Pure decision logic is exported as verdict() for unit tests; the git/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-no-archive.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Operational archive tokens. Assembled so this file's own source does not self-match: the scan
// excludes itself and its test, and these are the only places the tokens appear intentionally.
export const FORBIDDEN = [
  { label: "an archive.org URL", re: /\bweb\.archive\.org\b|\barchive\.org\b/i },
  { label: "an Internet-Archive S3 env var", re: /\bIA_S3_[A-Z_]+/ },
  { label: 'the "wayback-backfill" source value', re: /wayback-backfill/i },
  { label: "the Wayback Machine", re: /\bwayback\b/i },
  { label: "a SavePageNow reference", re: /savepagenow/i },
  { label: "the retired CDX client", re: /\bCdxClient\b/ },
  { label: "a retired snapshot archive/backfill command", re: /snapshot:(archive|backfill)/ },
  { label: "an archives.json manifest", re: /archives\.json/ },
];

/** File extensions in operational scope (code, data, config) — docs (.md) are excluded. */
const SCANNED_EXT = /\.(ts|tsx|js|mjs|cjs|svelte|json|ya?ml|toml)$/;

/**
 * @param {{ path: string, text: string }[]} sources
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(sources) {
  const errors = [];
  for (const { path, text } of sources) {
    if (typeof text !== "string") continue;
    for (const { label, re } of FORBIDDEN) {
      if (re.test(text)) {
        errors.push(`${path}: contains ${label} — the Internet Archive path was removed`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git plumbing, exercised via CI not unit tests */
const SELF = /scripts\/check-no-archive\.(mjs|test\.mjs)$/;
// .env* files carried the former IA_S3_* credentials, so scan them by name too (they have no
// extension SCANNED_EXT would match). The real .env is git-ignored; .env.example is tracked.
const ENV_FILE = /(^|\/)\.env(\..+)?$/;

function gatherSources(root) {
  const listed = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(
      (p) =>
        (SCANNED_EXT.test(p) || ENV_FILE.test(p)) &&
        !p.startsWith("docs/") && // documentation may narrate the migration
        !p.endsWith("pnpm-lock.yaml") &&
        !SELF.test(p),
    );
  return listed.map((rel) => ({ path: rel, text: safeRead(root, rel) }));
}

function safeRead(root, rel) {
  try {
    return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = verdict(gatherSources(root));
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::no-archive: ${e}`);
    console.error(`no-archive scan: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info("no-archive scan OK — no Internet Archive / Wayback usage in the operational tree");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
