#!/usr/bin/env node
/**
 * @fileoverview CI guard: AEC candidate, ballot and electorate data provenance.
 *
 * Each election carries data/source/<id>/aec-sources.json — a per-source provenance register for the
 * AEC candidate/ballot/electorate data compiled into ballots.json. This guard proves:
 *   - each source record is well-formed and attributable (title, publisher, URL, publication +
 *     retrieval dates, parser version, rights class);
 *   - the register's rightsClass resolves to a class defined in data/rights/rights-classes.json, so
 *     provenance and the rights register can never drift apart;
 *   - the recorded outputHash matches the current ballots.json — any change to the compiled output
 *     invalidates the provenance and forces a re-record (fail-closed);
 *   - the declared coverage matches the actual ballots.json counts;
 *   - a record marked `verified` carries a reviewer, a review date, the retained raw source and its
 *     hash (the two-person/raw-retention control); `pending` is allowed while that is outstanding.
 *
 * The two-person ballot-ORDER verification is a separate control (check-ballot-verification.mjs);
 * this guard is about where the data came from, not the order review.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-aec-provenance.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const STATUS = ["pending", "verified"];
const REQUIRED_SOURCES = ["house-nominations", "senate-nominations", "electorates"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v — strict ISO date/datetime (mirrors the other guards). */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** Canonical sha-256 of a parsed JSON value — matches the pipeline's checksum(). */
export function canonicalHash(parsed) {
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

/**
 * @param {{ electionId: string, record: unknown, ballotsHash: string,
 *           ballotsCoverage?: object, rightsClassIds?: string[] }[]} entries
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(entries) {
  const errors = [];
  const push = (m) => errors.push(m);

  for (const {
    electionId,
    record: r,
    ballotsHash,
    ballotsCoverage,
    rightsClassIds,
    minPublishedAt,
  } of entries) {
    const at = `aec-sources (${electionId})`;
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      push(`${at}: not a JSON object`);
      continue;
    }
    if (r.schemaVersion !== 1) push(`${at}: schemaVersion must be 1`);
    if (r.electionId !== electionId) push(`${at}: electionId must be "${electionId}"`);
    // recordedAt: when this provenance register was authored (distinct from a source retrieval).
    if (!isIsoDate(r.recordedAt)) push(`${at}: recordedAt must be an ISO date`);

    // Rights class must exist in the rights register.
    if (!isNonEmptyString(r.rightsClass)) push(`${at}: missing rightsClass`);
    else if (rightsClassIds && !rightsClassIds.includes(r.rightsClass)) {
      push(
        `${at}: rightsClass "${r.rightsClass}" is not defined in data/rights/rights-classes.json`,
      );
    }

    // Output hash ties the provenance to the exact compiled ballots.json bytes.
    if (!SHA256.test(r.outputHash ?? "")) push(`${at}: outputHash must be a sha256 hex digest`);
    else if (ballotsHash && r.outputHash !== ballotsHash) {
      push(
        `${at}: outputHash is stale (recorded ${r.outputHash.slice(0, 8)}, ballots.json is ${ballotsHash.slice(0, 8)}) — ballots changed since provenance was recorded; re-record`,
      );
    }

    // Coverage cross-check against the actual ballots.json.
    const cov = r.coverage;
    if (typeof cov !== "object" || cov === null) push(`${at}: missing coverage`);
    else if (ballotsCoverage) {
      for (const k of Object.keys(ballotsCoverage)) {
        if (cov[k] !== ballotsCoverage[k]) {
          push(`${at}: coverage.${k} (${cov[k]}) != ballots.json (${ballotsCoverage[k]})`);
        }
      }
    }

    const sources = Array.isArray(r.sources) ? r.sources : null;
    if (!sources || sources.length === 0) {
      push(`${at}: sources must be a non-empty array`);
      continue;
    }
    const ids = new Set();
    for (const [i, s] of sources.entries()) {
      const sat = `${at} sources[${i}]${isNonEmptyString(s?.id) ? ` (${s.id})` : ""}`;
      if (typeof s !== "object" || s === null) {
        push(`${sat}: not an object`);
        continue;
      }
      if (!isNonEmptyString(s.id)) push(`${sat}: missing id`);
      else if (ids.has(s.id)) push(`${sat}: duplicate id`);
      else ids.add(s.id);
      for (const f of ["title", "publisher", "url", "rawPath", "parserVersion"]) {
        if (!isNonEmptyString(s[f])) push(`${sat}: missing ${f}`);
      }
      if (!isIsoDate(s.publishedAt)) push(`${sat}: publishedAt must be an ISO date`);
      // publishedAt is the AEC's declaration of nominations — it cannot predate close of
      // nominations. Guards against copying the wrong domain's date (e.g. the vote-vintage
      // dataVersion, which precedes the writ).
      else if (minPublishedAt && Date.parse(s.publishedAt) < Date.parse(minPublishedAt)) {
        push(
          `${sat}: publishedAt (${s.publishedAt}) is before close of nominations (${minPublishedAt}) — a declared candidate list cannot predate it`,
        );
      }
      // retrievedAt is null until the raw source is actually retrieved; when present it must be a
      // valid ISO date on/after publishedAt.
      if (s.retrievedAt !== null && !isIsoDate(s.retrievedAt)) {
        push(`${sat}: retrievedAt must be null or an ISO date`);
      } else if (
        isIsoDate(s.publishedAt) &&
        isIsoDate(s.retrievedAt) &&
        Date.parse(s.retrievedAt) < Date.parse(s.publishedAt)
      ) {
        push(`${sat}: retrievedAt is before publishedAt`);
      }
      if (typeof s.rawRetained !== "boolean") push(`${sat}: rawRetained must be a boolean`);
      if (s.sourceSha256 !== null && !SHA256.test(s.sourceSha256 ?? "")) {
        push(`${sat}: sourceSha256 must be null or a sha256 hex digest`);
      }
      if (!STATUS.includes(s.status)) push(`${sat}: status must be one of ${STATUS.join(", ")}`);
      else if (s.status === "verified") {
        // A verified source must be fully attributable, retrieved, and its raw retained + hashed.
        if (!isNonEmptyString(s.reviewer)) push(`${sat}: verified record needs a reviewer`);
        if (!isIsoDate(s.reviewedAt)) push(`${sat}: verified record needs a valid reviewedAt`);
        if (!isIsoDate(s.retrievedAt)) push(`${sat}: verified record needs a valid retrievedAt`);
        if (!SHA256.test(s.sourceSha256 ?? ""))
          push(`${sat}: verified record needs the raw sourceSha256`);
        if (s.rawRetained !== true) push(`${sat}: verified record must retain the raw source`);
      }
    }
    for (const id of REQUIRED_SOURCES) {
      if (!ids.has(id)) push(`${at}: required source "${id}" is missing`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ELECTIONS = ["2019", "2022", "2025"];

function loadEntry(electionId, rightsClassIds, closeOfNominationsById) {
  const root = new URL("../", import.meta.url);
  const record = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/aec-sources.json`, root), "utf8"),
  );
  const ballots = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/ballots.json`, root), "utf8"),
  );
  const ballotsCoverage = {
    houseCandidates: (ballots.house ?? []).length,
    senateCandidates: (ballots.senate ?? []).length,
    houseElectorates: new Set((ballots.house ?? []).map((r) => r.division)).size,
    senateJurisdictions: new Set((ballots.senate ?? []).map((r) => r.state)).size,
    electorates: (ballots.electorates ?? []).length,
  };
  return {
    electionId,
    record,
    ballotsHash: canonicalHash(ballots),
    ballotsCoverage,
    rightsClassIds,
    minPublishedAt: closeOfNominationsById[electionId] ?? null,
  };
}

function main() {
  const root = new URL("../", import.meta.url);
  let rightsClassIds;
  let closeOfNominationsById = {};
  try {
    const rights = JSON.parse(
      readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"),
    );
    rightsClassIds = rights.rightsClasses.map((c) => c.id);
    const elections = JSON.parse(readFileSync(new URL("data/dist/elections.json", root), "utf8"));
    for (const e of elections) {
      const close = e.timetable?.closeOfNominations;
      if (close) closeOfNominationsById[e.id] = String(close).slice(0, 10);
    }
  } catch (err) {
    console.error(
      `::error::aec-provenance: cannot read the rights/elections registers: ${err.message}`,
    );
    process.exit(1);
    return;
  }
  let entries;
  try {
    entries = ELECTIONS.map((id) => loadEntry(id, rightsClassIds, closeOfNominationsById));
  } catch (err) {
    console.error(`::error::aec-provenance: cannot read a record: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict(entries);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::aec-provenance: ${e}`);
    console.error(`AEC provenance: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const verified = entries.filter((e) =>
    e.record.sources.every((s) => s.status === "verified"),
  ).length;
  console.info(
    `AEC provenance OK — ${entries.length} elections, ${verified} fully verified, ${entries.length - verified} with sources pending raw-retention review`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
