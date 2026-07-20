#!/usr/bin/env node
/**
 * @fileoverview CI guard: one authoritative operator record.
 *
 * apps/web/src/lib/operator.json is the single machine-readable source for the operating entity —
 * identity, addresses, privacy contact and the Privacy Act determination. Everything public
 * (footer, legal pages, structured data, authorisation) derives from it via apps/web/src/lib/org.ts.
 *
 * This guard proves:
 *   - the operator record is complete and well-formed;
 *   - the Privacy Act determination carries a legal basis, reviewer and a future next-review date
 *     (an overdue review fails the build, fail-closed);
 *   - no SECOND hard-coded legal entity exists — within application source code (ts/tsx/js/mjs/svelte,
 *     excluding tests) the legal-name, ABN and ACN literals may appear only in operator.json. Prose that
 *     legitimately cites the entity (docs, the claims register) is out of scope by design.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-operator-identity.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OPERATOR_REL = "apps/web/src/lib/operator.json";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** @param {unknown} v @returns {number | null} */
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v))
    return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

const REQUIRED_STRINGS = [
  "legalName",
  "tradingName",
  "abn",
  "acn",
  "phone",
  "email",
  "privacyContactEmail",
  "website",
  "country",
  "governingLaw",
  "dataControllerRole",
];

/**
 * Validate the operator record and scan source files for a second hard-coded entity.
 *
 * @param {unknown} operator  parsed apps/web/src/lib/operator.json
 * @param {{ now?: number, sources?: { path: string, text: string }[] }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(operator, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const sources = options.sources ?? [];
  const push = (m) => errors.push(m);

  if (typeof operator !== "object" || operator === null || Array.isArray(operator)) {
    return { ok: false, errors: ["operator.json: not a JSON object"] };
  }
  if (operator.schemaVersion !== 1) {
    push(`operator.json: schemaVersion must be 1, got ${JSON.stringify(operator.schemaVersion)}`);
  }
  for (const key of REQUIRED_STRINGS) {
    if (!isNonEmptyString(operator[key])) push(`operator.json: missing ${key}`);
  }
  const auth = operator.authorisation;
  if (!auth || typeof auth !== "object") {
    push("operator.json: missing authorisation block");
  } else {
    if (!isNonEmptyString(auth.locality)) push("operator.json: missing authorisation.locality");
    if (!isNonEmptyString(auth.state)) push("operator.json: missing authorisation.state");
  }

  const pa = operator.privacyAct;
  if (!pa || typeof pa !== "object") {
    push("operator.json: missing privacyAct determination (requires a legal basis, not a boolean)");
  } else {
    if (!isNonEmptyString(pa.legalBasis)) push("operator.json: privacyAct.legalBasis is required");
    if (!isNonEmptyString(pa.reviewer)) push("operator.json: privacyAct.reviewer is required");
    if (!isNonEmptyString(pa.evidenceRef))
      push("operator.json: privacyAct.evidenceRef is required");
    const determined = parseIsoDate(pa.determinationDate);
    if (determined === null) {
      push("operator.json: privacyAct.determinationDate must be an ISO date");
    }
    const next = parseIsoDate(pa.nextReviewDate);
    if (next === null) push("operator.json: privacyAct.nextReviewDate must be an ISO date");
    else if (next < now)
      push(`operator.json: privacyAct review overdue (nextReviewDate ${pa.nextReviewDate})`);
    if (determined !== null && next !== null && determined > next) {
      push("operator.json: privacyAct.determinationDate is after nextReviewDate");
    }
  }

  // No second hard-coded legal entity: identity literals may live only in operator.json. Both scans
  // run against a whitespace-collapsed copy of the source so a literal that reflows across lines or
  // is concatenated (common in markup and long string expressions) is still caught.
  const abnDigits = isNonEmptyString(operator.abn) ? operator.abn.replace(/\s+/g, "") : null;
  const acnDigits = isNonEmptyString(operator.acn) ? operator.acn.replace(/\s+/g, "") : null;
  const legalName = isNonEmptyString(operator.legalName) ? operator.legalName : null;
  // The distinctive registered name — the legal name up to its first structural clause
  // (" as trustee", " trading as", or a comma). Long enough to be unmistakable, short enough
  // to catch a copy that omits the trust/trading suffix.
  let legalNameCompact = null;
  if (legalName) {
    const cut = legalName.search(/ as trustee| trading as|,/);
    legalNameCompact = (cut > 0 ? legalName.slice(0, cut) : legalName).replace(/\s+/g, "");
  }
  for (const { path, text } of sources) {
    if (path.endsWith("operator.json")) continue;
    if (typeof text !== "string") continue;
    const compact = text.replace(/\s+/g, "");
    if (abnDigits && compact.includes(abnDigits)) {
      push(`${path}: hard-codes the operator ABN — reference operator.json / ORG instead`);
    }
    if (acnDigits && compact.includes(acnDigits)) {
      push(`${path}: hard-codes the operator ACN — reference operator.json / ORG instead`);
    }
    if (legalNameCompact && compact.includes(legalNameCompact)) {
      push(`${path}: hard-codes the operator legal name — reference operator.json / ORG instead`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI plumbing, exercised via CI not unit tests */
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|svelte)$/;
// Test/spec files legitimately embed the identity literals as fixtures for this very guard.
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

function gatherSources(root) {
  const listed = execFileSync("git", ["ls-files", "apps", "packages", "scripts"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => CODE_EXT.test(p) && !IS_TEST.test(p));
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
  let operator;
  try {
    operator = JSON.parse(readFileSync(new URL(`../${OPERATOR_REL}`, import.meta.url), "utf8"));
  } catch (err) {
    console.error(`::error::cannot read ${OPERATOR_REL}: ${err.message}`);
    process.exit(1);
  }
  const result = verdict(operator, { sources: gatherSources(root) });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::operator-identity: ${e}`);
    console.error(`operator identity: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(`operator identity OK — one authoritative record (${operator.tradingName})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
