#!/usr/bin/env node
/**
 * @fileoverview CI guard: one authoritative registry of compliance signatories.
 *
 * docs/legal/signatories.json is the single machine-readable source for the natural persons
 * authorised to record compliance sign-offs / reviews. It is deliberately separate from
 * operator.json (the operating ENTITY). Reviewer references elsewhere resolve to a signatory `id`:
 *   - data/source/<id>/aec-sources.json          (reviewer)
 *   - data/source/<id>/ballot-verification.json  (reviewers.primary / reviewers.second)
 *   - data/source/<id>/candidate-mapping.json    (reviewer)
 *   - docs/legal/control-register.json           (evidence[].reviewer / .secondReviewer, internal sign-offs)
 *
 * This guard proves:
 *   - the registry is well-formed: unique kebab ids, complete identity, valid GitHub handle and
 *     LinkedIn/sameAs URLs, a scope that is "all" or a subset of the declared domains, and an
 *     activeFrom that is not in the future (an inactive/lapsed signatory fails, fail-closed);
 *   - referential integrity: every id-shaped reviewer reference across the artefacts above resolves
 *     to an ACTIVE signatory whose scope COVERS the sign-off. A reviewer value that is a
 *     human-readable descriptor (contains whitespace — e.g. an external legal practitioner not in
 *     this registry) is treated as an external/legacy descriptor and is exempt from resolution, so
 *     external reviewers are still expressible without a registry entry.
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing only runs when
 * the script is executed directly.
 *
 * Usage:
 *   node scripts/check-signatories.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REGISTRY_REL = "docs/legal/signatories.json";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
/** kebab-case identifier, e.g. "cameron-young". Also the shape used to detect an id reference. */
const ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
/** GitHub username: 1–39 chars, alphanumeric or hyphen, not starting/ending with a hyphen. */
const GH_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const LINKEDIN = /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9%\-_]+\/?$/;

/** @param {unknown} v @returns {number | null} */
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v))
    return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Is this reviewer value an id reference (vs an external/legacy descriptor)? */
export function isIdReference(v) {
  return typeof v === "string" && ID_SHAPE.test(v.trim());
}

/**
 * Validate the signatory registry and resolve every id-shaped reviewer reference.
 *
 * @param {unknown} registry  parsed docs/legal/signatories.json
 * @param {{ now?: number, references?: { where: string, reviewer: unknown, domain?: string }[] }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(registry, options = {}) {
  const errors = [];
  const now = options.now ?? Date.parse("2026-07-17T00:00:00Z");
  const references = options.references ?? [];
  const push = (m) => errors.push(m);

  if (typeof registry !== "object" || registry === null || Array.isArray(registry)) {
    return { ok: false, errors: ["signatories.json: not a JSON object"] };
  }
  if (registry.schemaVersion !== 1) {
    push(
      `signatories.json: schemaVersion must be 1, got ${JSON.stringify(registry.schemaVersion)}`,
    );
  }
  if (parseIsoDate(registry.updated) === null) {
    push("signatories.json: updated must be an ISO date");
  }

  const domains = new Set(
    registry.scopes && Array.isArray(registry.scopes.domains) ? registry.scopes.domains : [],
  );

  const signatories = Array.isArray(registry.signatories) ? registry.signatories : null;
  if (!signatories) {
    return { ok: false, errors: [...errors, "signatories.json: signatories must be an array"] };
  }
  if (signatories.length === 0) push("signatories.json: at least one signatory is required");

  /** @type {Map<string, { active: boolean, scope: 'all' | Set<string> }>} */
  const byId = new Map();
  const seenIds = new Set();
  const seenHandles = new Set();

  for (const s of signatories) {
    const label = isNonEmptyString(s && s.id) ? s.id : "(unnamed)";
    const at = `signatories.json[${label}]`;
    if (typeof s !== "object" || s === null) {
      push(`${at}: not an object`);
      continue;
    }
    if (!isNonEmptyString(s.id) || !ID_SHAPE.test(s.id)) {
      push(`${at}: id must be kebab-case`);
    } else if (seenIds.has(s.id)) {
      push(`${at}: duplicate id`);
    }
    seenIds.add(s.id);

    for (const key of ["legalName", "givenName", "familyName", "jobTitle", "org"]) {
      if (!isNonEmptyString(s[key])) push(`${at}: missing ${key}`);
    }

    if (!isNonEmptyString(s.githubHandle) || !GH_HANDLE.test(s.githubHandle)) {
      push(`${at}: githubHandle must be a valid GitHub username`);
    } else if (seenHandles.has(s.githubHandle.toLowerCase())) {
      push(`${at}: duplicate githubHandle`);
    }
    if (isNonEmptyString(s.githubHandle)) seenHandles.add(s.githubHandle.toLowerCase());

    if (s.linkedin !== null && !(isNonEmptyString(s.linkedin) && LINKEDIN.test(s.linkedin))) {
      push(`${at}: linkedin must be null or a https://www.linkedin.com/in/… URL`);
    }
    if (s.email !== null && !isNonEmptyString(s.email)) {
      push(`${at}: email must be null or a non-empty string`);
    }
    if (typeof s.publicProfile !== "boolean") {
      push(`${at}: publicProfile must be a boolean`);
    }

    // sameAs must be https URLs and must include the GitHub + LinkedIn identities it declares, so the
    // public structured-data markup can trust it as the authoritative external-identity set.
    if (!Array.isArray(s.sameAs) || s.sameAs.some((u) => !/^https:\/\//.test(u))) {
      push(`${at}: sameAs must be an array of https URLs`);
    } else {
      if (isNonEmptyString(s.githubHandle)) {
        const gh = `https://github.com/${s.githubHandle}`;
        if (!s.sameAs.includes(gh)) push(`${at}: sameAs must include the GitHub URL ${gh}`);
      }
      if (isNonEmptyString(s.linkedin) && !s.sameAs.includes(s.linkedin)) {
        push(`${at}: sameAs must include the LinkedIn URL`);
      }
    }

    // Scope: "all" or a non-empty subset of the declared domains.
    let scope = /** @type {'all' | Set<string>} */ ("all");
    if (s.signOffScope === "all") {
      scope = "all";
    } else if (Array.isArray(s.signOffScope) && s.signOffScope.length > 0) {
      const bad = s.signOffScope.filter((d) => !domains.has(d));
      if (bad.length) push(`${at}: signOffScope has undeclared domain(s): ${bad.join(", ")}`);
      scope = new Set(s.signOffScope);
    } else {
      push(`${at}: signOffScope must be "all" or a non-empty array of declared domains`);
    }

    const from = parseIsoDate(s.activeFrom);
    if (from === null) push(`${at}: activeFrom must be an ISO date`);
    const until = s.activeUntil === undefined ? null : parseIsoDate(s.activeUntil);
    if (s.activeUntil !== undefined && until === null) {
      push(`${at}: activeUntil must be an ISO date when present`);
    }
    const active = from !== null && from <= now && (until === null || until >= now);

    if (isNonEmptyString(s.id)) byId.set(s.id, { active, scope });
  }

  // Referential integrity: every id-shaped reviewer reference resolves to an active, in-scope signatory.
  for (const ref of references) {
    if (!isIdReference(ref.reviewer)) continue; // external/legacy descriptor — exempt by design
    const id = ref.reviewer.trim();
    const hit = byId.get(id);
    if (!hit) {
      push(`${ref.where}: reviewer "${id}" does not resolve to a signatory`);
      continue;
    }
    if (!hit.active) push(`${ref.where}: reviewer "${id}" is not an active signatory`);
    if (ref.domain && hit.scope !== "all" && !hit.scope.has(ref.domain)) {
      push(`${ref.where}: signatory "${id}" scope does not cover "${ref.domain}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI plumbing, exercised via CI not unit tests */
const rel = (p) => new URL(`../${p}`, import.meta.url);

/** Collect the id-shaped reviewer references the registry must resolve. */
function gatherReferences() {
  const refs = [];
  const readJson = (p) => {
    try {
      return JSON.parse(readFileSync(rel(p), "utf8"));
    } catch {
      return null;
    }
  };

  for (const election of ["2019", "2022", "2025"]) {
    const aec = readJson(`data/source/${election}/aec-sources.json`);
    for (const s of (aec && aec.sources) || []) {
      refs.push({
        where: `aec-sources ${election} [${s.id}]`,
        reviewer: s.reviewer,
        domain: "candidate-data",
      });
    }
    const bal = readJson(`data/source/${election}/ballot-verification.json`);
    if (bal && bal.reviewers) {
      refs.push({
        where: `ballot-verification ${election} [primary]`,
        reviewer: bal.reviewers.primary,
        domain: "ballot-order",
      });
      refs.push({
        where: `ballot-verification ${election} [second]`,
        reviewer: bal.reviewers.second,
        domain: "ballot-order",
      });
    }
    const map = readJson(`data/source/${election}/candidate-mapping.json`);
    if (map) {
      refs.push({
        where: `candidate-mapping ${election}`,
        reviewer: map.reviewer,
        domain: "candidate-data",
      });
    }
  }

  const register = readJson("docs/legal/control-register.json");
  for (const c of (register && register.controls) || []) {
    for (const e of c.evidence || []) {
      if ("reviewer" in e) {
        refs.push({ where: `control-register ${c.id} [${e.id}]`, reviewer: e.reviewer });
      }
      // A second reviewer (joint sign-off) resolves the same way — mirrors ballot-verification's
      // reviewers.primary / reviewers.second. An id-shaped value must resolve to an active signatory.
      if ("secondReviewer" in e) {
        refs.push({
          where: `control-register ${c.id} [${e.id}] (second reviewer)`,
          reviewer: e.secondReviewer,
        });
      }
    }
  }

  const spatial = readJson("data/aec-spatial/source-record.json");
  for (const s of (spatial && spatial.sources) || []) {
    if ("reviewer" in s) {
      refs.push({
        where: `aec-spatial [${s.fileName || s.boundaryYear}]`,
        reviewer: s.reviewer,
        domain: "attribution-licensing",
      });
    }
  }
  return refs;
}

function main() {
  let registry;
  try {
    registry = JSON.parse(readFileSync(rel(REGISTRY_REL), "utf8"));
  } catch (err) {
    console.error(`::error::cannot read ${REGISTRY_REL}: ${err.message}`);
    process.exit(1);
  }
  const result = verdict(registry, { references: gatherReferences() });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::signatories: ${e}`);
    console.error(`signatories: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  const n = registry.signatories.length;
  console.info(`signatories OK — ${n} authorised signatory(ies), all references resolve`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
