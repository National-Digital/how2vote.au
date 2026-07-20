#!/usr/bin/env node
/**
 * @fileoverview Generate the resolved privacy-claims projection the privacy policy page renders from
 * — the privacy policy is generated only from tested, currently-substantiated controls.
 *
 * The register (docs/privacy/claims.json) maps each user-facing privacy claim to the control that
 * substantiates it, the CI test IDs that prove it, the external-evidence IDs, an approver + expiry, and
 * a FALLBACK wording. This generator resolves each claim to its EFFECTIVE wording and writes the
 * one-per-claim projection to apps/web/src/lib/privacy/privacy-claims.generated.json, which the privacy
 * policy page imports and renders. A claim shows its SUBSTANTIATED wording only while it is BACKED AND
 * CURRENT:
 *   - its approval is unexpired, AND
 *   - every test id it references is `passing` in the control register (docs/legal/control-register.json), AND
 *   - none of the external evidence it references is `expired` (pending is allowed — that keeps the
 *     issue partial but does not force the fallback; an EXPIRED approval or evidence does).
 * Otherwise it FAILS CLOSED to the hedged fallback wording, so the page can never show a claim that is
 * not currently substantiated.
 *
 * `--write` regenerates the file; `--check` (default, run in CI) fails if the committed file has
 * drifted from what the register + control register would produce — the same drift-gate pattern as
 * generate-vendor-allowlist.mjs / generate-security-md.mjs.
 *
 * The pure resolver/renderer is exported for unit tests; the fs/CLI plumbing only runs when executed
 * directly.
 *
 * Usage:
 *   node scripts/generate-privacy-claims.mjs            # check (fail on drift)
 *   node scripts/generate-privacy-claims.mjs --write    # regenerate from the registers
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Parse an ISO-8601 date (YYYY-MM-DD or full timestamp) to epoch ms, or null.
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Build the test-status and evidence-status lookups from the control register.
 * @param {any} controlRegister
 * @returns {{ testStatus: Map<string, string>, evidenceStatus: Map<string, string> }}
 */
export function indexControlRegister(controlRegister) {
  const testStatus = new Map();
  const evidenceStatus = new Map();
  const controls = Array.isArray(controlRegister?.controls) ? controlRegister.controls : [];
  for (const c of controls) {
    for (const t of Array.isArray(c?.tests) ? c.tests : []) {
      if (isNonEmptyString(t?.id)) testStatus.set(t.id, t.status);
    }
    for (const e of Array.isArray(c?.evidence) ? c.evidence : []) {
      if (isNonEmptyString(e?.id)) {
        // Prefer the "worst" status if an evidence id appears on multiple controls: expired wins.
        const prev = evidenceStatus.get(e.id);
        if (prev !== "expired") evidenceStatus.set(e.id, e.status);
      }
    }
  }
  return { testStatus, evidenceStatus };
}

/**
 * Resolve one claim to its effective wording (fail-closed to the fallback).
 * @param {any} claim
 * @param {{ now: number, testStatus: Map<string,string>, evidenceStatus: Map<string,string> }} ctx
 * @returns {{ id: string, wording: string, backed: boolean }}
 */
export function resolveClaim(claim, ctx) {
  const expires = parseIsoDate(claim?.expiresAt);
  const approvalCurrent =
    isNonEmptyString(claim?.approver) && expires !== null && expires >= ctx.now;
  const tests = Array.isArray(claim?.tests) ? claim.tests : [];
  const testsPassing = tests.length > 0 && tests.every((t) => ctx.testStatus.get(t) === "passing");
  const evidence = Array.isArray(claim?.evidence) ? claim.evidence : [];
  const noExpiredEvidence = evidence.every((e) => ctx.evidenceStatus.get(e) !== "expired");
  const backed = approvalCurrent && testsPassing && noExpiredEvidence;
  const wording = backed ? claim?.substantiatedWording : claim?.fallbackWording;
  return { id: String(claim?.id ?? ""), wording: String(wording ?? ""), backed };
}

/**
 * Render the resolved projection object. Deterministic: claims sorted by id, no timestamps in output.
 * @param {any} register parsed docs/privacy/claims.json
 * @param {any} controlRegister parsed docs/legal/control-register.json
 * @param {{ now?: number }} [options]
 */
export function renderRegistry(register, controlRegister, options = {}) {
  const now = options.now ?? Date.now();
  const { testStatus, evidenceStatus } = indexControlRegister(controlRegister);
  const claims = (Array.isArray(register?.claims) ? register.claims : [])
    .map((c) => resolveClaim(c, { now, testStatus, evidenceStatus }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  return {
    generated: "DO NOT EDIT — generated by scripts/generate-privacy-claims.mjs.",
    source: "docs/privacy/claims.json",
    registryVersion: register?.schemaVersion ?? null,
    claims,
  };
}

/** The committed file text for a rendered projection (trailing newline, 2-space indent). */
export function serialise(projection) {
  return `${JSON.stringify(projection, null, 2)}\n`;
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const REGISTER = new URL("docs/privacy/claims.json", root);
const CONTROL_REGISTER = new URL("docs/legal/control-register.json", root);
const OUT = new URL("apps/web/src/lib/privacy/privacy-claims.generated.json", root);

function main() {
  const write = process.argv.includes("--write");
  let register, controlRegister, existing;
  try {
    register = JSON.parse(readFileSync(REGISTER, "utf8"));
    controlRegister = JSON.parse(readFileSync(CONTROL_REGISTER, "utf8"));
  } catch (err) {
    console.error(`::error::privacy-claims: cannot read inputs: ${err.message}`);
    process.exit(1);
    return;
  }
  const next = serialise(renderRegistry(register, controlRegister));
  if (write) {
    writeFileSync(OUT, next);
    console.info("privacy-claims.generated.json regenerated from the claims + control registers");
    return;
  }
  try {
    existing = readFileSync(OUT, "utf8");
  } catch {
    existing = "";
  }
  if (next !== existing) {
    console.error(
      "::error::privacy-claims: apps/web/src/lib/privacy/privacy-claims.generated.json is out of date — run `pnpm privacy:generate`",
    );
    process.exit(1);
    return;
  }
  console.info("privacy-claims.generated.json is in sync with the registers");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
