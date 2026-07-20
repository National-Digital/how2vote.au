#!/usr/bin/env node
/**
 * @fileoverview CI guard: per-proposition content-rights matrix (control-13, ADR 0005/0009).
 *
 * data/rights/proposition-content-rights.json records, per election, the content-rights class that
 * governs the propositions (survey questions) shown in the app and the OpenAustralia Foundation
 * (OAF) content-permission position. Every proposition's wording and party-vote positions come from
 * a LOCKED They Vote For You API v1 snapshot (data/snapshots/tvfy/<election>/v<version>/). This guard
 * proves — fail-closed — that a proposition can never ship without a settled content-rights position:
 *   - every committed election (data/source/<id>/questions.json) has exactly one matrix entry, and
 *     no matrix entry names an election that does not exist;
 *   - each entry's content-rights class is defined in the rights register (data/rights/
 *     rights-classes.json) AND equals the rights register's vote-positions domain class, so the
 *     matrix can never drift from rights-domain separation (control-14);
 *   - the class it resolves to is the ODbL OpenAustralia Foundation class (no rights contamination);
 *   - the snapshot it binds is the ACTIVE, LOCKED version (immutable provenance, ADR 0007);
 *   - EVERY proposition id is present in that locked snapshot's policy set (each proposition is
 *     tied to the locked source, so its content-rights class is real, not asserted in the abstract);
 *   - the OAF content-permission position is explicit (not-required, or granted with a reference).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-proposition-rights.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** @param {unknown} v */
const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;

const OAF_PERMISSION = ["not-required", "granted"];
const ODBL = "ODbL-1.0";
/** The only source we may assert ODbL over (mirrors check-rights-domain.mjs). */
const ODBL_SOURCE_ORG = "OpenAustralia Foundation";
/** The rights-register domain whose class must govern proposition content. */
const CONTENT_DOMAIN = "vote-positions";

/**
 * Validate the proposition content-rights matrix against the rights register and the committed
 * election sources + locked snapshots.
 *
 * @param {object} input
 * @param {unknown} input.matrix          parsed data/rights/proposition-content-rights.json
 * @param {unknown} input.rightsRegister  parsed data/rights/rights-classes.json
 * @param {Array<{ id: string, questionIds: number[], meta: unknown, activeVersion: unknown }>} input.sources
 *   one entry per committed election directory: its question ids, its locked snapshot meta.json
 *   (or null if absent), and the active version from versions.json.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict({ matrix, rightsRegister, sources }) {
  const errors = [];
  const push = (m) => errors.push(m);

  if (typeof matrix !== "object" || matrix === null || Array.isArray(matrix)) {
    return { ok: false, errors: ["proposition-rights: matrix is not a JSON object"] };
  }
  if (matrix.schemaVersion !== 1) push("proposition-rights: schemaVersion must be 1");
  if (!isNonEmptyString(matrix.updated)) push("proposition-rights: missing updated");

  // Resolve the rights register: the classes by id, and the vote-positions domain's class.
  const classById = new Map();
  let domainClassId = null;
  if (typeof rightsRegister === "object" && rightsRegister !== null) {
    for (const rc of Array.isArray(rightsRegister.rightsClasses)
      ? rightsRegister.rightsClasses
      : []) {
      if (rc && isNonEmptyString(rc.id)) classById.set(rc.id, rc);
    }
    for (const d of Array.isArray(rightsRegister.domains) ? rightsRegister.domains : []) {
      if (d && d.id === CONTENT_DOMAIN) domainClassId = d.rightsClass;
    }
  }
  if (!isNonEmptyString(domainClassId)) {
    push(
      `proposition-rights: rights register has no "${CONTENT_DOMAIN}" domain to anchor the matrix`,
    );
  }

  // The top-level content-rights class must be defined and must equal the vote-positions domain's
  // class — the matrix cannot drift from rights-domain separation.
  const topClass = matrix.contentRightsClass;
  if (!isNonEmptyString(topClass)) {
    push("proposition-rights: missing top-level contentRightsClass");
  } else if (!classById.has(topClass)) {
    push(
      `proposition-rights: contentRightsClass "${topClass}" is not defined in the rights register`,
    );
  } else if (isNonEmptyString(domainClassId) && topClass !== domainClassId) {
    push(
      `proposition-rights: contentRightsClass "${topClass}" != vote-positions domain class "${domainClassId}"`,
    );
  }

  const entries = Array.isArray(matrix.elections) ? matrix.elections : null;
  if (!entries) {
    push("proposition-rights: elections must be an array");
    return { ok: errors.length === 0, errors };
  }

  const byElection = new Map();
  for (const e of entries) {
    if (e && isNonEmptyString(e.electionId)) {
      if (byElection.has(e.electionId))
        push(`proposition-rights: duplicate election ${e.electionId}`);
      byElection.set(e.electionId, e);
    } else {
      push("proposition-rights: an election entry is missing electionId");
    }
  }

  // No matrix entry may name an election that is not a committed source.
  const sourceIds = new Set(sources.map((s) => s.id));
  for (const id of byElection.keys()) {
    if (!sourceIds.has(id))
      push(`proposition-rights: matrix entry "${id}" has no committed election source`);
  }

  // Every committed election must have an entry, tied to its locked snapshot and covering every proposition.
  for (const src of sources) {
    const at = `proposition-rights[${src.id}]`;
    const e = byElection.get(src.id);
    if (!e) {
      push(
        `${at}: no content-rights entry for a committed election with ${src.questionIds.length} propositions`,
      );
      continue;
    }

    const cls = isNonEmptyString(e.contentRightsClass) ? e.contentRightsClass : topClass;
    if (!isNonEmptyString(e.contentRightsClass)) {
      push(`${at}: missing contentRightsClass`);
    } else if (!classById.has(e.contentRightsClass)) {
      push(
        `${at}: contentRightsClass "${e.contentRightsClass}" is not defined in the rights register`,
      );
    } else if (isNonEmptyString(topClass) && e.contentRightsClass !== topClass) {
      push(`${at}: contentRightsClass "${e.contentRightsClass}" != matrix top-level "${topClass}"`);
    }
    // Content must resolve to the ODbL OpenAustralia Foundation class — no rights contamination.
    const rc = classById.get(cls);
    if (rc && (rc.licence?.spdxId !== ODBL || rc.sourceOrg !== ODBL_SOURCE_ORG)) {
      push(
        `${at}: content-rights class "${cls}" is not the ODbL OpenAustralia Foundation class (proposition content must be TVFY/OAF)`,
      );
    }

    // OAF content-permission position must be explicit.
    if (!OAF_PERMISSION.includes(e.oafContentPermission)) {
      push(`${at}: oafContentPermission must be one of ${OAF_PERMISSION.join(", ")}`);
    } else if (e.oafContentPermission === "granted" && !isNonEmptyString(e.oafPermissionRef)) {
      push(`${at}: oafContentPermission "granted" needs an oafPermissionRef`);
    }
    if (!isNonEmptyString(e.oafPermissionBasis)) {
      push(`${at}: missing oafPermissionBasis (record why the OAF position holds)`);
    }

    // The snapshot must be the ACTIVE, LOCKED version.
    if (!isPositiveInt(e.snapshotVersion)) {
      push(`${at}: snapshotVersion must be a positive integer`);
    } else {
      if (src.meta === null || typeof src.meta !== "object") {
        push(`${at}: no snapshot meta for version ${e.snapshotVersion}`);
      } else {
        if (src.meta.version !== e.snapshotVersion) {
          push(
            `${at}: snapshotVersion ${e.snapshotVersion} != snapshot meta version ${src.meta.version}`,
          );
        }
        if (src.meta.locked !== true) {
          push(
            `${at}: snapshot version ${e.snapshotVersion} is not locked (immutable provenance required)`,
          );
        }
      }
      if (src.activeVersion !== e.snapshotVersion) {
        push(`${at}: snapshotVersion ${e.snapshotVersion} != active version ${src.activeVersion}`);
      }
    }

    // Every proposition must be present in the locked snapshot's policy set.
    const policySet = new Set(
      src.meta && Array.isArray(src.meta.policyIds) ? src.meta.policyIds : [],
    );
    const orphans = src.questionIds.filter((id) => !policySet.has(id));
    if (orphans.length > 0) {
      push(
        `${at}: ${orphans.length} proposition(s) not in the locked snapshot policy set: ${orphans.slice(0, 10).join(", ")}${orphans.length > 10 ? "…" : ""}`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);
const readJson = (p) => JSON.parse(readFileSync(rel(p), "utf8"));

/** Enumerate committed election directories that carry propositions (questions.json). */
function collectSources() {
  const sources = [];
  let ids;
  try {
    ids = readdirSync(rel("data/source/"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return sources;
  }
  for (const id of ids) {
    if (!existsSync(rel(`data/source/${id}/questions.json`))) continue;
    let questionIds = [];
    try {
      const q = readJson(`data/source/${id}/questions.json`);
      questionIds = (Array.isArray(q.questions) ? q.questions : []).map((x) => x.id);
    } catch {
      /* a malformed questions.json fails its own guard; treat as no propositions here */
    }
    let activeVersion = null;
    try {
      activeVersion = readJson(`data/snapshots/tvfy/${id}/versions.json`).active;
    } catch {
      /* missing versions.json → activeVersion stays null, flagged by the verdict */
    }
    let meta = null;
    if (
      isPositiveInt(activeVersion) &&
      existsSync(rel(`data/snapshots/tvfy/${id}/v${activeVersion}/meta.json`))
    ) {
      try {
        meta = readJson(`data/snapshots/tvfy/${id}/v${activeVersion}/meta.json`);
      } catch {
        /* unparseable meta → null, flagged by the verdict */
      }
    }
    sources.push({ id, questionIds, meta, activeVersion });
  }
  return sources;
}

function main() {
  let matrix;
  let rightsRegister;
  try {
    matrix = readJson("data/rights/proposition-content-rights.json");
    rightsRegister = readJson("data/rights/rights-classes.json");
  } catch (err) {
    console.error(`::error::proposition-rights: cannot read an input: ${err.message}`);
    process.exit(1);
    return;
  }
  const result = verdict({ matrix, rightsRegister, sources: collectSources() });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::${e}`);
    console.error(`proposition content-rights: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  const n = Array.isArray(matrix.elections) ? matrix.elections.length : 0;
  console.info(
    `proposition content-rights OK — ${n} election(s), every proposition tied to a locked snapshot`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
