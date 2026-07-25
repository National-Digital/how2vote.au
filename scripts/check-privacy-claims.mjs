#!/usr/bin/env node
/**
 * @fileoverview CI guard: the privacy claims register + the de-identification register are structurally
 * complete and fail-closed, the privacy policy page renders its commitments from the generated
 * projection, and no lapsed claim's strong wording is hard-coded on the page.
 *
 * This guard proves (all fail-closed):
 *   1. CLAIMS REGISTER (docs/privacy/claims.json) — well-formed: every claim has an id, a
 *      substantiated wording, a FALLBACK wording, a substantiating control, at least one test id, an
 *      evidence array, an approver and a valid FUTURE expiry (an expired approval fails).
 *   2. NO ORPHAN REFERENCES — every test id a claim cites exists in the control register, and every
 *      evidence id a claim cites exists on control-21 or control-22 (the owning controls).
 *   3. DE-IDENTIFICATION REGISTER (docs/privacy/deidentification.json) — well-formed and BOUND to the
 *      deployed system: boundSchemaVersion == RESEARCH_SCHEMA_VERSION, kThreshold == MIN_CELL, the
 *      demographics field's sensitiveDimensions == SENSITIVE_DIMENSIONS, every field/coreControl is
 *      well-formed (coreControls cite existing tests), and its approval is current.
 *   4. PAGE WIRING + ANTI-OVERCLAIM — the privacy policy page imports and renders the generated
 *      projection (so a claim can never appear unless it is the current EFFECTIVE wording), and the
 *      SUBSTANTIATED wording of any claim that currently resolves to its fallback (unbacked) does not
 *      appear verbatim in the page source (it must not be hard-coded around the generated block).
 *
 * The claim RESOLUTION (backed → substantiated, else fallback) and the drift-gate on the generated
 * projection live in scripts/generate-privacy-claims.mjs; this guard imports the pure resolver so the
 * two never diverge.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing only runs when the
 * script is executed directly.
 *
 * Usage:
 *   node scripts/check-privacy-claims.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { indexControlRegister, parseIsoDate, resolveClaim } from "./generate-privacy-claims.mjs";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** The two controls that own the privacy-claims + transport evidence. */
const OWNING_CONTROLS = ["control-21", "control-22"];

/**
 * Strip comments from source so only user-facing copy / real imports are scanned.
 * @param {string} text
 */
export function stripComments(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * @param {{
 *   claimsRegister?: unknown,
 *   deidRegister?: unknown,
 *   controlRegister?: unknown,
 *   privacyPageText?: string,
 *   schemaVersion?: number | null,
 *   minCell?: number | null,
 *   sensitiveDimensions?: string[] | null,
 *   now?: number,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const now = input.now ?? Date.now();

  // ── Control-register indexes (for orphan-reference checks). ──────────────────────────────────
  const controlRegister = input.controlRegister;
  const { testStatus, evidenceStatus } = indexControlRegister(controlRegister ?? {});
  const evidenceOnOwning = new Set();
  for (const c of Array.isArray(controlRegister?.controls) ? controlRegister.controls : []) {
    if (!OWNING_CONTROLS.includes(c?.id)) continue;
    for (const e of Array.isArray(c?.evidence) ? c.evidence : []) {
      if (isNonEmptyString(e?.id)) evidenceOnOwning.add(e.id);
    }
  }

  const checkApproval = (at, rec) => {
    if (!isNonEmptyString(rec?.approver)) push(`${at}: missing approver`);
    const approved = parseIsoDate(rec?.approvedAt);
    const expires = parseIsoDate(rec?.expiresAt);
    if (approved === null) push(`${at}: missing/invalid approvedAt`);
    if (expires === null) push(`${at}: missing/invalid expiresAt`);
    else if (expires < now) push(`${at}: approval expired at ${rec.expiresAt} (fail-closed)`);
  };

  // ── 1 + 2 — claims register. ────────────────────────────────────────────────────────────────
  const register = input.claimsRegister;
  const unbackedSubstantiated = [];
  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    push("claims register: not a JSON object");
  } else {
    if (register.schemaVersion !== 1) {
      push(
        `claims register.schemaVersion: expected 1, got ${JSON.stringify(register.schemaVersion)}`,
      );
    }
    const claims = Array.isArray(register.claims) ? register.claims : null;
    if (claims === null) push("claims register.claims: not an array");
    else if (claims.length === 0) push("claims register.claims: at least one claim is required");
    else {
      const ids = new Map();
      for (const [i, c] of claims.entries()) {
        const at = `claim[${i}]${c && c.id ? ` (${c.id})` : ""}`;
        if (!c || typeof c !== "object") {
          push(`${at}: not an object`);
          continue;
        }
        if (!isNonEmptyString(c.id)) push(`${at}: missing id`);
        else ids.set(c.id, (ids.get(c.id) ?? 0) + 1);
        if (!isNonEmptyString(c.substantiatedWording)) push(`${at}: missing substantiatedWording`);
        if (!isNonEmptyString(c.fallbackWording)) push(`${at}: missing fallbackWording`);
        if (!isNonEmptyString(c.substantiatingControl))
          push(`${at}: missing substantiatingControl`);
        const tests = Array.isArray(c.tests) ? c.tests : null;
        if (tests === null || tests.length === 0) push(`${at}: needs at least one test id`);
        else {
          for (const t of tests) {
            if (!testStatus.has(t)) {
              push(`${at}: references test "${t}" not present in the control register (orphan)`);
            }
          }
        }
        const evidence = Array.isArray(c.evidence) ? c.evidence : null;
        if (evidence === null) push(`${at}: evidence must be an array`);
        else {
          for (const e of evidence) {
            if (!evidenceOnOwning.has(e)) {
              push(
                `${at}: references evidence "${e}" not present on ${OWNING_CONTROLS.join(" or ")} (orphan)`,
              );
            }
          }
        }
        checkApproval(at, c);

        // Resolution for anti-overclaim: which claims currently fall back to their hedged wording.
        const resolved = resolveClaim(c, { now, testStatus, evidenceStatus });
        if (!resolved.backed && isNonEmptyString(c.substantiatedWording)) {
          unbackedSubstantiated.push({ id: c.id, wording: c.substantiatedWording });
        }
      }
      for (const [id, n] of ids) if (n > 1) push(`claim ${id}: declared ${n} times`);
    }
  }

  // ── 3 — de-identification register. ─────────────────────────────────────────────────────────
  const deid = input.deidRegister;
  if (typeof deid !== "object" || deid === null || Array.isArray(deid)) {
    push("de-identification register: not a JSON object");
  } else {
    if (deid.schemaVersion !== 1) push("de-identification register.schemaVersion: expected 1");
    if (
      typeof input.schemaVersion === "number" &&
      deid.boundSchemaVersion !== input.schemaVersion
    ) {
      push(
        `de-identification register.boundSchemaVersion ${JSON.stringify(deid.boundSchemaVersion)} ` +
          `!= RESEARCH_SCHEMA_VERSION ${input.schemaVersion} (re-assess on a schema change)`,
      );
    }
    if (typeof input.minCell === "number" && deid.kThreshold !== input.minCell) {
      push(
        `de-identification register.kThreshold ${JSON.stringify(deid.kThreshold)} != MIN_CELL ${input.minCell}`,
      );
    }
    const fields = Array.isArray(deid.fields) ? deid.fields : null;
    if (fields === null || fields.length === 0)
      push("de-identification register.fields: non-empty array required");
    else {
      for (const [i, f] of fields.entries()) {
        const at = `de-id field[${i}]${f && f.name ? ` (${f.name})` : ""}`;
        if (!isNonEmptyString(f?.name)) push(`${at}: missing name`);
        if (typeof f?.collected !== "boolean") push(`${at}: missing collected (boolean)`);
        if (!isNonEmptyString(f?.aggregation)) push(`${at}: missing aggregation`);
        if (!isNonEmptyString(f?.geographyScope)) push(`${at}: missing geographyScope`);
      }
      // The demographics field's sensitive-dimension list must equal survey.ts SENSITIVE_DIMENSIONS.
      const demo = fields.find((f) => f?.name === "demographics");
      if (Array.isArray(input.sensitiveDimensions)) {
        const declared = Array.isArray(demo?.sensitiveDimensions) ? demo.sensitiveDimensions : [];
        const want = [...input.sensitiveDimensions].sort();
        const got = [...declared].sort();
        if (JSON.stringify(want) !== JSON.stringify(got)) {
          push(
            "de-identification register: demographics.sensitiveDimensions != survey.ts SENSITIVE_DIMENSIONS " +
              `(want ${want.join(",")}; got ${got.join(",")})`,
          );
        }
      }
    }
    const coreControls = Array.isArray(deid.coreControls) ? deid.coreControls : [];
    if (coreControls.length === 0)
      push("de-identification register.coreControls: non-empty array required");
    for (const [i, cc] of coreControls.entries()) {
      const at = `de-id coreControl[${i}]${cc && cc.id ? ` (${cc.id})` : ""}`;
      if (!isNonEmptyString(cc?.id)) push(`${at}: missing id`);
      for (const t of Array.isArray(cc?.enforcedBy) ? cc.enforcedBy : []) {
        if (!testStatus.has(t))
          push(`${at}: enforcedBy test "${t}" not in the control register (orphan)`);
      }
    }
    if (!Array.isArray(deid.evidence))
      push("de-identification register.evidence: must be an array");
    checkApproval("de-identification register", deid);
  }

  // ── 4 — page wiring + anti-overclaim. ───────────────────────────────────────────────────────
  const pageRaw = typeof input.privacyPageText === "string" ? input.privacyPageText : "";
  const page = stripComments(pageRaw);
  if (!page.includes("privacy-claims.generated.json")) {
    push("privacy page: does not import the generated privacy-claims projection (wiring)");
  }
  if (!/#each\s+commitments\b/.test(page)) {
    push("privacy page: does not render the generated commitments (#each commitments)");
  }
  for (const { id, wording } of unbackedSubstantiated) {
    if (page.includes(wording)) {
      push(
        `privacy page: substantiated wording of the currently-UNBACKED claim ${id} is hard-coded on ` +
          `the page — it must fail closed to the fallback (overclaim)`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);
const safeRead = (p) => {
  try {
    return readFileSync(rel(p), "utf8");
  } catch {
    return "";
  }
};

/** Read a numeric/string const out of a TS source without importing it (see neutrality guard). */
function readConst(src, name) {
  const m = new RegExp(`${name}\\s*=\\s*([0-9]+|["'][^"']+["'])`).exec(src);
  if (!m) return null;
  const raw = m[1];
  return /^["']/.test(raw) ? raw.slice(1, -1) : Number(raw);
}

/** Extract SENSITIVE_DIMENSIONS set members from survey.ts. */
function readSensitiveDimensions(src) {
  const m = /SENSITIVE_DIMENSIONS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

function main() {
  let claimsRegister, deidRegister, controlRegister;
  try {
    claimsRegister = JSON.parse(safeRead("docs/privacy/claims.json"));
    deidRegister = JSON.parse(safeRead("docs/privacy/deidentification.json"));
    controlRegister = JSON.parse(safeRead("docs/legal/control-register.json"));
  } catch (err) {
    console.error(`::error::privacy-claims: cannot read a register: ${err.message}`);
    process.exit(1);
    return;
  }
  const consentSrc = safeRead("apps/web/src/lib/research/consent.ts");
  const statsSrc = safeRead("packages/data-pipeline/src/stats.ts");
  // SENSITIVE_DIMENSIONS is defined in the survey-questions leaf (survey.ts only re-exports it) —
  // read the definition site, otherwise this binding silently no-ops.
  const surveySrc = safeRead("apps/web/src/lib/survey-questions.ts");

  const result = verdict({
    claimsRegister,
    deidRegister,
    controlRegister,
    privacyPageText: safeRead("apps/web/src/routes/privacy/+page.svelte"),
    schemaVersion: readConst(consentSrc, "RESEARCH_SCHEMA_VERSION"),
    minCell: readConst(statsSrc, "MIN_CELL"),
    sensitiveDimensions: readSensitiveDimensions(surveySrc),
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::privacy-claims: ${e}`);
    console.error(`privacy claims: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    "privacy claims OK — claims + de-identification registers bound, page renders the projection",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
