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
 *      consent or ballot code must record a NAMED APPROVAL in legal-review.json in the same PR.
 *
 * Gate 3 is not satisfied by touching the file. The PR must ADD a changeLog entry carrying a
 * reviewer who resolves to an active signatory in docs/legal/signatories.json, plus a date and an
 * explicit disposition — "reviewed" (a legal review was performed, which must also advance
 * lastReviewDate) or "no-review-required" (a named signatory determined none was needed). Whichever
 * it is, a person is on the record for it and the build fails without one.
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

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { activeSignatoryIds, isIdReference } from "./check-signatories.mjs";

const REVIEW_REL = "docs/legal/legal-review.json";
const SIGNATORIES_REL = "docs/legal/signatories.json";

/** A changeLog entry recording a legally-material change must declare one of these. */
export const DISPOSITIONS = ["reviewed", "no-review-required"];

/**
 * A bare date parses as UTC midnight, but an approver dates an entry in their own timezone — in
 * AEST that reads as up to ten hours ahead of UTC. One day of slack accepts any local calendar date
 * (max offset UTC+14) while still rejecting a genuinely future-dated approval.
 */
const LOCAL_DATE_SKEW_MS = 24 * 60 * 60 * 1000;

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
 * Validate one changeLog entry added by this PR: it must carry a named, currently-authorised
 * approver and an explicit disposition, so a green build always has a person behind it.
 *
 * @param {any} entry
 * @param {string} at  error prefix identifying the entry
 * @param {{ now: number, activeSignatories: Set<string>, lastReview: number | null }} ctx
 * @returns {string[]}
 */
function approvalErrors(entry, at, ctx) {
  const errors = [];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return [`${at}: not an object`];
  }

  const date = parseIsoDate(entry.date);
  if (date === null) errors.push(`${at}: date must be an ISO date`);
  else if (date > ctx.now + LOCAL_DATE_SKEW_MS) {
    errors.push(`${at}: date ${entry.date} is in the future`);
  }
  if (!isNonEmptyString(entry.change)) errors.push(`${at}: needs a change description`);
  if (!Array.isArray(entry.affectedControls)) {
    errors.push(`${at}: affectedControls must be an array (empty if none)`);
  }

  if (!DISPOSITIONS.includes(entry.disposition)) {
    errors.push(
      `${at}: disposition must be one of ${DISPOSITIONS.join(", ")}, got ${JSON.stringify(entry.disposition)}`,
    );
  }

  // The named approver. An external descriptor is not accepted here: this gate exists to put a
  // currently-authorised signatory on the record, so the reviewer must resolve to one.
  for (const key of ["reviewer", "secondReviewer"]) {
    if (key === "secondReviewer" && entry.secondReviewer === undefined) continue;
    const value = entry[key];
    if (!isIdReference(value)) {
      errors.push(
        `${at}: ${key} must be a signatory id (kebab-case), got ${JSON.stringify(value)}`,
      );
    } else if (!ctx.activeSignatories.has(value.trim())) {
      errors.push(`${at}: ${key} "${value.trim()}" is not an active signatory`);
    }
  }
  if (entry.secondReviewer !== undefined && entry.secondReviewer === entry.reviewer) {
    errors.push(`${at}: secondReviewer must be a different person from reviewer`);
  }

  // A recorded review must be reflected in the record's own review date — otherwise "reviewed"
  // would be a claim the rest of the file contradicts, and the freshness gate would never see it.
  if (entry.disposition === "reviewed" && date !== null) {
    if (ctx.lastReview === null || ctx.lastReview < date) {
      errors.push(
        `${at}: disposition "reviewed" requires lastReviewDate to be on or after ${entry.date}`,
      );
    }
  }
  return errors;
}

/**
 * Validate the legal-review record and apply the three gates.
 *
 * @param {unknown} review  parsed docs/legal/legal-review.json
 * @param {{
 *   now?: number,
 *   changedPaths?: string[] | null,
 *   baseChangeLog?: unknown[] | null,
 *   activeSignatories?: Set<string> | null,
 * }} [options]
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

  // Gate 3 — data-change (a sensitive change needs a named approval added in the same PR).
  if (Array.isArray(changedPaths)) {
    const sensitive = changedPaths.filter((p) => SENSITIVE_PREFIXES.some((s) => p.startsWith(s)));
    if (sensitive.length > 0) {
      const shown = sensitive.slice(0, 5).join(", ");
      const more = sensitive.length > 5 ? ` (+${sensitive.length - 5} more)` : "";
      const context = `this PR changes legally-sensitive paths (${shown}${more})`;

      // Fail closed: without the signatory registry we cannot tell an approver from a typed name.
      if (!(options.activeSignatories instanceof Set)) {
        push(`legal-review.json: ${context} but the signatory registry is unavailable`);
      } else {
        // "Added by this PR" is anything not byte-identical to an entry in the base revision, so an
        // edited historical entry is re-validated rather than grandfathered.
        const entries = Array.isArray(review.changeLog) ? review.changeLog : [];
        const base = new Set(
          (Array.isArray(options.baseChangeLog) ? options.baseChangeLog : []).map((e) =>
            JSON.stringify(e),
          ),
        );
        const added = entries
          .map((entry, i) => ({ entry, i }))
          .filter(({ entry }) => !base.has(JSON.stringify(entry)));

        if (added.length === 0) {
          push(
            `legal-review.json: ${context} but adds no changeLog entry to ${REVIEW_REL} — record the review (or the no-review-required determination) with a named approver in the same PR`,
          );
        }
        for (const { entry, i } of added) {
          for (const e of approvalErrors(entry, `legal-review.json: changeLog[${i}]`, {
            now,
            activeSignatories: options.activeSignatories,
            lastReview: last,
          })) {
            push(e);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git plumbing, exercised via CI not unit tests */
/** @param {string[]} args @param {string} what */
function git(args, what) {
  // A git failure here must be FATAL, never a silent skip — otherwise a bad base object or an
  // oversized diff (ENOBUFS) would quietly disable the gate on exactly the large PRs that most need
  // it. 64 MB buffer comfortably covers a --name-only list or this record.
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    console.error(`::error::legal-review: ${what}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * The PR diff and the record as it stood at the merge base, or null off a pull request.
 * @returns {{ changedPaths: string[], baseChangeLog: unknown[] } | null}
 */
function prContext() {
  // LEGAL_REVIEW_BASE is the PR base commit (set in CI). Absent on push/schedule/local, where the
  // data-change gate is intentionally skipped and only freshness + effective-date run.
  const base = process.env.LEGAL_REVIEW_BASE;
  if (!isNonEmptyString(base)) return null;

  // Merge base, so entries that landed on the base branch since we forked are not read as ours.
  const mergeBase = git(["merge-base", base, "HEAD"], `cannot find merge base with ${base}`).trim();
  const changedPaths = git(
    ["diff", "--name-only", mergeBase, "HEAD"],
    `cannot diff against base ${base}`,
  )
    .split("\n")
    .filter((p) => p.length > 0);

  // A record that did not exist at the merge base has no prior entries; anything else is fatal.
  let baseChangeLog = [];
  const exists = spawnSync("git", ["cat-file", "-e", `${mergeBase}:${REVIEW_REL}`]).status === 0;
  if (exists) {
    const raw = git(
      [`show`, `${mergeBase}:${REVIEW_REL}`],
      `cannot read ${REVIEW_REL} at the base`,
    );
    try {
      const parsed = JSON.parse(raw);
      baseChangeLog = Array.isArray(parsed.changeLog) ? parsed.changeLog : [];
    } catch (err) {
      console.error(`::error::legal-review: ${REVIEW_REL} at the base is not JSON: ${err.message}`);
      process.exit(1);
    }
  }
  return { changedPaths, baseChangeLog };
}

function main() {
  let review;
  try {
    review = JSON.parse(readFileSync(new URL(`../${REVIEW_REL}`, import.meta.url), "utf8"));
  } catch (err) {
    console.error(`::error::cannot read ${REVIEW_REL}: ${err.message}`);
    process.exit(1);
  }
  let signatories;
  try {
    signatories = JSON.parse(
      readFileSync(new URL(`../${SIGNATORIES_REL}`, import.meta.url), "utf8"),
    );
  } catch (err) {
    console.error(`::error::cannot read ${SIGNATORIES_REL}: ${err.message}`);
    process.exit(1);
  }
  const now = Date.now();
  const pr = prContext();
  const result = verdict(review, {
    now,
    changedPaths: pr && pr.changedPaths,
    baseChangeLog: pr && pr.baseChangeLog,
    activeSignatories: activeSignatoryIds(signatories, now),
  });
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
