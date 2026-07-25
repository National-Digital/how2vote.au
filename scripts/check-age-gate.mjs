#!/usr/bin/env node
/**
 * @fileoverview CI guard: the age-first eligibility gate is wired and privacy-safe
 * (docs/adr/0011).
 *
 * The runtime behaviour — the gate precedes any quiz state, the under-18 path is explore-only (it may
 * see the comparison but never build/print/share/save a how-to-vote card or join research; docs/adr/
 * 0016), and the eligibility answer never touches the network — is proven at the real surface by
 * apps/web/e2e/age-gate.spec.ts. This guard fails the build if the SOURCE could quietly stop
 * upholding the two static invariants that back it up:
 *
 *  (a) PAYLOAD ISOLATION — the research ingestion path (the survey screen, the survey module and the
 *      server-side research endpoints) never imports the age-gate module nor references the `ageGate`
 *      singleton, so the eligibility declaration can never be routed into a research payload. (The
 *      demographic "age group" survey field is a SEPARATE consented, aggregate-only value and is not
 *      what this checks — it is a plain string option, never the `ageGate` capability.)
 *
 *  (b) GATE MODULE — the age-gate store holds a yes/no eligibility bit only: it must NOT capture a
 *      date of birth / age band / numeric age, must NOT transmit anything (no fetch/beacon/endpoint),
 *      and must export the `ageGate` singleton the guard and UI depend on.
 *
 *  (c) GUARD WIRING — the root layout references `ageGate` and redirects to the "/start" gate, so the
 *      central fail-closed guard cannot be silently dropped.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing only runs when the
 * script is executed directly.
 *
 * Usage:
 *   node scripts/check-age-gate.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** An import of the age-gate module ("$lib/age", "$lib/age.svelte", "./age.svelte", …). */
const AGE_MODULE_IMPORT =
  /\bfrom\s+["'](?:\$lib\/age(?:\.svelte)?|(?:\.{1,2}\/)+age(?:\.svelte)?)["']/;
/** A reference to the age-gate singleton by name. */
const AGE_SINGLETON = /\bageGate\b/;

/**
 * (a) The research ingestion path must not import the gate or touch its singleton.
 * @param {{ path: string, text: string }[]} sources
 * @returns {string[]} errors
 */
export function verifyPayloadIsolation(sources) {
  const errors = [];
  for (const { path, text } of sources) {
    if (typeof text !== "string") continue;
    if (AGE_MODULE_IMPORT.test(text)) {
      errors.push(
        `${path}: imports the age-gate module — the eligibility declaration must never reach the research path`,
      );
    }
    if (AGE_SINGLETON.test(text)) {
      errors.push(
        `${path}: references the ageGate singleton — the eligibility answer must never enter a research payload`,
      );
    }
  }
  return errors;
}

/** Tokens that would mean the gate captured an actual age / date of birth rather than a yes/no bit. */
export const PROHIBITED_AGE_VALUE_RULES = [
  {
    label: "a date-of-birth field",
    re: /date[_-]?of[_-]?birth|\bdateOfBirth\b|\bbirth[_-]?date\b/i,
  },
  { label: "a birth-year field", re: /\bbirth[_-]?year\b|\bbirthYear\b|\byearOfBirth\b/i },
  { label: "a plain date-of-birth field", re: /\bdob\b/i },
  { label: "a numeric-age field", re: /\bageInYears\b|\bageValue\b|\bageNumber\b|\bexactAge\b/i },
];

/** Tokens that would mean the gate transmitted its answer. */
export const PROHIBITED_TRANSMISSION_RULES = [
  { label: "a network fetch", re: /\bfetch\s*\(/ },
  { label: "an XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { label: "a sendBeacon call", re: /\bsendBeacon\b/ },
  { label: "an API endpoint", re: /["'`]\/api\// },
];

/**
 * (b) The gate module holds an eligibility bit only: no age value, no transmission, exports ageGate.
 * @param {{ path: string, text: string } | null | undefined} module
 * @returns {string[]} errors
 */
export function verifyGateModule(module) {
  if (!module || typeof module.text !== "string") {
    return ["age-gate module: could not read the age-gate store (fail closed)"];
  }
  const errors = [];
  const { path, text } = module;
  for (const { label, re } of PROHIBITED_AGE_VALUE_RULES) {
    if (re.test(text)) {
      errors.push(
        `${path}: contains ${label} — the gate stores a self-declared eligibility bit only, never an age or date of birth`,
      );
    }
  }
  for (const { label, re } of PROHIBITED_TRANSMISSION_RULES) {
    if (re.test(text)) {
      errors.push(`${path}: contains ${label} — the eligibility answer must never be transmitted`);
    }
  }
  if (!/export\s+const\s+ageGate\b/.test(text)) {
    errors.push(`${path}: must export the ageGate singleton the guard and UI depend on`);
  }
  return errors;
}

/**
 * (c) The root layout wires the fail-closed guard: it references ageGate and redirects to /start.
 * @param {{ path: string, text: string } | null | undefined} layout
 * @returns {string[]} errors
 */
export function verifyGuardWiring(layout) {
  if (!layout || typeof layout.text !== "string") {
    return ["age-gate guard: could not read the root layout (fail closed)"];
  }
  const errors = [];
  const { path, text } = layout;
  if (!AGE_SINGLETON.test(text)) {
    errors.push(
      `${path}: does not reference the ageGate guard — the age-first gate must be enforced in the root layout`,
    );
  }
  if (!/["']\/start["']/.test(text)) {
    errors.push(
      `${path}: does not redirect to the "/start" gate — gated routes must fail closed to the age gate`,
    );
  }
  return errors;
}

/**
 * Combine every applicable section into one verdict.
 * @param {{ payloadSources?: {path:string,text:string}[], gateModule?: {path:string,text:string}, guardSource?: {path:string,text:string} }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  if (input.payloadSources) errors.push(...verifyPayloadIsolation(input.payloadSources));
  if (input.gateModule !== undefined) errors.push(...verifyGateModule(input.gateModule));
  if (input.guardSource !== undefined) errors.push(...verifyGuardWiring(input.guardSource));
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- fs/CLI plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const PAYLOAD_FILES = [
  "apps/web/src/routes/survey/+page.svelte",
  "apps/web/src/lib/survey.ts",
  // The question set + option allowlists moved here (leaf module the ingestion Function imports
  // directly); it sits on the payload path, so it must stay isolated from the age gate too.
  "apps/web/src/lib/survey-questions.ts",
  "apps/web/functions/api/research.ts",
  "apps/web/functions/api/research/geography.ts",
];
const GATE_MODULE = "apps/web/src/lib/age.svelte.ts";
const LAYOUT = "apps/web/src/routes/+layout.svelte";

function read(rel) {
  return { path: rel, text: readFileSync(new URL(rel, ROOT), "utf8") };
}

function main() {
  /** @type {Parameters<typeof verdict>[0]} */
  let input;
  try {
    input = {
      payloadSources: PAYLOAD_FILES.map(read),
      gateModule: read(GATE_MODULE),
      guardSource: read(LAYOUT),
    };
  } catch (err) {
    console.error(`::error::age-gate: cannot read a required source file: ${err.message}`);
    process.exit(1);
  }

  const result = verdict(input);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::age-gate: ${e}`);
    console.error(`age-gate: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    "age-gate OK — the research path is isolated from the gate, the gate stores an eligibility bit only, and the layout enforces it",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
