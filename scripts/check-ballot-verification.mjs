#!/usr/bin/env node
/**
 * @fileoverview CI guard: two-person ballot-order verification records exist and are current.
 *
 * Each election carries data/source/<id>/ballot-verification.json binding the compiled ballot order
 * to the exact ballots.json bytes (`ballotsSourceHash`). This guard proves:
 *   - the record is well-formed and its `ballotsSourceHash` matches the current ballots.json (so any
 *     ballot change invalidates the verification and forces a re-check — fail-closed);
 *   - a record marked `released` carries two DISTINCT reviewers with timestamps (the two-person
 *     control); a `pending` record is allowed while human verification is outstanding.
 *
 * The two-person human verification itself is external evidence; this guard
 * enforces that the machine-checkable parts are complete and attributable, and that nothing claims
 * `released` without the two reviewers.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-ballot-verification.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const STATUS = ["pending", "released"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v */
const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
/** @param {unknown} v — strict ISO date/datetime (mirrors the other guards). */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));
/** Case/whitespace-folded identity, so "Ada" and "Ada " are the same reviewer. */
const foldName = (v) => (isNonEmptyString(v) ? v.trim().toLowerCase() : "");

/** Canonical sha-256 of a parsed JSON value — matches the pipeline's checksum(). */
export function canonicalHash(parsed) {
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

/**
 * @param {{ electionId: string, verification: unknown, ballotsHash: string,
 *           ballotsCounts?: { houseElectorates: number, senateJurisdictions: number } }[]} entries
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(entries) {
  const errors = [];
  const push = (m) => errors.push(m);

  for (const { electionId, verification: v, ballotsHash, ballotsCounts } of entries) {
    const at = `ballot-verification (${electionId})`;
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      push(`${at}: not a JSON object`);
      continue;
    }
    if (v.schemaVersion !== 1) push(`${at}: schemaVersion must be 1`);
    if (v.electionId !== electionId) push(`${at}: electionId must be "${electionId}"`);
    if (!SHA256.test(v.ballotsSourceHash ?? "")) {
      push(`${at}: ballotsSourceHash must be a sha256 hex digest`);
    } else if (ballotsHash && v.ballotsSourceHash !== ballotsHash) {
      push(
        `${at}: ballotsSourceHash is stale (recorded ${v.ballotsSourceHash.slice(0, 8)}, ballots.json is ${ballotsHash.slice(0, 8)}) — ballots changed since verification; re-verify`,
      );
    }
    const cov = v.coverage;
    if (typeof cov !== "object" || cov === null) push(`${at}: missing coverage`);
    else {
      if (!isPositiveInt(cov.houseElectorates))
        push(`${at}: coverage.houseElectorates must be a positive integer`);
      if (!isPositiveInt(cov.senateJurisdictions))
        push(`${at}: coverage.senateJurisdictions must be a positive integer`);
      // Cross-check the declared coverage against the actual ballots so a stale/typo'd count in a
      // legal-evidence record can't pass with an otherwise-correct hash.
      if (ballotsCounts) {
        if (cov.houseElectorates !== ballotsCounts.houseElectorates) {
          push(
            `${at}: coverage.houseElectorates (${cov.houseElectorates}) != ballots.json (${ballotsCounts.houseElectorates})`,
          );
        }
        if (cov.senateJurisdictions !== ballotsCounts.senateJurisdictions) {
          push(
            `${at}: coverage.senateJurisdictions (${cov.senateJurisdictions}) != ballots.json (${ballotsCounts.senateJurisdictions})`,
          );
        }
      }
    }
    if (!STATUS.includes(v.status)) push(`${at}: status must be one of ${STATUS.join(", ")}`);

    const r = v.reviewers;
    if (typeof r !== "object" || r === null) {
      push(`${at}: missing reviewers`);
    } else if (v.status === "released") {
      // The two-person control: two distinct, named reviewers with timestamps.
      if (!isNonEmptyString(r.primary)) push(`${at}: released record needs a primary reviewer`);
      if (!isNonEmptyString(r.second)) push(`${at}: released record needs a second reviewer`);
      if (isNonEmptyString(r.primary) && foldName(r.primary) === foldName(r.second)) {
        push(`${at}: primary and second reviewer must be different people (two-person control)`);
      }
      if (!isIsoDate(r.primaryAt)) push(`${at}: released record needs a valid primaryAt`);
      if (!isIsoDate(r.secondAt)) push(`${at}: released record needs a valid secondAt`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ELECTIONS = ["2019", "2022", "2025"];

function loadEntry(electionId) {
  const root = new URL("../", import.meta.url);
  const verification = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/ballot-verification.json`, root), "utf8"),
  );
  const ballots = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/ballots.json`, root), "utf8"),
  );
  const ballotsCounts = {
    houseElectorates: new Set((ballots.house ?? []).map((r) => r.division)).size,
    senateJurisdictions: new Set((ballots.senate ?? []).map((r) => r.state)).size,
  };
  return { electionId, verification, ballotsHash: canonicalHash(ballots), ballotsCounts };
}

function main() {
  let entries;
  try {
    entries = ELECTIONS.map(loadEntry);
  } catch (err) {
    console.error(`::error::ballot-verification: cannot read a record: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict(entries);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::ballot-verification: ${e}`);
    console.error(`ballot verification: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  const released = entries.filter((e) => e.verification.status === "released").length;
  console.info(
    `ballot verification OK — ${entries.length} elections, ${released} released, ${entries.length - released} pending two-person review`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
