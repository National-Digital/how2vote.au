#!/usr/bin/env node
/**
 * @fileoverview CI guard: the postcode pages' boundary statement stays current.
 *
 * Postcode pages for an election fought on boundaries newer than the correspondence's edition state
 * that those boundaries were unchanged "as at" the scope's `checkedAt` date
 * (data/postcodes/source-record.json). This guard fails once that date is older than MAX_AGE_DAYS,
 * so the AEC redistributions page is re-checked and `checkedAt` (and `excludeStates`, if a state has
 * since been redrawn) updated before the statement goes stale.
 *
 * Usage: node scripts/check-postcode-staleness.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_AGE_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {any} record parsed data/postcodes/source-record.json
 * @param {number} now epoch milliseconds
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(record, now) {
  const errors = [];
  for (const scope of record?.elections ?? []) {
    if (scope.electionId === record.boundaryElection) continue;
    const at = scope.checkedAt;
    const ms = typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at) ? Date.parse(at) : NaN;
    if (Number.isNaN(ms)) {
      errors.push(`${scope.electionId}: checkedAt must be an ISO date, got ${JSON.stringify(at)}`);
      continue;
    }
    if (ms > now + DAY_MS) errors.push(`${scope.electionId}: checkedAt ${at} is in the future`);
    const age = Math.floor((now - ms) / DAY_MS);
    if (age > MAX_AGE_DAYS) {
      errors.push(
        `${scope.electionId}: boundaries last checked ${at} (${age} days ago, limit ${MAX_AGE_DAYS}). Re-check https://www.aec.gov.au/redistributions/, then update checkedAt and excludeStates in data/postcodes/source-record.json.`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing */
function main() {
  const record = JSON.parse(
    readFileSync(new URL("../data/postcodes/source-record.json", import.meta.url), "utf8"),
  );
  const result = verdict(record, Date.now());
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::postcode-staleness: ${e}`);
    process.exit(1);
  }
  console.info(`postcode boundaries OK — checked within ${MAX_AGE_DAYS} days`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
/* c8 ignore stop */
