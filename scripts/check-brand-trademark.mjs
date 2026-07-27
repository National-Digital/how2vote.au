#!/usr/bin/env node
/**
 * @fileoverview CI guard: no asserted/registered mark claims, and a live brand guideline.
 *
 * The project protects its identity through copyright, passing off and misleading-conduct
 * principles — NOT through an asserted or pending registration. This guard proves two things:
 *
 *   1. No source file claims a registration. It fails on the "registered trade[ ]mark" phrase,
 *      the circled-R symbol, or a standalone claim symbol/token (the circled-TM symbol, "(TM)"
 *      or "(R)"). The scan is deliberately precise: it never trips on the letters "tm" inside an
 *      ordinary word, only on the explicit symbols/tokens or the spelt-out registration phrase.
 *   2. The brand guideline (BRAND.md) exists and carries the canonical product name plus a
 *      copyright-ownership statement, so the brand rules and their legal basis stay documented.
 *
 * BRAND.md is excluded from the source scan because it legitimately discusses these very tokens.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-brand-trademark.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BRAND_REL = "BRAND.md";
const CANONICAL_NAME = "How2Vote";

// The circled-R (U+00AE) and circled-TM (U+2122) symbols as escapes, so this guard's own source
// contains no literal symbol to trip the scan (belt-and-suspenders with the self-exclusion below).
const REGISTERED_SYMBOL = "\u00AE";
const TM_SYMBOL = "\u2122";

// Patterns whose presence in application/source prose asserts or implies a registration. This guard
// is also excluded from its own scan (SELF_REL) and the symbols/labels are de-literalised, so the
// needle strings here never self-match. NOTE the phrase separator is a single optional space (not
// hyphen): a hyphenated "registered trade-mark" is deliberately NOT matched, because that form
// appears in the legitimate NEGATED disclaimer ("no registered trade-mark claim") — a coarse phrase
// scan cannot tell a claim from its disclaimer, so it stays narrow and the curated brand docs (README
// section, BRAND.md) carry the human-reviewed wording.
const FORBIDDEN = [
  {
    label: "a registered-trade-mark phrase",
    // "registered" + whitespace + "trade" + optional single space + "mark(s)".
    re: new RegExp("registered" + "\\s+" + "trade" + "\\s?" + "marks?", "i"),
  },
  {
    label: "the registered-mark symbol",
    re: new RegExp(REGISTERED_SYMBOL),
  },
  {
    label: "a standalone trade-mark claim symbol/token",
    // The circled-TM symbol, or the uppercase "(TM)" / "(R)" tokens. Matched WITHOUT the
    // case-insensitive flag on purpose: the bare letters "tm" inside a word must never trip it,
    // and a lowercase "(r)" is an ordinary lambda parameter, not a mark claim. Only the symbol
    // or a conventionally-uppercase parenthesised token counts.
    re: new RegExp(TM_SYMBOL + "|" + "\\(TM\\)" + "|" + "\\(R\\)"),
  },
];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Decide whether the brand/trade-mark posture is clean.
 *
 * @param {{ sources?: { path: string, text: string }[], brandMd?: string | null }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const brandMd = input.brandMd ?? null;

  // 1 — no registration claims in scanned source prose.
  for (const { path, text } of sources) {
    if (typeof text !== "string") continue;
    for (const { label, re } of FORBIDDEN) {
      if (re.test(text)) {
        push(
          `${path}: contains ${label} — the project relies on copyright, passing off and ` +
            `misleading-conduct principles, not a registration; remove the claim`,
        );
      }
    }
  }

  // 2 — BRAND.md exists, names the product, and states copyright ownership.
  if (!isNonEmptyString(brandMd)) {
    push(`${BRAND_REL}: brand guideline is missing or empty`);
  } else {
    if (!brandMd.includes(CANONICAL_NAME)) {
      push(`${BRAND_REL}: must state the canonical product name "${CANONICAL_NAME}"`);
    }
    const mentionsCopyright = /copyright/i.test(brandMd);
    const mentionsOwnership = /\bown(s|ed|ership)?\b/i.test(brandMd);
    if (!mentionsCopyright || !mentionsOwnership) {
      push(`${BRAND_REL}: must contain a copyright-ownership statement for the brand assets`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git plumbing, exercised via CI not unit tests */
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|svelte|md|html|webmanifest)$/;
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
// This guard's own source deliberately contains the needle strings (as escapes/fragments); it and
// its test embed them as fixtures, and BRAND.md legitimately discusses these tokens — all excluded.
const SELF_REL = "scripts/check-brand-trademark.mjs";

function gatherSources(root) {
  const listed = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((p) => CODE_EXT.test(p) && !IS_TEST.test(p) && p !== BRAND_REL && p !== SELF_REL);
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
  let brandMd;
  try {
    brandMd = readFileSync(new URL(`../${BRAND_REL}`, import.meta.url), "utf8");
  } catch {
    brandMd = null;
  }
  const result = verdict({ sources: gatherSources(root), brandMd });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::brand-trademark: ${e}`);
    console.error(`brand / trade-mark scan: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info("brand / trade-mark scan OK — no registration claims, BRAND.md present");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
