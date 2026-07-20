#!/usr/bin/env node
/**
 * @fileoverview CI guard: legal-review freshness, commencement-date and data-change gates.
 *
 * docs/legal/legal-review.json records the last legal review, the legislation/guidance versions it
 * covered, and known future commencement dates. This guard implements three independent gates:
 *
 *   1. Freshness — the build fails if the last legal review is more than 12 months old.
 *   2. Effective-date — the build fails on or after a recorded commencement date unless the last
 *      review was performed on or after that date (i.e. under the post-commencement law).
 *   3. Data-change — a PR that touches election data, rights metadata, scoring, proposition text,
 *      consent or ballot code must update legal-review.json in the same PR.
 *
 * The data-change gate needs the PR diff; it runs only when a base commit is available (the
 * LEGAL_REVIEW_BASE env var, set in CI on pull_request events). Freshness and effective-date run on
 * every build and on a schedule, so a stale production branch is caught even without a data change.
 *
 * Pure decision logic is exported as verdict() for unit tests; the git/fs/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-legal-review.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REVIEW_REL = "docs/legal/legal-review.json";

// Paths whose change requires a same-PR legal-review update (data-change gate). Prefixes
// deliberately over-match (substring, not path-boundary) — a false positive just asks for a
// legal-review touch, whereas a false negative lets a legally-material change ship unreviewed.
export const SENSITIVE_PREFIXES = [
  "data/", // election data, rights metadata, provenance, compiled dataset + locked snapshots
  "apps/web/migrations/", // research DB schema
  "apps/web/functions/api/research", // server-side research ingestion + geography endpoints
  "apps/web/src/lib/privacy/", // consent model, third-party/telemetry registry
  "apps/web/src/lib/survey", // research option allowlist + consent version
  "packages/data-schema/src/", // election metadata, schemas
  "packages/engine/src/scoring", // party-match scoring
  "packages/engine/src/answers", // answer → stance mapping
  "packages/engine/src/ballot", // ballot mapping / order
  "packages/engine/src/card", // card generation
];

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

/**
 * One calendar year after an epoch-ms date, in UTC. A Feb-29 review date rolls to Mar-1 the next
 * (non-leap) year — a day more generous, which errs towards NOT failing a build spuriously.
 */
function oneYearAfter(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate());
}

/**
 * Validate the legal-review record and apply the three gates.
 *
 * @param {unknown} review  parsed docs/legal/legal-review.json
 * @param {{ now?: number, changedPaths?: string[] | null }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(review, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const changedPaths = options.changedPaths ?? null;
  const push = (m) => errors.push(m);

  if (typeof review !== "object" || review === null || Array.isArray(review)) {
    return { ok: false, errors: ["legal-review.json: not a JSON object"] };
  }
  if (review.schemaVersion !== 1) {
    push(`legal-review.json: schemaVersion must be 1, got ${JSON.stringify(review.schemaVersion)}`);
  }
  for (const key of ["reviewer", "approvalRef"]) {
    if (!isNonEmptyString(review[key])) push(`legal-review.json: missing ${key}`);
  }

  // Gate 1 — freshness (>12 months old fails).
  const last = parseIsoDate(review.lastReviewDate);
  if (last === null) {
    push("legal-review.json: lastReviewDate must be an ISO date");
  } else if (now > oneYearAfter(last)) {
    push(
      `legal-review.json: last legal review is more than 12 months old (lastReviewDate ${review.lastReviewDate})`,
    );
  }
  const nextReview = parseIsoDate(review.nextMandatoryReviewDate);
  if (nextReview === null) push("legal-review.json: nextMandatoryReviewDate must be an ISO date");
  else if (now > nextReview) {
    push(
      `legal-review.json: mandatory review overdue (nextMandatoryReviewDate ${review.nextMandatoryReviewDate})`,
    );
  }

  // Gate 2 — effective-date (a passed commencement needs a review on/after it).
  const commencements = Array.isArray(review.knownCommencementDates)
    ? review.knownCommencementDates
    : [];
  for (const [i, c] of commencements.entries()) {
    const cms = parseIsoDate(c && c.date);
    if (cms === null) {
      push(`legal-review.json: knownCommencementDates[${i}].date must be an ISO date`);
      continue;
    }
    if (!isNonEmptyString(c.description)) {
      push(`legal-review.json: knownCommencementDates[${i}] needs a description`);
    }
    if (now >= cms && (last === null || last < cms)) {
      push(
        `legal-review.json: commencement ${c.date} ("${c.description}") is in effect but the last review (${review.lastReviewDate}) predates it — a post-commencement review is required`,
      );
    }
  }

  // Gate 3 — data-change (sensitive change must touch legal-review.json in the same PR).
  if (Array.isArray(changedPaths)) {
    const sensitive = changedPaths.filter((p) => SENSITIVE_PREFIXES.some((s) => p.startsWith(s)));
    const reviewTouched = changedPaths.includes(REVIEW_REL);
    if (sensitive.length > 0 && !reviewTouched) {
      const shown = sensitive.slice(0, 5).join(", ");
      const more = sensitive.length > 5 ? ` (+${sensitive.length - 5} more)` : "";
      push(
        `legal-review.json: this PR changes legally-sensitive paths (${shown}${more}) but does not update ${REVIEW_REL} — record the legal-change review in the same PR`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git plumbing, exercised via CI not unit tests */
function changedPathsFromBase() {
  // LEGAL_REVIEW_BASE is the PR base commit (set in CI). Absent on push/schedule/local, where the
  // data-change gate is intentionally skipped and only freshness + effective-date run.
  const base = process.env.LEGAL_REVIEW_BASE;
  if (!isNonEmptyString(base)) return null;
  // Once a base IS provided, a diff failure must be FATAL, never a silent skip — otherwise a bad
  // base object or an oversized diff (ENOBUFS) would quietly disable the gate on exactly the large
  // PRs that most need it. 64 MB buffer comfortably covers a --name-only list.
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\n").filter((p) => p.length > 0);
  } catch (err) {
    console.error(`::error::legal-review: cannot diff against base ${base}: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  let review;
  try {
    review = JSON.parse(readFileSync(new URL(`../${REVIEW_REL}`, import.meta.url), "utf8"));
  } catch (err) {
    console.error(`::error::cannot read ${REVIEW_REL}: ${err.message}`);
    process.exit(1);
  }
  const result = verdict(review, { changedPaths: changedPathsFromBase() });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::legal-review: ${e}`);
    console.error(`legal review: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    `legal review OK — last ${review.lastReviewDate}, next ${review.nextMandatoryReviewDate}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
