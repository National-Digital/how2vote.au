#!/usr/bin/env node
/**
 * @fileoverview Generate LICENSE-DATA.md's attribution/provenance header from the machine-readable
 * rights register.
 *
 * LICENSE-DATA.md is two parts: a generated HTML-comment header carrying every data source's licence,
 * copyright, attribution and redistribution terms, followed by the verbatim ODbL v1.0 statutory text
 * (a fixed licence, not derived from the register). The header is the drift-prone part; this
 * generator makes data/rights/rights-classes.json the single source of truth for it:
 * `--write` rewrites the header in place; `--check` (default,
 * run in CI) fails if the committed file has drifted from what the register would produce.
 *
 * The ODbL statutory text (everything from the closing `-->` of the header onward) is preserved
 * byte-for-byte.
 *
 * The pure renderer is exported as renderHeader()/compose() for unit tests; fs/CLI runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/generate-license-data.mjs            # check (fail on drift)
 *   node scripts/generate-license-data.mjs --write    # rewrite LICENSE-DATA.md header from register
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WRAP = 96;
const HEADER_END = "-->\n";
/** The generated header promises the ODbL text follows — assert it actually does (body integrity). */
const ODBL_ANCHOR = "Open Database License (ODbL) v1.0";
/** Heading of the generated AEC derivative-product notice block. */
const AEC_NOTICE_HEADING = "AEC SPATIAL DATA — DERIVATIVE PRODUCT NOTICE";

/** Deterministic greedy word-wrap; `indent` is prepended to every produced line. */
function wrap(text, indent = "  ") {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = indent;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line !== indent && line.length + 1 + word.length > WRAP) {
        lines.push(line);
        line = indent;
      }
      line += line === indent ? word : ` ${word}`;
    }
    lines.push(line);
  }
  return lines;
}

/** Domains that reference a given rights class, in register order. */
function domainsFor(register, classId) {
  return register.domains.filter((d) => d.rightsClass === classId).map((d) => d.id);
}

/**
 * Render the generated header comment block (ending with the closing `-->\n`) from the register.
 * @param {any} register parsed data/rights/rights-classes.json
 * @param {any} [aecSpatial] parsed data/aec-spatial/source-record.json (optional; renders the full
 *   AEC derivative-product notice when present)
 * @returns {string}
 */
export function renderHeader(register, aecSpatial = null) {
  const out = [];
  const p = (s = "") => out.push(s);

  p("<!--");
  p("  DATA LICENCE & ATTRIBUTION  (generated — do not edit by hand)");
  p("  ==========================================================");
  p("  Generated from data/rights/rights-classes.json by scripts/generate-license-data.mjs");
  p("  To change any fact below, edit the register");
  p("  and run `pnpm rights:generate`; CI fails if this file drifts from the register.");
  p(`  Notice version: ${register.noticeVersion}. Register last updated: ${register.updated}.`);
  p("");
  p("  This licence governs the *data* in this repository, NOT the application source code (which");
  p("  is AGPL-3.0 — see LICENSE). Each data domain carries its own rights class; the domains are");
  p("  kept separate so no source's terms contaminate another.");
  p("");

  for (const rc of register.rightsClasses) {
    const used = domainsFor(register, rc.id);
    p(`  ${rc.name}`);
    p(`  ${"-".repeat(rc.name.length)}`);
    p(`  Domains: ${used.length ? used.join(", ") : "(none)"}`);
    p(`  Source: ${rc.source} (${rc.sourceOrg}) — ${rc.sourceUrl}`);
    const licUrl = rc.licence.url ? `, ${rc.licence.url}` : "";
    p(
      `  Licence: ${rc.licence.name} [${rc.licence.spdxId}${licUrl}] — status: ${rc.licenceStatus}`,
    );
    p(`  Copyright: ${rc.copyright}`);
    const terms =
      `redistribution ${rc.redistribution}; modification ${rc.modification}; ` +
      `share-alike ${rc.shareAlike ? "yes" : "no"}.`;
    // A provisional/under-review licence must not read as a settled grant — flag that the terms are
    // subject to the pending determination (see the class's status/notes).
    if (rc.licenceStatus === "current") p(`  Terms: ${terms}`);
    else p(`  Terms (provisional, subject to the pending licence determination): ${terms}`);
    if (rc.attributionRequired) p(`  Required attribution: "${rc.attribution}"`);
    if (rc.notes) for (const line of wrap(rc.notes)) p(line);
    p("");
  }

  const odbl = register.rightsClasses.filter((rc) => rc.licence.spdxId === "ODbL-1.0");
  if (odbl.length) {
    p("  Any redistribution or public use of the ODbL data domain(s) above (or a database derived");
    p(
      "  from them) must remain under the ODbL and carry the required attribution. The ODbL applies",
    );
    p(
      "  only to those domains; the Commonwealth/AEC and project-owned domains are not ODbL and must",
    );
    p("  not be redistributed as if they were.");
    p("");
  }
  // The AEC boundary geometry is a Derivative Product under the AEC Spatial Data Download Data
  // Licence, which prescribes a specific notice (a bare attribution is insufficient).
  const notice = aecSpatial?.notice?.components;
  if (Array.isArray(notice) && notice.length) {
    p(`  ${AEC_NOTICE_HEADING}`);
    p("  --------------------------------------------");
    const intro =
      `Required by the ${aecSpatial.licence?.name ?? "AEC Spatial Data Download Data Licence"} ` +
      `(${aecSpatial.licence?.url ?? ""}); status: ${aecSpatial.status}. This notice must be ` +
      `displayed wherever the boundary geometry is shown or distributed:`;
    for (const line of wrap(intro)) p(line);
    for (const line of notice) for (const w of wrap(line, "    ")) p(w);
    p("");
  }
  p("  The full ODbL v1.0 statutory text follows below.");
  p("-->");
  return `${out.join("\n")}\n`;
}

/** Compose the full LICENSE-DATA.md: generated header + the preserved ODbL body from `existing`. */
export function compose(register, existing, aecSpatial = null) {
  const idx = existing.indexOf(HEADER_END);
  if (idx === -1) {
    throw new Error("LICENSE-DATA.md has no header comment terminator (-->); cannot preserve body");
  }
  const body = existing.slice(idx + HEADER_END.length);
  return renderHeader(register, aecSpatial) + body;
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const FILE = new URL("LICENSE-DATA.md", root);
const REGISTER = new URL("data/rights/rights-classes.json", root);
const AEC_SPATIAL = new URL("data/aec-spatial/source-record.json", root);

function main() {
  const write = process.argv.includes("--write");
  let register, existing, aecSpatial;
  try {
    register = JSON.parse(readFileSync(REGISTER, "utf8"));
    existing = readFileSync(FILE, "utf8");
    aecSpatial = JSON.parse(readFileSync(AEC_SPATIAL, "utf8"));
  } catch (err) {
    console.error(`::error::license-data: cannot read inputs: ${err.message}`);
    process.exit(1);
    return;
  }
  let next;
  try {
    next = compose(register, existing, aecSpatial);
  } catch (err) {
    console.error(`::error::license-data: ${err.message}`);
    process.exit(1);
    return;
  }
  // The generator only rewrites the header and preserves the body verbatim, so a corrupted/deleted
  // ODbL body would otherwise sail through the drift check. Guard the statutory text explicitly.
  if (!next.includes(ODBL_ANCHOR)) {
    console.error(
      `::error::license-data: LICENSE-DATA.md is missing the ODbL statutory text ("${ODBL_ANCHOR}")`,
    );
    process.exit(1);
    return;
  }
  // If the AEC source record carries a prescribed notice, it must reach LICENSE-DATA.md (mirrors the
  // ODbL anchor guard — the notice can never silently vanish from the generated file).
  if (aecSpatial?.notice?.components?.length && !next.includes(AEC_NOTICE_HEADING)) {
    console.error(
      `::error::license-data: LICENSE-DATA.md is missing the AEC derivative-product notice ("${AEC_NOTICE_HEADING}")`,
    );
    process.exit(1);
    return;
  }
  if (write) {
    writeFileSync(FILE, next);
    console.info("LICENSE-DATA.md header regenerated from data/rights/rights-classes.json");
    return;
  }
  if (next !== existing) {
    console.error(
      "::error::license-data: LICENSE-DATA.md is out of date with data/rights/rights-classes.json — run `pnpm rights:generate`",
    );
    process.exit(1);
    return;
  }
  console.info("LICENSE-DATA.md is in sync with the rights register");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
