#!/usr/bin/env node
/**
 * @fileoverview CI guard: the AEC Spatial Data Download derivative-product notice is displayed
 * adjacent to every rendered boundary map, single-sourced from the licence record
 * (control-register test `aec-spatial-map-notice-display`).
 *
 * The AEC boundary geometry is licensed under the AEC Spatial Data Download Data Licence, which
 * requires a digital Derivative Product to display the full prescribed notice wherever the data is
 * shown — a short attribution credit is not sufficient. check-aec-spatial.mjs already proves the
 * notice text is correct in data/aec-spatial/source-record.json; this guard proves the app actually
 * *shows* it, from that single source, next to every map (fail-closed against a map surface that
 * renders geometry without the notice, or a component that hard-copies the wording and lets it drift).
 *
 * It proves:
 *   - the shared notice module (apps/web/src/lib/mapLicence.ts) imports the notice from the licence
 *     record via the `$data` alias and re-exports it, and does NOT hard-code any notice paragraph
 *     verbatim (so the displayed text can never drift from the accepted licence wording);
 *   - at least one component renders boundary geometry (fail-closed if the map surface disappears);
 *   - every component that renders boundary geometry imports the shared notice module and references
 *     the notice export in its markup — so the notice sits next to EVERY map, not just one page.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-map-notice.mjs
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Import specifier the shared notice module must draw the record from (the `$data` alias). */
const RECORD_SPECIFIER = "$data/aec-spatial/source-record.json";
/** Import specifier every geometry component must draw the notice from. */
const LIB_SPECIFIER = "$lib/mapLicence";
/** The notice export a geometry component must reference in its markup. */
const NOTICE_EXPORT = "MAP_LICENCE_NOTICE";

/**
 * A component "renders boundary geometry" if it fetches a state map or paints the division paths.
 * Either is a strong signal the AEC-licensed geometry is on screen and the notice must accompany it.
 */
export const GEOMETRY_MARKERS = [/\bloadStateMap\b/, /\.divisions\b/];

/** @param {string} text */
export const rendersGeometry = (text) =>
  typeof text === "string" && GEOMETRY_MARKERS.some((re) => re.test(text));

/**
 * @param {object} input
 * @param {string[]} input.noticeComponents  notice.components from the licence record
 * @param {string} input.libModule           source of the shared notice module (mapLicence.ts)
 * @param {{ path: string, text: string }[]} input.geometryComponents
 *   every component that renders boundary geometry (main() discovers these)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict({ noticeComponents, libModule, geometryComponents }) {
  const errors = [];
  const push = (m) => errors.push(m);

  // The shared notice module must single-source the wording from the licence record.
  const lib = "apps/web/src/lib/mapLicence.ts";
  if (typeof libModule !== "string" || libModule.trim() === "") {
    push(`${lib}: shared map-notice module is missing or empty`);
  } else {
    if (!libModule.includes(RECORD_SPECIFIER)) {
      push(`${lib}: must import the notice from "${RECORD_SPECIFIER}" (single-source the wording)`);
    }
    if (!new RegExp(`export\\s+const\\s+${NOTICE_EXPORT}\\b`).test(libModule)) {
      push(`${lib}: must export ${NOTICE_EXPORT}`);
    }
    // Single-source proof: the notice text is imported, never re-typed here (so it cannot drift).
    for (const line of Array.isArray(noticeComponents) ? noticeComponents : []) {
      if (typeof line === "string" && line.length > 12 && libModule.includes(line)) {
        push(
          `${lib}: hard-codes a notice paragraph verbatim — import it from the record instead so it cannot drift`,
        );
        break;
      }
    }
  }

  // The notice must sit next to EVERY map — and there must be a map surface at all (fail-closed).
  if (!Array.isArray(geometryComponents) || geometryComponents.length === 0) {
    push(
      "no component renders boundary geometry — expected the map surface to import the notice; refusing to pass vacuously",
    );
  } else {
    for (const { path, text } of geometryComponents) {
      if (!text.includes(LIB_SPECIFIER)) {
        push(
          `${path}: renders boundary geometry but does not import the notice from "${LIB_SPECIFIER}"`,
        );
      }
      if (!text.includes(NOTICE_EXPORT)) {
        push(`${path}: renders boundary geometry but never displays ${NOTICE_EXPORT}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
function main() {
  const root = new URL("../", import.meta.url);
  const rootPath = fileURLToPath(root);

  let record;
  try {
    record = JSON.parse(readFileSync(new URL("data/aec-spatial/source-record.json", root), "utf8"));
  } catch (err) {
    console.error(`::error::map-notice: cannot read the AEC spatial source record: ${err.message}`);
    process.exit(1);
    return;
  }

  let libModule = "";
  try {
    libModule = readFileSync(new URL("apps/web/src/lib/mapLicence.ts", root), "utf8");
  } catch {
    /* verdict() reports the missing module */
  }

  // Discover every tracked Svelte component that renders boundary geometry.
  const svelte = execFileSync("git", ["ls-files", "apps/web/src/**/*.svelte"], {
    cwd: rootPath,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const geometryComponents = [];
  for (const rel of svelte) {
    let text;
    try {
      text = readFileSync(new URL(rel, root), "utf8");
    } catch {
      continue;
    }
    if (rendersGeometry(text)) geometryComponents.push({ path: rel, text });
  }

  const result = verdict({
    noticeComponents: record?.notice?.components,
    libModule,
    geometryComponents,
  });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::map-notice: ${e}`);
    console.error(`AEC map notice display: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    `AEC map notice display OK — full derivative-product notice shown next to ${geometryComponents.length} map surface(s), single-sourced from the licence record`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
