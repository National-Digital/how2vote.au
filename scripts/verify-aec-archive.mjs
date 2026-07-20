#!/usr/bin/env node
/**
 * @fileoverview Auditor tool: verify the retained AEC boundary archive against the pinned checksum.
 *
 * The AEC Spatial Data Download Data Licence restricts redistribution, so the raw boundary archive is
 * NOT committed (it is git-ignored and held in the restricted corporate store). That would make it
 * unverifiable to a third party — except that data/aec-spatial/source-record.json pins each source
 * file by SHA-256. Anyone who obtains the same AEC download (freely, under the same licence) can run
 * this tool: it hashes the local archive and confirms it is byte-identical to the pinned value. This
 * is how a restricted-redistribution source stays publicly *verifiable* without being publicly
 * *redistributed*, complementing the named reviewer attestation.
 *
 * This is an auditor/maintainer tool, NOT a CI gate: CI never has the git-ignored archive, so when the
 * file is absent the tool reports "not present" and exits 0 (skip) rather than failing.
 *
 * The pure comparison is exported as verify() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/verify-aec-archive.mjs
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Compare each source's pinned sha256 against a computed hash (or null when the file wasn't found).
 * @param {any} record  parsed data/aec-spatial/source-record.json
 * @param {Record<string, string|null>} shaByFile  fileName -> computed sha256 (null = not present)
 * @returns {{ ok: boolean, results: {fileName:string, status:"match"|"mismatch"|"absent", pinned:string}[] }}
 */
export function verify(record, shaByFile) {
  const results = [];
  let ok = true;
  for (const s of record.sources ?? []) {
    if (!s.fileName || !s.sha256) continue; // nothing pinned to verify yet
    const computed = shaByFile[s.fileName] ?? null;
    let status;
    if (computed === null)
      status = "absent"; // not present locally — skip, not a failure
    else if (computed === s.sha256) status = "match";
    else {
      status = "mismatch";
      ok = false; // a present-but-wrong file is a real failure
    }
    results.push({ fileName: s.fileName, status, pinned: s.sha256 });
  }
  return { ok, results };
}

/* c8 ignore start -- CLI/fs plumbing, exercised by auditors not unit tests */
const CANDIDATE_DIRS = ["data/source/boundaries", "data/raw/boundaries"];

function sha256File(url) {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

function main() {
  const root = new URL("../", import.meta.url);
  const record = JSON.parse(
    readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"),
  );
  const shaByFile = {};
  for (const s of record.sources ?? []) {
    if (!s.fileName) continue;
    let found = null;
    for (const dir of CANDIDATE_DIRS) {
      const url = new URL(`${dir}/${s.fileName}`, root);
      if (existsSync(url)) {
        found = sha256File(url);
        break;
      }
    }
    shaByFile[s.fileName] = found;
  }
  const { ok, results } = verify(record, shaByFile);
  for (const r of results) {
    if (r.status === "match") console.info(`OK    ${r.fileName} matches the pinned checksum`);
    else if (r.status === "mismatch")
      console.error(`::error::aec-archive: ${r.fileName} does NOT match the pinned checksum`);
    else
      console.info(
        `SKIP  ${r.fileName} not present locally (git-ignored; obtain from the AEC to verify)`,
      );
  }
  if (!ok) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
