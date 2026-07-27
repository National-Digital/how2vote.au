#!/usr/bin/env node
/**
 * @fileoverview CI guard: identifiers spell the brand `how2vote`, always lower case.
 *
 * The brand is spelt two ways on purpose (see BRAND.md). In TEXT — prose, titles, the app label,
 * anything read aloud — the product name is `How2Vote`. In an IDENTIFIER it is `how2vote`, lower
 * case, with no exceptions. An identifier is matched by a machine, not read by a person.
 *
 * This guard enforces the identifier direction only. It does NOT police prose casing: prose is a
 * judgement call a reviewer makes, whereas an identifier is mechanical and the failure modes are
 * nasty. Re-casing a storage key silently discards every user's saved cards and consent; an
 * application id cannot be changed at all once published; a domain or package scope simply stops
 * resolving. None of those announce themselves at runtime — hence a build-time check.
 *
 * Only unambiguous identifier SHAPES are matched, so ordinary prose cannot trip the guard. A
 * hyphenated adjective ("the How2Vote-branded card") is prose and passes; `how2vote-research` is a
 * database name and must stay lower case. The shapes are enumerated in IDENTIFIER_SHAPES below,
 * each with the reason its casing is load-bearing.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-brand-casing.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The canonical lower-case identifier spelling. */
const LOWER = "how2vote";

/**
 * Identifier shapes, each matched case-insensitively. A match whose brand token is not exactly
 * `how2vote` is an error. Each `re` must capture the brand token itself in group 1 so the reported
 * text is precise.
 *
 * NOTE every pattern is anchored on syntax that only occurs in an identifier — a scheme, a scope
 * sigil, a dotted TLD, a key separator, a known infrastructure suffix, a file extension. Bare
 * hyphens and slashes are deliberately NOT identifier markers, because prose uses them too.
 */
const IDENTIFIER_SHAPES = [
  // Ordered most-specific first: `au.how2vote.app` is an application id, and would otherwise be
  // reported by the broader domain shape. One token yields one error (see dedupe in verdict).
  {
    label: "an application id",
    why: "the Play/App Store application id is immutable once published",
    re: /\bau\.(how2vote)\.app\b/gi,
  },
  {
    label: "a domain",
    why: "DNS labels are the deployed hostname; a re-cased domain in config or docs misleads",
    re: /(how2vote)\.(?:au|app|com|org|net)\b/gi,
  },
  {
    label: "a package scope",
    why: "the workspace scope must match package.json exactly or resolution fails",
    re: /@(how2vote)\//gi,
  },
  {
    label: "a storage or cache key",
    why: "re-casing a key orphans it — every saved card and consent record silently disappears",
    re: /(how2vote):[a-z]/gi,
  },
  {
    label: "a tool or function name",
    why: "the name is part of the published WebMCP tool contract",
    re: /(how2vote)_[a-z]/gi,
  },
  {
    label: "an infrastructure name",
    why: "the Cloudflare worker and D1 database names are matched literally by wrangler",
    re: /(how2vote)-(?:au|research|nonces)\b/gi,
  },
  {
    label: "a file or asset name",
    why: "the committed filename is what the path resolves to on a case-sensitive filesystem",
    re: /(how2vote)[a-z0-9-]*\.(?:svg|png|ico|json|ya?ml|mjs|cjs|[jt]sx?|webmanifest)\b/gi,
  },
  {
    label: "an email address",
    why: "the local part is the configured mailbox",
    re: /(how2vote)@/gi,
  },
];

/**
 * Decide whether every brand identifier is lower case.
 *
 * @param {{ sources?: { path: string, text: string }[], paths?: string[] }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const paths = Array.isArray(input.paths) ? input.paths : [];

  // 1 — identifier shapes inside file contents. Shapes deliberately overlap (an application id is
  // also a domain), so a token is reported ONCE, by the first — most specific — shape that matches.
  for (const { path, text } of sources) {
    if (typeof text !== "string") continue;
    const reported = new Set();
    for (const { label, why, re } of IDENTIFIER_SHAPES) {
      // Fresh lastIndex per source: the patterns are module-level and /g is stateful.
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const token = m[1];
        if (token === LOWER) continue;
        const at = m.index + m[0].toLowerCase().indexOf(LOWER);
        if (reported.has(at)) continue;
        reported.add(at);
        const line = text.slice(0, at).split("\n").length;
        errors.push(
          `${path}:${line}: "${token}" in ${label} (${m[0]}) — identifiers are always lower-case ` +
            `"${LOWER}"; ${why}`,
        );
      }
    }
  }

  // 2 — the committed paths themselves. A path is an identifier in its entirety.
  for (const p of paths) {
    if (typeof p !== "string") continue;
    for (const m of p.matchAll(/how2vote/gi)) {
      if (m[0] === LOWER) continue;
      errors.push(
        `${p}: "${m[0]}" in a committed path — file and directory names are always lower-case ` +
          `"${LOWER}" (a case-only rename is invisible on some filesystems and breaks on others)`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git plumbing, exercised via CI not unit tests */
const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|svelte|md|html|webmanifest|json|ya?ml|toml|css|txt|py|sql|cff)$/;
// This guard and its test embed the forbidden spellings as fixtures; BRAND.md documents the rule
// with worked examples. All three are excluded from their own scan.
const SELF_REL = "scripts/check-brand-casing.mjs";
const TEST_REL = "scripts/check-brand-casing.test.mjs";
const BRAND_REL = "BRAND.md";
const EXCLUDED = new Set([SELF_REL, TEST_REL, BRAND_REL]);

function listFiles(root) {
  return execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
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
  const paths = listFiles(root);
  const sources = paths
    .filter((p) => TEXT_EXT.test(p) && !EXCLUDED.has(p))
    .map((rel) => ({ path: rel, text: safeRead(root, rel) }));
  const result = verdict({ sources, paths });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::brand-casing: ${e}`);
    console.error(`brand casing: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(`brand casing OK — every brand identifier is lower-case "${LOWER}"`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
