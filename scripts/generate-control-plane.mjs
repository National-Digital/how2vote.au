#!/usr/bin/env node
/**
 * @fileoverview Sign the runtime kill-switch control plane.
 *
 * data/governance/control-plane.json is the signed, tamper-evident suspension register the runtime
 * reads to REFUSE a capability at a chosen scope (global research/publication/printing/decoding; or a
 * specific election/chamber/electorate/ballot/mapping/proposition/map). This generator (re)computes
 * the content-integrity digest over its {schemaVersion, suspensions} body and writes it into the
 * `integrity` field. An operator edits the suspensions list by hand, then runs this with `--write`;
 * CI runs it in check mode to fail closed if the committed digest has drifted from the body.
 *
 * Same drift-gate pattern as generate-research-registry.mjs. The digest algorithm MUST match
 * apps/web/src/lib/governance/control-plane.ts (canonicalString / controlPlaneDigest) byte-for-byte —
 * the runtime recomputes it synchronously and refuses everything if it does not match.
 *
 * Usage:
 *   node scripts/generate-control-plane.mjs           # check (fail on drift)
 *   node scripts/generate-control-plane.mjs --write   # recompute + write the integrity digest
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENTRY_KEY_ORDER = [
  "scope",
  "electionId",
  "chamber",
  "electorate",
  "ballot",
  "partyKey",
  "propositionId",
  "mapId",
  "reason",
  "by",
  "flaggedAt",
  "ref",
  "liftedAt",
  "liftedBy",
];

/** Serialise one suspension with keys in a fixed order, omitting absent fields. */
function canonicalEntry(s) {
  const ordered = {};
  for (const k of ENTRY_KEY_ORDER) {
    if (s[k] !== undefined) ordered[k] = s[k];
  }
  return JSON.stringify(ordered);
}

/**
 * Canonical string over the signed body — order-independent (entries sorted). MUST match
 * canonicalString() in apps/web/src/lib/governance/control-plane.ts.
 * @param {{ schemaVersion: number, suspensions: unknown[] }} body
 */
export function canonicalBody(body) {
  const entries = (Array.isArray(body.suspensions) ? body.suspensions : [])
    .map(canonicalEntry)
    .sort();
  return JSON.stringify({
    schemaVersion: body.schemaVersion,
    suspensions: entries.map((e) => JSON.parse(e)),
  });
}

/** The expected `integrity` value (`sha256-<hex>`) for a control-plane body. */
export function controlPlaneDigest(body) {
  return "sha256-" + createHash("sha256").update(canonicalBody(body)).digest("hex");
}

/** Rebuild the full committed file with a freshly computed integrity digest. */
export function signControlPlane(plane) {
  const body = { schemaVersion: plane.schemaVersion, suspensions: plane.suspensions ?? [] };
  return {
    schemaVersion: plane.schemaVersion,
    updated: plane.updated,
    note: plane.note,
    suspensions: plane.suspensions ?? [],
    integrity: controlPlaneDigest(body),
  };
}

/* c8 ignore start -- fs/CLI plumbing, exercised via CI not unit tests */
const PATH = new URL("../data/governance/control-plane.json", import.meta.url);

function main() {
  const write = process.argv.includes("--write");
  let current;
  try {
    current = JSON.parse(readFileSync(PATH, "utf8"));
  } catch (err) {
    console.error(`::error::control-plane: cannot read control-plane.json: ${err.message}`);
    process.exit(1);
    return;
  }
  const signed = signControlPlane(current);
  const serialised = JSON.stringify(signed, null, 2) + "\n";

  if (write) {
    writeFileSync(PATH, serialised);
    console.info(`control plane signed → ${fileURLToPath(PATH)} (${signed.integrity})`);
    return;
  }

  const currentSerialised = JSON.stringify(current, null, 2) + "\n";
  if (currentSerialised !== serialised) {
    console.error(
      "::error::control-plane: control-plane.json is out of date — run `pnpm control-plane:generate` and commit the result",
    );
    process.exit(1);
    return;
  }
  console.info(
    `control plane OK — integrity digest matches the body (${signed.suspensions.length} suspension(s))`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
