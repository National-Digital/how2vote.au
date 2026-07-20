#!/usr/bin/env node
/**
 * @fileoverview CI guard: AEC boundary-geometry spatial licence + derivative-product notice.
 *
 * data/aec-spatial/source-record.json records the licence that governs the AEC federal boundary GIS
 * the map geometry is derived from, and the full derivative-product notice that licence prescribes.
 * The AEC publishes this data under the AEC Spatial Data Download Data Licence (NOT CC BY 4.0), and
 * a digital Derivative Product must display a prescribed notice — a bare attribution is insufficient.
 *
 * This guard proves:
 *   - the record is well-formed and its rightsClass resolves to a class in the rights register whose
 *     licence matches — so the register can never re-assert CC BY 4.0;
 *   - the prescribed derivative-product notice carries every mandatory element (AEC data identity,
 *     Commonwealth copyright + the recorded copyright year, AEC permission, the "AEC has not
 *     evaluated" statement, the no-warranty disclaimer, and the limited end-user licence), with the
 *     product name substituted throughout;
 *   - the copyright year is recorded explicitly with a note (it is taken from the accepted licence
 *     wording, not the boundary year — the AEC page shows 2026 despite a 2013 update);
 *   - a source may only be `verified` (and the record `current`) once the exact downloaded file is
 *     retained with a checksum and download date — fail-closed; `provisional`/`pending` is allowed
 *     while that evidence is outstanding.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-aec-spatial.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const STATUS = ["provisional", "current"];
const SOURCE_STATUS = ["pending", "verified"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/** Phrases the prescribed AEC derivative-product notice must contain (checked case-insensitively). */
const REQUIRED_NOTICE_PHRASES = [
  "incorporates data that is", // AEC data identity
  "© commonwealth of australia (australian electoral commission)",
  "with the permission of the australian electoral commission",
  "has not evaluated the data",
  "no warranty",
  "for your personal use, or use within your organisation only",
];

/**
 * @param {unknown} record  parsed data/aec-spatial/source-record.json
 * @param {{ rightsClassIds?: string[], rightsLicenceName?: string|null }} [ctx]
 *   Callers MUST pass ctx from the rights register in production — the rightsClass membership and
 *   licence-name cross-ties (which stop a silent CC-BY relapse) are skipped when ctx is empty. main()
 *   always populates it; the default only exists so verdict() stays unit-testable in isolation.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(record, ctx = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const at = "aec-spatial";

  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return { ok: false, errors: [`${at}: not a JSON object`] };
  }
  if (record.schemaVersion !== 1) push(`${at}: schemaVersion must be 1`);
  if (!isNonEmptyString(record.productName)) push(`${at}: missing productName`);
  if (!isNonEmptyString(record.boundaryData)) push(`${at}: missing boundaryData`);
  if (!STATUS.includes(record.status)) push(`${at}: status must be one of ${STATUS.join(", ")}`);
  // A retained copy of the governing licence terms must travel with the data.
  if (!isNonEmptyString(record.licenceEvidence)) push(`${at}: missing licenceEvidence path`);

  // Rights class cross-tie to the register.
  if (!isNonEmptyString(record.rightsClass)) push(`${at}: missing rightsClass`);
  else if (ctx.rightsClassIds && !ctx.rightsClassIds.includes(record.rightsClass)) {
    push(`${at}: rightsClass "${record.rightsClass}" is not defined in the rights register`);
  }

  const lic = record.licence;
  if (typeof lic !== "object" || lic === null) push(`${at}: missing licence`);
  else {
    if (!isNonEmptyString(lic.name)) push(`${at}: licence.name is required`);
    // The register and this record must name the same licence — prevents a silent CC-BY relapse.
    else if (ctx.rightsLicenceName && ctx.rightsLicenceName !== lic.name) {
      push(
        `${at}: licence.name ("${lic.name}") disagrees with the rights register ("${ctx.rightsLicenceName}")`,
      );
    }
    if (!isNonEmptyString(lic.url)) push(`${at}: licence.url is required`);
    if (!isIsoDate(lic.capturedAt)) push(`${at}: licence.capturedAt must be an ISO date`);
    if (!isNonEmptyString(lic.copyrightYear)) push(`${at}: licence.copyrightYear is required`);
    // The copyright year is a known hazard (AEC shows 2026 despite a 2013 update) — force a note so
    // it is never silently derived from the boundary year.
    if (!isNonEmptyString(lic.copyrightYearNote))
      push(`${at}: licence.copyrightYearNote is required (explain the recorded copyright year)`);
  }

  // Prescribed derivative-product notice.
  const notice = record.notice;
  const components = Array.isArray(notice?.components) ? notice.components : null;
  if (!components || components.length < 4) {
    push(`${at}: notice.components must list the prescribed notice (at least 4 elements)`);
  } else {
    const joined = components.join("\n");
    const lower = joined.toLowerCase();
    for (const phrase of REQUIRED_NOTICE_PHRASES) {
      if (!lower.includes(phrase)) push(`${at}: notice is missing the required phrase "${phrase}"`);
    }
    // Product name must appear (the notice is product-specific).
    if (isNonEmptyString(record.productName) && !joined.includes(record.productName)) {
      push(`${at}: notice must name the product ("${record.productName}")`);
    }
    // The notice's copyright year must match the recorded one (no drift between the two).
    if (isNonEmptyString(lic?.copyrightYear) && !joined.includes(lic.copyrightYear)) {
      push(`${at}: notice must carry the recorded copyright year (${lic.copyrightYear})`);
    }
  }

  const sources = Array.isArray(record.sources) ? record.sources : null;
  if (!sources || sources.length === 0) push(`${at}: sources must be a non-empty array`);
  else {
    for (const [i, s] of sources.entries()) {
      const sat = `${at} sources[${i}]${isNonEmptyString(s?.electionId) ? ` (${s.electionId})` : ""}`;
      if (typeof s !== "object" || s === null) {
        push(`${sat}: not an object`);
        continue;
      }
      for (const f of ["electionId", "title", "sourceUrl"]) {
        if (!isNonEmptyString(s[f])) push(`${sat}: missing ${f}`);
      }
      if (!Number.isInteger(s.boundaryYear)) push(`${sat}: boundaryYear must be an integer`);
      if (s.sha256 !== null && !SHA256.test(s.sha256 ?? "")) {
        push(`${sat}: sha256 must be null or a sha256 hex digest`);
      }
      if (s.archiveRetained !== undefined && typeof s.archiveRetained !== "boolean") {
        push(`${sat}: archiveRetained must be a boolean`);
      }
      if (!SOURCE_STATUS.includes(s.status))
        push(`${sat}: status must be one of ${SOURCE_STATUS.join(", ")}`);
      else if (s.status === "verified") {
        // A verified source proves provenance: retained file + checksum + download date + a named
        // reviewer attestation that this archive + licence governed the committed geometry.
        if (!isNonEmptyString(s.fileName)) push(`${sat}: verified source needs a fileName`);
        if (!SHA256.test(s.sha256 ?? "")) push(`${sat}: verified source needs a sha256`);
        if (!isIsoDate(s.downloadedAt)) push(`${sat}: verified source needs a valid downloadedAt`);
        if (s.archiveRetained !== true) push(`${sat}: verified source must retain the archive`);
        if (!isNonEmptyString(s.reviewer)) push(`${sat}: verified source needs a reviewer`);
        if (!isIsoDate(s.reviewedAt)) push(`${sat}: verified source needs a valid reviewedAt`);
      }
    }
    // The record can only be `current` once every source is verified — fail-closed.
    if (record.status === "current" && !sources.every((s) => s?.status === "verified")) {
      push(`${at}: status "current" requires every source to be verified`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
function main() {
  const root = new URL("../", import.meta.url);
  let record;
  try {
    record = JSON.parse(readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"));
  } catch (err) {
    console.error(
      `::error::aec-spatial: cannot read data/aec-spatial/source-record.json: ${err.message}`,
    );
    process.exit(1);
    return;
  }
  let ctx;
  try {
    const rights = JSON.parse(
      readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"),
    );
    const cls = rights.rightsClasses.find((c) => c.id === record.rightsClass);
    ctx = {
      rightsClassIds: rights.rightsClasses.map((c) => c.id),
      rightsLicenceName: cls?.licence?.name ?? null,
    };
  } catch (err) {
    console.error(`::error::aec-spatial: cannot read the rights register: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict(record, ctx);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::aec-spatial: ${e}`);
    console.error(`AEC spatial licence: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const verified = record.sources.filter((s) => s.status === "verified").length;
  console.info(
    `AEC spatial licence OK — ${record.status}; ${verified}/${record.sources.length} sources verified (${record.licence.name})`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
