#!/usr/bin/env node
/**
 * @fileoverview CI guard: research-ingestion integrity + server-enforced consent.
 *
 * The behavioural core (token signing/verification, single-use nonce, registry value rejection,
 * consent classification) is covered by the app's own unit tests (apps/web functions + src/lib/
 * research). This guard enforces the machine-readable + fail-closed surfaces that must not silently
 * regress:
 *
 *  (a) SIGNED REGISTRY — apps/web/src/lib/research/election-registry.json is present, structurally
 *      valid, and its content-integrity digest actually matches its `{version, elections}` body
 *      (tamper-evidence, independent of the drift gate). The drift-vs-datasets check is
 *      scripts/generate-research-registry.mjs.
 *
 *  (b) INTEGRITY ALERT — docs/research/integrity-alert.json is present and well-formed, and when it is
 *      ACTIVE it records who declared it, when, and why (so a live suspension is always attributable).
 *
 *  (c) FAIL-CLOSED WIRING — the stats generator still consults the integrity alert and exits on
 *      suspension; the wiring cannot be removed without failing this guard.
 *
 *  (d) CONSENT CENTRALISATION — RESEARCH_CONSENT_VERSION is DEFINED in exactly one place
 *      (research/consent.ts); no other source redefines it (single-source-of-truth).
 *
 * Pure decision logic is exported for unit tests; the fs/CLI plumbing runs only when executed directly.
 *
 * Usage:
 *   node scripts/check-research-integrity.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registryDigest } from "./generate-research-registry.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SHA256_TAG = /^sha256-[0-9a-f]{64}$/;

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * (a) Validate the signed election registry and verify its integrity digest.
 * @param {unknown} registry parsed election-registry.json
 * @returns {string[]} errors
 */
export function verifyRegistry(registry) {
  const errors = [];
  const at = "election-registry";
  if (typeof registry !== "object" || registry === null || Array.isArray(registry)) {
    return [`${at}: not a JSON object`];
  }
  if (!Number.isInteger(registry.version) || registry.version < 1) {
    errors.push(`${at}: version must be a positive integer`);
  }
  if (!isNonEmptyString(registry.integrity) || !SHA256_TAG.test(registry.integrity)) {
    errors.push(`${at}: integrity must be a "sha256-<hex>" digest`);
  }
  const elections = registry.elections;
  if (typeof elections !== "object" || elections === null || Array.isArray(elections)) {
    errors.push(`${at}: elections must be an object`);
    return errors;
  }
  const ids = Object.keys(elections);
  if (ids.length === 0) errors.push(`${at}: elections is empty`);
  for (const id of ids) {
    const e = elections[id];
    if (typeof e !== "object" || e === null) {
      errors.push(`${at}: election "${id}" is not an object`);
      continue;
    }
    if (!Array.isArray(e.parties) || !e.parties.every((p) => isNonEmptyString(p))) {
      errors.push(`${at}: election "${id}" parties must be an array of non-empty strings`);
    }
    if (
      !Array.isArray(e.propositionIds) ||
      !e.propositionIds.every((n) => Number.isInteger(n) && n > 0)
    ) {
      errors.push(`${at}: election "${id}" propositionIds must be an array of positive integers`);
    }
  }

  // Tamper-evidence: recompute the digest over the body and compare.
  if (SHA256_TAG.test(registry.integrity ?? "")) {
    const recomputed = registryDigest({ version: registry.version, elections });
    if (recomputed !== registry.integrity) {
      errors.push(
        `${at}: integrity digest does not match the body (recomputed ${recomputed}) — the registry has been tampered with or was not regenerated`,
      );
    }
  }
  return errors;
}

/**
 * (b) Validate the integrity-alert record.
 * @param {unknown} alert parsed integrity-alert.json
 * @returns {string[]} errors
 */
export function verifyAlert(alert) {
  const errors = [];
  const at = "integrity-alert";
  if (typeof alert !== "object" || alert === null || Array.isArray(alert)) {
    return [`${at}: not a JSON object`];
  }
  if (alert.schemaVersion !== 1) errors.push(`${at}: schemaVersion must be 1`);
  if (typeof alert.active !== "boolean") errors.push(`${at}: active must be a boolean`);
  if (alert.active === true) {
    if (!isNonEmptyString(alert.reason)) errors.push(`${at}: an ACTIVE alert must record a reason`);
    if (!isNonEmptyString(alert.declaredBy))
      errors.push(`${at}: an ACTIVE alert must record declaredBy`);
    if (!ISO_DATE.test(alert.declaredAt ?? ""))
      errors.push(`${at}: an ACTIVE alert must record an ISO declaredAt`);
  }
  return errors;
}

/**
 * (c) The stats generator must still consult the integrity alert and exit on suspension.
 * @param {string} statsSource generate-stats.ts source
 * @returns {string[]} errors
 */
export function verifyStatsWiring(statsSource) {
  const errors = [];
  const at = "generate-stats";
  if (typeof statsSource !== "string" || statsSource.length === 0) {
    return [`${at}: source not found`];
  }
  if (!statsSource.includes("integrity-alert.json")) {
    errors.push(
      `${at}: no longer reads docs/research/integrity-alert.json (fail-closed gate removed)`,
    );
  }
  if (!statsSource.includes("evaluateIntegrityAlert")) {
    errors.push(`${at}: no longer evaluates the integrity alert (fail-closed gate removed)`);
  }
  if (!/process\.exit\(1\)/.test(statsSource)) {
    errors.push(`${at}: the integrity gate must exit non-zero on suspension (fail closed)`);
  }
  return errors;
}

/**
 * (d) RESEARCH_CONSENT_VERSION must be defined in exactly one file.
 * @param {string[]} definers paths that ASSIGN RESEARCH_CONSENT_VERSION
 * @returns {string[]} errors
 */
export function verifyConsentCentralisation(definers) {
  const expected = "apps/web/src/lib/research/consent.ts";
  if (definers.length === 1 && definers[0] === expected) return [];
  if (definers.length === 0) {
    return [`consent: RESEARCH_CONSENT_VERSION is not defined anywhere (expected in ${expected})`];
  }
  return [
    `consent: RESEARCH_CONSENT_VERSION must be defined only in ${expected}, but is assigned in: ${definers.join(", ")}`,
  ];
}

/**
 * Combine every section into one verdict.
 * @param {{ registry?: unknown, alert?: unknown, statsSource?: string, consentDefiners?: string[] }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  if (input.registry !== undefined) errors.push(...verifyRegistry(input.registry));
  if (input.alert !== undefined) errors.push(...verifyAlert(input.alert));
  if (input.statsSource !== undefined) errors.push(...verifyStatsWiring(input.statsSource));
  if (input.consentDefiners !== undefined)
    errors.push(...verifyConsentCentralisation(input.consentDefiners));
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- fs/git/CLI plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const REGISTRY_PATH = new URL("apps/web/src/lib/research/election-registry.json", ROOT);
const ALERT_PATH = new URL("docs/research/integrity-alert.json", ROOT);
const STATS_PATH = new URL("packages/data-pipeline/src/bin/generate-stats.ts", ROOT);

/** Files that DEFINE (assign) RESEARCH_CONSENT_VERSION — a re-export (`export { ... }`) has no `=`. */
function findConsentDefiners() {
  const root = fileURLToPath(ROOT);
  const listed = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.js", "*.mjs", "*.svelte"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .filter((p) => !/\.test\.(ts|tsx|js|mjs)$/.test(p));
  const definers = [];
  for (const rel of listed) {
    let text;
    try {
      text = readFileSync(new URL(rel, ROOT), "utf8");
    } catch {
      continue;
    }
    if (/\bRESEARCH_CONSENT_VERSION\s*=/.test(text)) definers.push(rel);
  }
  return definers.sort();
}

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function main() {
  /** @type {Parameters<typeof verdict>[0]} */
  const input = {};
  try {
    input.registry = readJson(REGISTRY_PATH);
  } catch (err) {
    console.error(
      `::error::research-integrity: cannot read election-registry.json: ${err.message}`,
    );
    process.exit(1);
  }
  try {
    input.alert = readJson(ALERT_PATH);
  } catch (err) {
    console.error(`::error::research-integrity: cannot read integrity-alert.json: ${err.message}`);
    process.exit(1);
  }
  try {
    input.statsSource = readFileSync(STATS_PATH, "utf8");
  } catch {
    input.statsSource = "";
  }
  input.consentDefiners = findConsentDefiners();

  const result = verdict(input);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::research-integrity: ${e}`);
    console.error(`research-integrity: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    "research-integrity OK — signed registry, integrity alert, fail-closed stats wiring and centralised consent version",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
