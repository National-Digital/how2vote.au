/**
 * @fileoverview Legal-material leakage guard — fail closed if privileged/internal citations reappear.
 *
 * The public repo must carry ZERO citations to the confidential legal-and-compliance pack, to
 * counsel, or to the internal risk register. It scans every git-tracked text file for:
 *
 *   - legal-pack citations   — "legal pack", "pack §N", "pack doc N", "pack draft", "pack Terms §N"
 *   - risk-register citations — "risk register" / "risk-register", and bracketed "item N)" / "item N;"
 *   - counsel citations       — "counsel" / "counsel's" (any case; the data word "counselling" is fine —
 *                                the \b after "counsel" does not match inside "counselling")
 *
 * The sanctioned `control-N` control-register keys are NOT matched (they are the load-bearing
 * requirement↔control map validated by check-control-register.mjs / check-privacy-claims.mjs) and stay.
 *
 * Excluded from the scan: lockfiles, external snapshot/compiled data (which carry real policy names),
 * and this guard + its test (which necessarily contain the patterns as fixtures).
 *
 * Usage:  node scripts/check-no-legal-leakage.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);

/** Patterns that must never appear in the tree. Each is scanned per line. */
export const LEAKAGE_RULES = [
  {
    label: "a legal-pack citation",
    re: /(?:\blegal pack\b|\bpack §|\bpack doc\b|\bpack draft\b|\bpack Terms\b)/i,
  },
  { label: "a risk-register citation", re: /\brisk[ -]register\b/i },
  { label: "a bracketed risk-register item citation", re: /\bitem\s\d+\s*[/;)]/ },
  { label: "a counsel citation", re: /\bcounsel(?:'s)?\b/i },
];

/** Paths excluded from the scan (external data, lockfiles, and the guard's own fixtures). */
const EXCLUDE = [
  /^pnpm-lock\.yaml$/,
  /\.lock$/,
  /^data\/snapshots\//, // external TVFY policy data — real titles may contain "counselling" etc.
  /^data\/dist\//, // compiled data
  /^scripts\/check-no-legal-leakage\.mjs$/,
  /^scripts\/check-no-legal-leakage\.test\.mjs$/,
];

/** Binary/asset extensions we never scan. */
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|pdf|zip|gz|mp4|webm)$/i;

/**
 * Scan a set of {path, text} sources for leakage citations.
 * @param {{ path: string, text: string }[]} sources
 * @returns {{ path: string, line: number, label: string, match: string }[]}
 */
export function scan(sources) {
  const hits = [];
  for (const { path, text } of sources) {
    if (typeof text !== "string" || text.length === 0) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { label, re } of LEAKAGE_RULES) {
        const m = re.exec(lines[i]);
        if (m) hits.push({ path, line: i + 1, label, match: m[0] });
      }
    }
  }
  return hits;
}

function isScannable(p) {
  return !EXCLUDE.some((re) => re.test(p)) && !SKIP_EXT.test(p);
}

function gatherSources() {
  const listed = execFileSync("git", ["ls-files"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  })
    .split("\n")
    .filter((p) => p && isScannable(p));
  return listed.map((p) => {
    try {
      return { path: p, text: readFileSync(new URL(p, root), "utf8") };
    } catch {
      return { path: p, text: "" };
    }
  });
}

/* c8 ignore start */
function main() {
  const hits = scan(gatherSources());
  if (hits.length > 0) {
    for (const h of hits) {
      console.error(`::error file=${h.path},line=${h.line}::${h.label}: "${h.match}"`);
    }
    console.error(
      `legal-leakage guard: ${hits.length} citation(s) found — scrub them (keep only sanctioned control-N register keys)`,
    );
    process.exit(1);
  }
  console.info(
    "legal-leakage guard OK — no legal-pack / counsel / risk-register citations in the tree",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
