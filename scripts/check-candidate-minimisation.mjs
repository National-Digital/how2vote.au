#!/usr/bin/env node
/**
 * @fileoverview CI guard: candidate data is MINIMISED — no personal contact / home address / date
 * of birth or other non-ballot personal data may ever appear in candidate records.
 *
 * A candidate record is the AEC-declared ballot line and nothing more: state, candidate name (as
 * printed), party (as printed), ballot position, and the division (House) or group (Senate). The
 * data-schema already rejects unknown keys (`.strict()`), but that is a build-time compile check on
 * the compiled dataset. This guard is the independent, data-side minimisation control: it scans the
 * raw committed ballots.json for EVERY election and fails closed if a candidate object
 *   - carries any key outside the strict allowlist, or
 *   - carries any key whose name looks like personal data (address / DOB / phone / email / …), or
 *   - has a string value that looks like an email address or a phone number.
 *
 * Belt-and-braces by design: even if someone widened the schema, this guard still fails — so home
 * addresses, dates of birth and contact details can never be introduced into candidate data.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-candidate-minimisation.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The ONLY keys a ballot candidate record may carry (ballot data, no personal data). */
const HOUSE_KEYS = new Set(["state", "candidate", "party", "position", "division"]);
const SENATE_KEYS = new Set(["state", "candidate", "party", "position", "group"]);

/** Key-name fragments that signal minimisation-violating personal data. Substring, case-folded. */
const FORBIDDEN_KEY_FRAGMENTS = [
  "address",
  "street",
  "suburb",
  "postcode",
  "postal",
  "dob",
  "birth",
  "age",
  "phone",
  "mobile",
  "telephone",
  "email",
  "contact",
  "gender",
  "medicare",
  "passport",
  "licence",
  "license",
  "tfn",
  "ssn",
  "occupation",
  "residential",
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// A run of 8+ digits (optionally spaced/grouped) — a phone/identifier shape that has no place in a
// ballot line. The only numeric field is `position`, which is checked as a number, never a string.
const PHONE_RE = /(?:\d[\s-]?){8,}/;

/** @param {unknown} v */
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @param {{ electionId: string, ballots: unknown }[]} entries
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(entries) {
  const errors = [];
  const push = (m) => errors.push(m);

  for (const { electionId, ballots } of entries) {
    const at = `ballots (${electionId})`;
    if (!isObject(ballots)) {
      push(`${at}: not a JSON object`);
      continue;
    }
    for (const [chamber, allowed] of [
      ["house", HOUSE_KEYS],
      ["senate", SENATE_KEYS],
    ]) {
      const rows = ballots[chamber];
      if (!Array.isArray(rows)) {
        push(`${at}: ${chamber} must be an array`);
        continue;
      }
      for (const [i, c] of rows.entries()) {
        const cat = `${at} ${chamber}[${i}]`;
        if (!isObject(c)) {
          push(`${cat}: not an object`);
          continue;
        }
        for (const key of Object.keys(c)) {
          const folded = key.toLowerCase();
          if (!allowed.has(key)) {
            push(
              `${cat}: unexpected field "${key}" (ballot records are minimised; not on allowlist)`,
            );
          }
          for (const frag of FORBIDDEN_KEY_FRAGMENTS) {
            if (folded.includes(frag)) {
              push(`${cat}: forbidden personal-data field "${key}" (matches "${frag}")`);
              break;
            }
          }
          const value = c[key];
          if (typeof value === "string") {
            if (EMAIL_RE.test(value)) push(`${cat}: field "${key}" looks like an email address`);
            if (PHONE_RE.test(value)) push(`${cat}: field "${key}" looks like a phone number`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ELECTIONS = ["2019", "2022", "2025"];

function loadEntry(electionId) {
  const root = new URL("../", import.meta.url);
  const ballots = JSON.parse(
    readFileSync(new URL(`data/source/${electionId}/ballots.json`, root), "utf8"),
  );
  return { electionId, ballots };
}

function main() {
  let entries;
  try {
    entries = ELECTIONS.map(loadEntry);
  } catch (err) {
    console.error(`::error::candidate-minimisation: cannot read a ballots file: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict(entries);
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::candidate-minimisation: ${e}`);
    console.error(`candidate minimisation: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const total = entries.reduce(
    (n, e) => n + (e.ballots.house?.length ?? 0) + (e.ballots.senate?.length ?? 0),
    0,
  );
  console.info(
    `candidate minimisation OK — ${entries.length} elections, ${total} candidate records, no personal-data fields`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
