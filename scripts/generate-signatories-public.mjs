#!/usr/bin/env node
/**
 * @fileoverview Generate the PUBLIC signatory projection from the compliance signatory registry.
 *
 * The registry (docs/legal/signatories.json) is the single source of truth for the natural persons
 * authorised to record compliance sign-offs. A public subset — only signatories with
 * `publicProfile: true`, and only their public-facing fields — is projected into the web app so it
 * can render accountable-person structured data (schema.org Person) and a visible accountability
 * section without the app importing the full compliance registry (which lives under docs/, outside
 * the app's $data alias, and carries non-public fields).
 *
 * The derived artefact is apps/web/src/lib/governance/signatories.public.generated.json.
 * `--write` rewrites it; `--check` (default, run in CI) fails if the committed file has drifted from
 * what the registry would produce — the same drift-gate pattern as generate-license-data.mjs and
 * generate-vendor-allowlist.mjs. docs/legal is a CODEOWNERS compliance path, so a change to who is
 * publicly named as an accountable signatory is reviewed as a compliance change.
 *
 * The pure renderer is exported for unit tests; the fs/CLI plumbing only runs when executed directly.
 *
 * Usage:
 *   node scripts/generate-signatories-public.mjs           # check (fails on drift)
 *   node scripts/generate-signatories-public.mjs --write   # rewrite the generated file
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REGISTRY_REL = "docs/legal/signatories.json";
const OUTPUT_REL = "apps/web/src/lib/governance/signatories.public.generated.json";

/**
 * Project the public subset of the registry: only `publicProfile: true` signatories, and only their
 * public-facing fields (no email/GitHub-handle beyond what `sameAs` already publishes).
 *
 * @param {any} registry parsed docs/legal/signatories.json
 * @returns {{ generatedFrom: string, note: string, signatories: object[] }}
 */
export function renderPublic(registry) {
  const signatories = Array.isArray(registry?.signatories) ? registry.signatories : [];
  const projected = signatories
    .filter((s) => s && s.publicProfile === true)
    .map((s) => ({
      id: s.id,
      legalName: s.legalName,
      jobTitle: s.jobTitle,
      org: s.org,
      sameAs: Array.isArray(s.sameAs) ? [...s.sameAs] : [],
    }));
  return {
    generatedFrom: REGISTRY_REL,
    note: "GENERATED — do not edit. Public projection of the compliance signatory registry (publicProfile: true only). Run `node scripts/generate-signatories-public.mjs --write` after editing the registry.",
    signatories: projected,
  };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const rel = (p) => new URL(`../${p}`, import.meta.url);
const serialize = (obj) => JSON.stringify(obj, null, 2) + "\n";

function main() {
  const write = process.argv.includes("--write");
  let registry;
  try {
    registry = JSON.parse(readFileSync(rel(REGISTRY_REL), "utf8"));
  } catch (err) {
    console.error(`::error::cannot read ${REGISTRY_REL}: ${err.message}`);
    process.exit(1);
  }
  const expected = serialize(renderPublic(registry));

  if (write) {
    writeFileSync(rel(OUTPUT_REL), expected);
    console.info(`wrote ${OUTPUT_REL}`);
    return;
  }

  let actual = null;
  try {
    actual = readFileSync(rel(OUTPUT_REL), "utf8");
  } catch {
    /* missing → drift */
  }
  if (actual !== expected) {
    console.error(
      `::error::${OUTPUT_REL} is out of date — run "node scripts/generate-signatories-public.mjs --write"`,
    );
    process.exit(1);
  }
  console.info(`signatories public projection OK — in sync with ${REGISTRY_REL}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
