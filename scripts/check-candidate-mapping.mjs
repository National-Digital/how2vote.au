#!/usr/bin/env node
/**
 * @fileoverview CI guard: the candidate↔party mapping is approved and current.
 *
 * Whose recorded parliamentary alignment is attached to a ballot line depends entirely on the
 * candidate→party mapping in data/source/<id>/parties.json (aecName/alias → key, plus the `noRecord`
 * acknowledgement list). A wrong mapping mis-attributes a party's record to the wrong candidate — a
 * defamation / political-misattribution risk and a data-accuracy / correction-ownership
 * risk. This guard binds a per-election approval record
 * (data/source/<id>/candidate-mapping.json) to the EXACT parties.json bytes and proves:
 *   - the record is well-formed and its `partiesSourceHash` matches the current parties.json, so any
 *     change to the mapping invalidates the approval and forces a re-review (fail-closed);
 *   - the declared coverage (parties / independents / no-record names) matches parties.json, so a
 *     silently added/removed mapping can't pass with a stale count;
 *   - a record marked `approved` carries a named reviewer + review date (the accountable-owner
 *     control); `pending` is allowed while human review is outstanding, but an approval
 *     claim without a reviewer FAILS.
 *
 * The signed evidence chain for the mapping and the accountable data owner
 * are external evidence; this guard enforces that the machine-checkable
 * parts are complete, attributable and hash-bound, and that nothing claims `approved` without an
 * owner.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-candidate-mapping.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const STATUS = ["pending", "approved"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v */
const isNonNegativeInt = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
/** @param {unknown} v — strict ISO date/datetime (mirrors the other guards). */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** Canonical sha-256 of a parsed JSON value — matches the pipeline's checksum(). */
export function canonicalHash(parsed) {
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

/** Coverage counts derived from a parsed parties.json (registry). */
export function partiesCounts(parties) {
  const list = Array.isArray(parties?.parties) ? parties.parties : [];
  return {
    parties: list.filter((p) => p?.kind === "party").length,
    independents: list.filter((p) => p?.kind === "independent").length,
    noRecordNames: Array.isArray(parties?.noRecord) ? parties.noRecord.length : 0,
  };
}

/**
 * @param {{ electionId: string, mapping: unknown, partiesHash: string,
 *           counts?: { parties: number, independents: number, noRecordNames: number } }[]} entries
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(entries) {
  const errors = [];
  const push = (m) => errors.push(m);

  for (const { electionId, mapping: m, partiesHash, counts } of entries) {
    const at = `candidate-mapping (${electionId})`;
    if (typeof m !== "object" || m === null || Array.isArray(m)) {
      push(`${at}: not a JSON object`);
      continue;
    }
    if (m.schemaVersion !== 1) push(`${at}: schemaVersion must be 1`);
    if (m.electionId !== electionId) push(`${at}: electionId must be "${electionId}"`);

    if (!SHA256.test(m.partiesSourceHash ?? "")) {
      push(`${at}: partiesSourceHash must be a sha256 hex digest`);
    } else if (partiesHash && m.partiesSourceHash !== partiesHash) {
      push(
        `${at}: partiesSourceHash is stale (recorded ${m.partiesSourceHash.slice(0, 8)}, parties.json is ${partiesHash.slice(0, 8)}) — the mapping changed since approval; re-review`,
      );
    }

    const cov = m.coverage;
    if (typeof cov !== "object" || cov === null) {
      push(`${at}: missing coverage`);
    } else {
      for (const k of ["parties", "independents", "noRecordNames"]) {
        if (!isNonNegativeInt(cov[k])) push(`${at}: coverage.${k} must be a non-negative integer`);
        else if (counts && cov[k] !== counts[k]) {
          push(`${at}: coverage.${k} (${cov[k]}) != parties.json (${counts[k]})`);
        }
      }
    }

    if (!STATUS.includes(m.status)) push(`${at}: status must be one of ${STATUS.join(", ")}`);
    else if (m.status === "approved") {
      // The accountable-owner control: an approval must name a reviewer and a date.
      if (!isNonEmptyString(m.reviewer)) push(`${at}: approved record needs a reviewer`);
      if (!isIsoDate(m.reviewedAt)) push(`${at}: approved record needs a valid reviewedAt`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ELECTIONS = ["2019", "2022", "2025"];

function loadEntry(electionId) {
  const root = new URL("../", import.meta.url);
  const mapping = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/candidate-mapping.json`, root), "utf8"),
  );
  const parties = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/parties.json`, root), "utf8"),
  );
  return {
    electionId,
    mapping,
    partiesHash: canonicalHash(parties),
    counts: partiesCounts(parties),
  };
}

function main() {
  let entries;
  try {
    entries = ELECTIONS.map(loadEntry);
  } catch (err) {
    console.error(`::error::candidate-mapping: cannot read a record: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict(entries);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::candidate-mapping: ${e}`);
    console.error(`candidate mapping: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const approved = entries.filter((e) => e.mapping.status === "approved").length;
  console.info(
    `candidate mapping OK — ${entries.length} elections, ${approved} approved, ${entries.length - approved} pending review`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
