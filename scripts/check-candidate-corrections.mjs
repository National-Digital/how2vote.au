#!/usr/bin/env node
/**
 * @fileoverview CI guard: the correction / right-of-reply suspension list is well-formed and every
 * entry refers to a real party.
 *
 * data/corrections/suspensions.json is the data-driven lever the runtime reads to SUSPEND showing a
 * party's alignment while a correction / right of reply is assessed (apps/web card via
 * $lib/corrections). Because a flag silently withholds a figure, the list must be trustworthy: this
 * guard proves each entry names a valid election and a partyKey that actually EXISTS in that
 * election's party registry (parties.json), so a typo can never quietly fail to suspend the intended
 * party — and carries a reason + flag date (auditability). An empty list is valid (nothing flagged).
 *
 * This is the simple mechanism ahead of the fuller governance control plane; it composes
 * with the global EXPORTS_ENABLED kill switch and the withdrawn-question mechanism (ADR 0005).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-candidate-corrections.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v — strict ISO date/datetime (mirrors the other guards). */
const isIsoDate = (v) =>
  isNonEmptyString(v) &&
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) &&
  !Number.isNaN(Date.parse(v));

/**
 * @param {{ suspensions: unknown, partyKeysByElection: Record<string, string[]> }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);
  const { suspensions: s, partyKeysByElection } = input;

  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    return { ok: false, errors: ["suspensions: not a JSON object"] };
  }
  if (s.schemaVersion !== 1) push("suspensions: schemaVersion must be 1");

  const list = s.suspensions;
  if (!Array.isArray(list)) {
    push("suspensions: `suspensions` must be an array");
    return { ok: errors.length === 0, errors };
  }

  for (const [i, e] of list.entries()) {
    const at = `suspensions[${i}]`;
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      push(`${at}: not an object`);
      continue;
    }
    if (!isNonEmptyString(e.electionId)) push(`${at}: missing electionId`);
    else if (!(e.electionId in partyKeysByElection)) {
      push(`${at}: unknown electionId "${e.electionId}"`);
    }
    if (!isNonEmptyString(e.partyKey)) push(`${at}: missing partyKey`);
    else if (
      isNonEmptyString(e.electionId) &&
      e.electionId in partyKeysByElection &&
      !partyKeysByElection[e.electionId].includes(e.partyKey)
    ) {
      // A suspension that points at a non-existent key would silently fail to suspend anything.
      push(
        `${at}: partyKey "${e.partyKey}" does not exist in the ${e.electionId} party registry — the suspension would have no effect`,
      );
    }
    if (!isNonEmptyString(e.reason)) push(`${at}: missing reason`);
    if (!isIsoDate(e.flaggedAt)) push(`${at}: flaggedAt must be an ISO date`);
    if (e.scope !== undefined && !isNonEmptyString(e.scope)) {
      push(`${at}: scope must be a non-empty string when present`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ELECTIONS = ["2019", "2022", "2025"];

function loadPartyKeys() {
  const root = new URL("../", import.meta.url);
  /** @type {Record<string, string[]>} */
  const map = {};
  for (const id of ELECTIONS) {
    const parties = JSON.parse(
      readFileSync(new URL(`data/source/${id}/parties.json`, root), "utf8"),
    );
    map[id] = (parties.parties ?? []).map((p) => p.key);
  }
  return map;
}

function main() {
  const root = new URL("../", import.meta.url);
  let suspensions;
  let partyKeysByElection;
  try {
    suspensions = JSON.parse(
      readFileSync(new URL("data/corrections/suspensions.json", root), "utf8"),
    );
    partyKeysByElection = loadPartyKeys();
  } catch (err) {
    console.error(`::error::candidate-corrections: cannot read a record: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict({ suspensions, partyKeysByElection });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::candidate-corrections: ${e}`);
    console.error(`candidate corrections: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const n = suspensions.suspensions?.length ?? 0;
  console.info(
    `candidate corrections OK — suspension list well-formed, ${n} active suspension(s), all party keys valid`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
