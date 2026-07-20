#!/usr/bin/env node
/**
 * @fileoverview CI guard: the security controls + evidence register is structurally complete and
 * fail-closed.
 *
 * The register (docs/legal/security-register.json) is the single machine-readable map from each
 * security control to the code that enforces it and/or the external evidence that substantiates it.
 * This guard proves:
 *   - the register is well-formed: a vulnerability policy, a non-empty forbidden-log-field list, a
 *     non-empty required-response-header list, and at least one control;
 *   - every control has an id, title, category, a known status, a non-empty public statement, an
 *     enforcedBy array and one evidence record;
 *   - a control that claims "implemented" must be backed by at least one code enforcer OR
 *     not-required evidence — it cannot ride on pending external evidence alone (fail-closed);
 *   - evidence records are well-formed, and any evidence marked "current" carries a reviewer + a
 *     valid approval date + a FUTURE expiry (stale/expired evidence fails);
 *   - risk acceptances are well-formed: each names the advisory, an approver, a valid acceptance
 *     date and a valid expiry.
 *
 * Expiry ENFORCEMENT of a risk acceptance against a live vulnerability is the deploy vuln gate's job
 * (scripts/check-vuln-gate.mjs); here we only assert the records are well-formed.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing only runs when
 * the script is executed directly.
 *
 * Usage:
 *   node scripts/check-security-register.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONTROL_STATUS = ["planned", "in-progress", "partial", "implemented", "external-evidence"];
const EVIDENCE_STATUS = ["pending", "current", "expired", "not-required"];
const CATEGORIES = [
  "access-control",
  "authentication",
  "secrets",
  "supply-chain",
  "vulnerability-management",
  "network",
  "logging",
  "governance",
];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Parse an ISO-8601 date (YYYY-MM-DD or full timestamp) to epoch ms, or null.
 * @param {unknown} v
 * @returns {number | null}
 */
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Validate an evidence record, pushing errors under the given label.
 * @param {string} at
 * @param {any} e
 * @param {number} now
 * @param {(m: string) => void} push
 */
function checkEvidence(at, e, now, push) {
  if (!e || typeof e !== "object") {
    push(`${at}: evidence must be an object`);
    return;
  }
  if (!isNonEmptyString(e.id)) push(`${at}: evidence missing id`);
  if (!isNonEmptyString(e.description)) push(`${at}: evidence missing description`);
  if (!EVIDENCE_STATUS.includes(e.status)) {
    push(`${at}: evidence status must be one of ${EVIDENCE_STATUS.join(", ")}`);
  }
  if (e.status === "expired") {
    push(`${at}: evidence is expired and must be renewed (fail-closed)`);
  }
  if (e.status === "current") {
    if (!isNonEmptyString(e.reviewer)) push(`${at}: current evidence needs a reviewer`);
    const approved = parseIsoDate(e.approvedAt);
    const expires = parseIsoDate(e.expiresAt);
    if (approved === null) push(`${at}: current evidence needs a valid approvedAt`);
    if (expires === null) push(`${at}: current evidence needs a valid expiresAt`);
    else if (expires < now) push(`${at}: current evidence expired at ${e.expiresAt} (fail-closed)`);
  }
}

/**
 * Validate a parsed security register.
 *
 * @param {unknown} register  parsed docs/legal/security-register.json
 * @param {{ now?: number }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(register, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const push = (m) => errors.push(m);

  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    return { ok: false, errors: ["register: not a JSON object"] };
  }
  if (register.schemaVersion !== 1) {
    push(`schemaVersion: expected 1, got ${JSON.stringify(register.schemaVersion)}`);
  }

  const vp = register.vulnerabilityPolicy;
  if (!vp || typeof vp !== "object") {
    push("vulnerabilityPolicy: missing");
  } else {
    const sev = Array.isArray(vp.blockSeverities) ? vp.blockSeverities : [];
    if (sev.length === 0)
      push("vulnerabilityPolicy.blockSeverities: must list at least one severity");
    if (!sev.includes("high") || !sev.includes("critical")) {
      push("vulnerabilityPolicy.blockSeverities: must block both high and critical (fail-closed)");
    }
    if (vp.requiresSignedRiskAcceptance !== true) {
      push("vulnerabilityPolicy.requiresSignedRiskAcceptance: must be true (fail-closed)");
    }
  }

  // Forbidden-log-field list and required-response-header list must be present and non-empty.
  const flf = register.forbiddenLogFields;
  if (!Array.isArray(flf) || flf.length === 0 || !flf.every(isNonEmptyString)) {
    push("forbiddenLogFields: must be a non-empty array of non-empty strings");
  }
  const rrh = register.requiredResponseHeaders;
  if (!Array.isArray(rrh) || rrh.length === 0 || !rrh.every(isNonEmptyString)) {
    push("requiredResponseHeaders: must be a non-empty array of non-empty strings");
  }
  const fls = register.forbiddenLogScope;
  if (!Array.isArray(fls) || fls.length === 0 || !fls.every(isNonEmptyString)) {
    push("forbiddenLogScope: must be a non-empty array of paths to scan");
  }

  // Risk acceptances (may be empty; each present one must be well-formed).
  const ras = Array.isArray(register.riskAcceptances) ? register.riskAcceptances : null;
  if (ras === null) {
    push("riskAcceptances: must be an array (empty is fine)");
  } else {
    for (const [i, ra] of ras.entries()) {
      const at = `riskAcceptances[${i}]`;
      if (!ra || typeof ra !== "object") {
        push(`${at}: not an object`);
        continue;
      }
      if (!isNonEmptyString(ra.id)) push(`${at}: missing id`);
      if (!isNonEmptyString(ra.advisory)) push(`${at}: missing advisory reference`);
      if (!isNonEmptyString(ra.acceptedBy)) push(`${at}: missing acceptedBy (a signed acceptance)`);
      if (!isNonEmptyString(ra.justification)) push(`${at}: missing justification`);
      if (parseIsoDate(ra.acceptedAt) === null) push(`${at}: acceptedAt must be a valid date`);
      if (parseIsoDate(ra.expiresAt) === null) push(`${at}: expiresAt must be a valid date`);
    }
  }

  const controls = Array.isArray(register.controls) ? register.controls : null;
  if (controls === null) {
    push("controls: not an array");
    return { ok: false, errors };
  }
  if (controls.length === 0) push("controls: must have at least one control");

  const ids = new Map();
  for (const c of controls) {
    if (!c || typeof c !== "object") {
      push("control: not an object");
      continue;
    }
    const id = c.id;
    if (!isNonEmptyString(id)) {
      push("control: missing id");
      continue;
    }
    ids.set(id, (ids.get(id) ?? 0) + 1);
    const at = `control ${id}`;

    if (!isNonEmptyString(c.title)) push(`${at}: missing title`);
    if (!CATEGORIES.includes(c.category)) {
      push(`${at}: category must be one of ${CATEGORIES.join(", ")}`);
    }
    if (!CONTROL_STATUS.includes(c.status)) {
      push(`${at}: status must be one of ${CONTROL_STATUS.join(", ")}`);
    }
    if (!isNonEmptyString(c.publicStatement)) {
      push(`${at}: missing publicStatement (the generated public wording)`);
    }
    const enforcedBy = Array.isArray(c.enforcedBy) ? c.enforcedBy : null;
    if (enforcedBy === null || !enforcedBy.every(isNonEmptyString)) {
      push(`${at}: enforcedBy must be an array of non-empty strings (may be empty)`);
    }

    checkEvidence(at, c.evidence, now, push);

    // Ratchet: a control that claims "implemented" must be backed by a code enforcer OR
    // not-required evidence — it cannot claim done on pending/expired external evidence alone.
    if (c.status === "implemented") {
      const hasEnforcer = Array.isArray(enforcedBy) && enforcedBy.length > 0;
      const evOk =
        c.evidence && (c.evidence.status === "current" || c.evidence.status === "not-required");
      if (!hasEnforcer && !evOk) {
        push(
          `${at}: status "implemented" needs a code enforcer or current/not-required evidence, not pending external evidence alone`,
        );
      }
    }
  }
  for (const [id, n] of ids) {
    if (n > 1) push(`control ${id}: declared ${n} times`);
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const REGISTER_PATH = new URL("../docs/legal/security-register.json", import.meta.url);

function main() {
  let register;
  try {
    register = JSON.parse(readFileSync(REGISTER_PATH, "utf8"));
  } catch (err) {
    console.error(`::error::security-register: cannot read register: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict(register);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::security-register: ${e}`);
    console.error(`security register: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(`security register OK — ${register.controls.length} control(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
