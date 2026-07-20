#!/usr/bin/env node
/**
 * @fileoverview CI guard: rights-domain separation and contamination-proof data architecture.
 *
 * data/rights/rights-classes.json is the single source of truth for every upstream data source's
 * licence/attribution/redistribution terms and the mapping from each committed data domain to its
 * rights class. This guard proves:
 *   - every rights class is well-formed (id, source, licence, copyright, attribution, terms);
 *   - every data domain declares a rights class that actually exists — no record without a rights
 *     class (fail-closed);
 *   - no orphans: every rights class is used by at least one domain and vice-versa;
 *   - the ODbL data is not contaminated by, and does not contaminate, the AEC/Commonwealth or
 *     project-owned domains — only the OpenAustralia Foundation source may be ODbL, and the AEC
 *     candidate/boundary domains must be excluded from the ODbL export set;
 *   - the required committed domains (votes, candidate ballots, boundary geometry) are all present.
 *
 * The generated LICENSE-DATA.md is drift-checked separately by scripts/generate-license-data.mjs
 * (--check), run alongside this guard in CI.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-rights-domain.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const REDISTRIBUTION = ["permitted", "restricted", "prohibited"];
const MODIFICATION = ["permitted", "restricted", "prohibited"];
const LICENCE_STATUS = ["current", "provisional", "under-review"];
const ODBL = "ODbL-1.0";
/** The OpenAustralia Foundation is the only source we may assert ODbL over. */
const ODBL_SOURCE_ORG = "OpenAustralia Foundation";
/** Domains that MUST exist and carry a rights class (the committed data the app ships). */
const REQUIRED_DOMAINS = ["vote-positions", "candidate-ballots", "boundary-geometry"];

/**
 * @param {unknown} register  parsed data/rights/rights-classes.json
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(register) {
  const errors = [];
  const push = (m) => errors.push(m);

  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    return { ok: false, errors: ["rights register: not a JSON object"] };
  }
  if (register.schemaVersion !== 1) push("rights register: schemaVersion must be 1");
  if (!isNonEmptyString(register.noticeVersion)) push("rights register: missing noticeVersion");
  // `updated` is interpolated verbatim into the generated LICENSE-DATA.md header, so an omitted
  // value would print the literal "undefined" into the published legal notice.
  if (!isNonEmptyString(register.updated)) push("rights register: missing updated");

  const classes = Array.isArray(register.rightsClasses) ? register.rightsClasses : null;
  const domains = Array.isArray(register.domains) ? register.domains : null;
  if (!classes) push("rights register: rightsClasses must be an array");
  if (!domains) push("rights register: domains must be an array");
  if (!classes || !domains) return { ok: errors.length === 0, errors };

  const classById = new Map();
  for (const [i, rc] of classes.entries()) {
    const at = `rightsClasses[${i}]${isNonEmptyString(rc?.id) ? ` (${rc.id})` : ""}`;
    if (typeof rc !== "object" || rc === null) {
      push(`${at}: not an object`);
      continue;
    }
    if (!isNonEmptyString(rc.id)) push(`${at}: missing id`);
    else if (classById.has(rc.id)) push(`${at}: duplicate id`);
    else classById.set(rc.id, rc);

    // sourceUrl is interpolated into the generated notice — a missing value would ship "undefined".
    for (const f of ["name", "source", "sourceOrg", "sourceUrl", "copyright", "attribution"]) {
      if (!isNonEmptyString(rc[f])) push(`${at}: missing ${f}`);
    }
    const lic = rc.licence;
    if (typeof lic !== "object" || lic === null) push(`${at}: missing licence`);
    else {
      if (!isNonEmptyString(lic.spdxId)) push(`${at}: licence.spdxId is required`);
      if (!isNonEmptyString(lic.name)) push(`${at}: licence.name is required`);
    }
    if (!REDISTRIBUTION.includes(rc.redistribution))
      push(`${at}: redistribution must be one of ${REDISTRIBUTION.join(", ")}`);
    if (!MODIFICATION.includes(rc.modification))
      push(`${at}: modification must be one of ${MODIFICATION.join(", ")}`);
    if (typeof rc.shareAlike !== "boolean") push(`${at}: shareAlike must be a boolean`);
    if (typeof rc.attributionRequired !== "boolean")
      push(`${at}: attributionRequired must be a boolean`);
    if (!LICENCE_STATUS.includes(rc.licenceStatus))
      push(`${at}: licenceStatus must be one of ${LICENCE_STATUS.join(", ")}`);
    // A class that is not `current` must cite the evidence that will make it current — so a
    // provisional licence determination can never be silently forgotten.
    if (rc.licenceStatus && rc.licenceStatus !== "current" && !isNonEmptyString(rc.evidenceId)) {
      push(`${at}: a ${rc.licenceStatus} licence must cite an evidenceId`);
    }
    // Ship-gate: a licence must be SIGNED OFF (`current`) before it can merge to main / reach
    // production. A provisional / under-review classification is a work-in-progress state that
    // belongs on a feature branch until the determination is settled — it must never ship. This
    // guard is a blocking Data-group CI job, and the repo deploys from main, so a non-current class
    // cannot reach prod. (The renderer still discloses a provisional licence as provisional, as
    // defence-in-depth — see generate-license-data.mjs.)
    if (rc.licenceStatus && rc.licenceStatus !== "current") {
      push(
        `${at}: licence is ${rc.licenceStatus}, not signed-off — a licence must be 'current' before it can ship. Settle the determination (and its evidence) on a feature branch first; provisional/under-review licences must not reach production.`,
      );
    }
  }

  const usedClasses = new Set();
  const domainById = new Map();
  for (const [i, d] of domains.entries()) {
    const at = `domains[${i}]${isNonEmptyString(d?.id) ? ` (${d.id})` : ""}`;
    if (typeof d !== "object" || d === null) {
      push(`${at}: not an object`);
      continue;
    }
    if (!isNonEmptyString(d.id)) push(`${at}: missing id`);
    else if (domainById.has(d.id)) push(`${at}: duplicate id`);
    else domainById.set(d.id, d);
    if (!isNonEmptyString(d.description)) push(`${at}: missing description`);
    // No record without a rights class (fail-closed) — and it must resolve to a defined class.
    if (!isNonEmptyString(d.rightsClass)) push(`${at}: missing rightsClass`);
    else if (!classById.has(d.rightsClass))
      push(`${at}: rightsClass "${d.rightsClass}" is not defined`);
    else usedClasses.add(d.rightsClass);
    if (!Array.isArray(d.sources) || d.sources.length === 0)
      push(`${at}: sources must be non-empty`);
    if (!Array.isArray(d.outputs) || d.outputs.length === 0)
      push(`${at}: outputs must be non-empty`);
  }

  // Every rights class must be used by at least one domain (no dead licence records).
  for (const id of classById.keys()) {
    if (!usedClasses.has(id)) push(`rightsClasses (${id}): defined but no domain uses it`);
  }

  // Required committed domains must exist.
  for (const id of REQUIRED_DOMAINS) {
    if (!domainById.has(id)) push(`rights register: required domain "${id}" is missing`);
  }

  // Contamination proof
  // Only the OpenAustralia Foundation source may be asserted as ODbL.
  for (const rc of classById.values()) {
    if (rc.licence?.spdxId === ODBL && rc.sourceOrg !== ODBL_SOURCE_ORG) {
      push(
        `rightsClasses (${rc.id}): ODbL-1.0 asserted over a non-OpenAustralia-Foundation source (${rc.sourceOrg}) — rights contamination`,
      );
    }
  }
  // The ODbL export set must list exactly the domains whose class is ODbL — so AEC geometry and
  // candidate data can never leak into an ODbL export.
  const odblExport = Array.isArray(register.odblDomains) ? register.odblDomains : null;
  if (!odblExport) push("rights register: odblDomains must be an array");
  else {
    const actualOdbl = new Set(
      domains
        .filter((d) => classById.get(d.rightsClass)?.licence?.spdxId === ODBL)
        .map((d) => d.id),
    );
    for (const id of odblExport) {
      if (!actualOdbl.has(id))
        push(`odblDomains: "${id}" is listed but its rights class is not ODbL-1.0`);
    }
    for (const id of actualOdbl) {
      if (!odblExport.includes(id))
        push(`odblDomains: ODbL domain "${id}" is missing from the export allowlist`);
    }
    // Belt-and-braces: the AEC/boundary domains must never be in the ODbL export set.
    for (const id of ["candidate-ballots", "boundary-geometry"]) {
      if (odblExport.includes(id))
        push(`odblDomains: AEC domain "${id}" must not be an ODbL export`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
function main() {
  const root = new URL("..", import.meta.url);
  let register;
  try {
    register = JSON.parse(readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"));
  } catch (err) {
    console.error(
      `::error::rights-domain: cannot read data/rights/rights-classes.json: ${err.message}`,
    );
    process.exit(1);
    return;
  }
  const result = verdict(register);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::rights-domain: ${e}`);
    console.error(`rights-domain separation: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    `rights-domain separation OK — ${register.rightsClasses.length} rights classes, ${register.domains.length} domains`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
