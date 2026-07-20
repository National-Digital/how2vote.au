#!/usr/bin/env node
/**
 * @fileoverview CI guard: the legal control register is structurally complete and
 * fail-closed.
 *
 * The register (docs/legal/control-register.json) is the single machine-readable
 * map from every legal requirement to its CI test IDs and external-evidence IDs.
 * This guard proves:
 *   - every one of the 31 controls is present exactly once (no orphan requirement);
 *   - every control maps to at least one CI group from the canonical six;
 *   - every test has a non-empty owner (no ownerless test);
 *   - evidence records are well-formed, and any evidence marked "current" carries a
 *     reviewer + approval date + a future expiry (stale/expired evidence fails); an optional
 *     secondReviewer (joint sign-off) must be a distinct, non-empty reviewer;
 *   - the ratchet: once a control is "implemented" or "verified", ALL its tests must
 *     be passing and ALL its evidence current/not-required — otherwise the build fails.
 *
 * Controls still being built sit at planned / in-progress / partial with planned
 * tests and pending evidence; that is allowed and keeps the gate green until a
 * control claims completion, at which point the evidence must actually exist.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing
 * only runs when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-control-register.mjs
 *   node scripts/check-control-register.mjs --group "Privacy and Research"
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CANONICAL_GROUPS = [
  "Legal",
  "Data",
  "Privacy and Research",
  "Code and Supply Chain",
  "Accessibility and Product",
  "Infrastructure and Operations",
];

const CONTROL_STATUS = ["planned", "in-progress", "partial", "implemented", "verified"];
const TEST_STATUS = ["planned", "failing", "passing"];
const EVIDENCE_STATUS = ["pending", "current", "expired", "not-required"];
const COMPLETE_STATUS = ["implemented", "verified"];
const EXPECTED_COUNT = 31;

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v */
const isInteger = (v) => typeof v === "number" && Number.isInteger(v);

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
 * Validate a parsed control register.
 *
 * @param {unknown} register  parsed docs/legal/control-register.json
 * @param {{ now?: number, group?: string }} [options]
 * @returns {{ ok: boolean, errors: string[], group: string | null }}
 */
export function verdict(register, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const group = options.group ?? null;
  const push = (msg) => errors.push(msg);

  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    return { ok: false, errors: ["register: not a JSON object"], group };
  }
  if (register.schemaVersion !== 1) {
    push(`schemaVersion: expected 1, got ${JSON.stringify(register.schemaVersion)}`);
  }

  // Canonical CI groups, compared as a set.
  const declaredGroups = Array.isArray(register.ciGroups) ? register.ciGroups : [];
  for (const g of CANONICAL_GROUPS) {
    if (!declaredGroups.includes(g)) push(`ciGroups: missing canonical group "${g}"`);
  }
  for (const g of declaredGroups) {
    if (!CANONICAL_GROUPS.includes(g)) push(`ciGroups: unknown group "${g}"`);
  }

  const controls = Array.isArray(register.controls) ? register.controls : null;
  if (controls === null) {
    push("controls: not an array");
    return { ok: false, errors, group };
  }

  // Coverage: exactly control-1 .. control-31, each once.
  const seen = new Map();
  for (const c of controls) {
    const id = c && typeof c === "object" ? c.id : undefined;
    if (!isNonEmptyString(id)) {
      push("control: missing id");
      continue;
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, n] of seen) {
    if (n > 1) push(`control ${id}: declared ${n} times`);
  }
  for (let i = 1; i <= EXPECTED_COUNT; i++) {
    if (!seen.has(`control-${i}`))
      push(`coverage: missing control control-${i} (orphan legal requirement)`);
  }
  for (const id of seen.keys()) {
    const m = /^control-(\d+)$/.exec(id);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > EXPECTED_COUNT) {
      push(`control ${id}: unexpected id (must be control-1..control-${EXPECTED_COUNT})`);
    }
  }

  for (const c of controls) {
    if (!c || typeof c !== "object" || !isNonEmptyString(c.id)) continue;
    const at = `control ${c.id}`;

    if (!isNonEmptyString(c.title)) push(`${at}: missing title`);
    if (!isInteger(c.inherent) || c.inherent < 0 || c.inherent > 25) {
      push(`${at}: inherent must be an integer 0..25`);
    }
    if (!isInteger(c.targetResidual) || c.targetResidual < 0 || c.targetResidual > 25) {
      push(`${at}: targetResidual must be an integer 0..25`);
    }
    if (!CONTROL_STATUS.includes(c.status)) {
      push(`${at}: status must be one of ${CONTROL_STATUS.join(", ")}`);
    }

    const groups = Array.isArray(c.ciGroups) ? c.ciGroups : [];
    if (groups.length === 0) push(`${at}: must map to at least one CI group`);
    for (const g of groups) {
      if (!CANONICAL_GROUPS.includes(g)) push(`${at}: unknown ciGroup "${g}"`);
    }

    const tests = Array.isArray(c.tests) ? c.tests : [];
    if (tests.length === 0) push(`${at}: must have at least one test`);
    for (const [i, t] of tests.entries()) {
      const tat = `${at} test[${i}]`;
      if (!t || typeof t !== "object") {
        push(`${tat}: not an object`);
        continue;
      }
      if (!isNonEmptyString(t.id)) push(`${tat}: missing id`);
      if (!isNonEmptyString(t.owner)) push(`${tat}: missing owner (no test without an owner)`);
      if (!isNonEmptyString(t.type)) push(`${tat}: missing type`);
      if (!TEST_STATUS.includes(t.status))
        push(`${tat}: status must be one of ${TEST_STATUS.join(", ")}`);
    }

    const evidence = Array.isArray(c.evidence) ? c.evidence : null;
    if (evidence === null) {
      push(`${at}: evidence must be an array`);
    } else {
      for (const [i, e] of evidence.entries()) {
        const eat = `${at} evidence[${i}]`;
        if (!e || typeof e !== "object") {
          push(`${eat}: not an object`);
          continue;
        }
        if (!isNonEmptyString(e.id)) push(`${eat}: missing id`);
        if (!isNonEmptyString(e.description)) push(`${eat}: missing description`);
        if (!EVIDENCE_STATUS.includes(e.status)) {
          push(`${eat}: status must be one of ${EVIDENCE_STATUS.join(", ")}`);
        }
        if (e.status === "expired") {
          push(`${eat}: evidence is expired and must be renewed (fail-closed)`);
        }
        if (e.status === "current") {
          if (!isNonEmptyString(e.reviewer)) push(`${eat}: current evidence needs a reviewer`);
          // Optional joint sign-off: a secondReviewer, when present, must be a real (non-empty)
          // reviewer distinct from the first — a typo'd or duplicated co-signer fails closed.
          if (e.secondReviewer !== undefined) {
            if (!isNonEmptyString(e.secondReviewer)) {
              push(`${eat}: secondReviewer must be a non-empty string when present`);
            } else if (
              isNonEmptyString(e.reviewer) &&
              e.secondReviewer.trim() === e.reviewer.trim()
            ) {
              push(`${eat}: secondReviewer must differ from reviewer`);
            }
          }
          const approved = parseIsoDate(e.approvedAt);
          const expires = parseIsoDate(e.expiresAt);
          if (approved === null) push(`${eat}: current evidence needs a valid approvedAt`);
          if (expires === null) push(`${eat}: current evidence needs a valid expiresAt`);
          else if (expires < now)
            push(`${eat}: current evidence expired at ${e.expiresAt} (fail-closed)`);
        }
      }
    }

    // Ratchet: a completed control cannot ride on planned tests or missing evidence.
    if (COMPLETE_STATUS.includes(c.status)) {
      for (const [i, t] of tests.entries()) {
        if (t && t.status !== "passing") {
          push(
            `${at}: status "${c.status}" requires all tests passing, but test[${i}] is "${t.status}"`,
          );
        }
      }
      for (const [i, e] of (evidence ?? []).entries()) {
        if (e && e.status !== "current" && e.status !== "not-required") {
          push(
            `${at}: status "${c.status}" requires all evidence current, but evidence[${i}] is "${e.status}"`,
          );
        }
      }
    }
  }

  // Group scoping: assert the requested group exists and owns at least one control.
  if (group !== null) {
    if (!CANONICAL_GROUPS.includes(group)) {
      push(`--group "${group}" is not one of the canonical groups`);
    } else {
      const owned = controls.filter(
        (c) => c && Array.isArray(c.ciGroups) && c.ciGroups.includes(group),
      );
      if (owned.length === 0) push(`--group "${group}": no controls mapped to this group`);
    }
  }

  return { ok: errors.length === 0, errors, group };
}

/* c8 ignore start -- CLI plumbing, exercised via CI not unit tests */
function parseArgs(argv) {
  const out = { group: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--group") out.group = argv[++i];
  }
  return out;
}

const REGISTER_PATH = new URL("../docs/legal/control-register.json", import.meta.url);

function main() {
  const { group } = parseArgs(process.argv.slice(2));
  let register;
  try {
    register = JSON.parse(readFileSync(REGISTER_PATH, "utf8"));
  } catch (err) {
    console.error(`::error::cannot read control register: ${err.message}`);
    process.exit(1);
  }
  const result = verdict(register, { group });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::control-register: ${e}`);
    console.error(
      `control register: ${result.errors.length} problem(s)${group ? ` (group "${group}")` : ""}`,
    );
    process.exit(1);
  }
  const controls = register.controls ?? [];
  if (group) {
    const owned = controls.filter((c) => c.ciGroups?.includes(group));
    console.info(`control register OK — group "${group}": ${owned.length} control(s)`);
  } else {
    console.info(
      `control register OK — ${controls.length} controls, ${CANONICAL_GROUPS.length} CI groups`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
