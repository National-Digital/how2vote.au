#!/usr/bin/env node
/**
 * @fileoverview CI guard: enforceable absolute-claims register (docs/legal/absolute-claims.json).
 * Fail-closed. Categorical / quasi-legal wording (an absolute "non-partisan" self-label, "anonymous",
 * "unlinkable", "no personal information", "cannot recognise/track", "IP addresses never collected",
 * an absolute legal-compliance claim) may appear in public copy only where a CURRENT, evidence-backed
 * permit expressly allows it at that location. A permit whose evidence is not current or is past its
 * expiry permits nothing; a permit whose location no longer contains its term is stale.
 *
 * Pure decision logic is exported as verdict() (+ helpers) for unit tests; the fs/git/CLI plumbing
 * only runs when executed directly.
 *
 * Usage: node scripts/check-absolute-claims.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Parse an ISO-8601 date (YYYY-MM-DD or full timestamp) to epoch ms, or null.
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Strip code/markup comments so only PUBLIC COPY is scanned. Developer comments legitimately explain
 * the very absolute wordings this guard bans (e.g. `// never claim "anonymous"`), and comments never
 * reach the user. Removes block comments, HTML comments and `//` line comments (but not the `//` in a
 * URL scheme like `https://`).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripComments(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Whitespace/tag-normalise copy so multi-word phrases (permitted_qualification proofs, prohibited
 * wordings) can be located regardless of markup/indentation.
 * @param {string} raw
 * @returns {string}
 */
export function normalise(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") // unescape last so it cannot re-form another entity
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compile a register `bannedTerms` list into {id, label, prefer, re}. A bad pattern is reported by
 * the caller (compileTerms returns the error string in `.error`).
 * @param {unknown} bannedTerms
 * @returns {{ terms: {id:string,label:string,prefer:string,re:RegExp}[], errors: string[] }}
 */
export function compileTerms(bannedTerms) {
  const terms = [];
  const errors = [];
  const list = Array.isArray(bannedTerms) ? bannedTerms : [];
  const ids = new Set();
  for (const [i, t] of list.entries()) {
    const at = `bannedTerms[${i}]${t && t.id ? ` (${t.id})` : ""}`;
    if (!t || typeof t !== "object") {
      errors.push(`${at}: not an object`);
      continue;
    }
    if (!isNonEmptyString(t.id)) errors.push(`${at}: missing id`);
    else if (ids.has(t.id)) errors.push(`${at}: duplicate id`);
    else ids.add(t.id);
    if (!isNonEmptyString(t.label)) errors.push(`${at}: missing label`);
    if (!isNonEmptyString(t.prefer)) errors.push(`${at}: missing prefer (softer wording)`);
    if (!isNonEmptyString(t.pattern)) {
      errors.push(`${at}: missing pattern`);
      continue;
    }
    try {
      terms.push({
        id: t.id,
        label: t.label ?? t.id,
        prefer: t.prefer ?? "",
        re: new RegExp(t.pattern, "gi"),
      });
    } catch (err) {
      errors.push(`${at}: invalid regex (${err.message})`);
    }
  }
  return { terms, errors };
}

/**
 * Scan public-copy sources for banned constructions. Comments are stripped first.
 * @param {{ path: string, text: string }[]} sources
 * @param {{id:string,label:string,re:RegExp}[]} terms
 * @returns {{ path: string, term: string, label: string, match: string }[]}
 */
export function scanCopy(sources, terms) {
  const hits = [];
  for (const { path, text: raw } of sources) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const text = stripComments(raw);
    for (const { id, label, re } of terms) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        hits.push({ path, term: id, label, match: m[0].replace(/\s+/g, " ").trim() });
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width matches
      }
    }
  }
  return hits;
}

/**
 * Decide whether the absolute-claims posture is clean.
 *
 * @param {{
 *   register?: unknown,
 *   sources?: { path: string, text: string }[],
 *   currentEvidence?: Set<string> | string[],
 *   now?: number,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const now = input.now ?? Date.now();
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const currentEvidence =
    input.currentEvidence instanceof Set
      ? input.currentEvidence
      : new Set(Array.isArray(input.currentEvidence) ? input.currentEvidence : []);

  const register = input.register;
  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    return { ok: false, errors: ["register: not a JSON object"] };
  }
  if (register.schemaVersion !== 1) {
    push(`register.schemaVersion: expected 1, got ${JSON.stringify(register.schemaVersion)}`);
  }

  const { terms, errors: termErrors } = compileTerms(register.bannedTerms);
  for (const e of termErrors) push(`register.${e}`);
  const termIds = new Set(terms.map((t) => t.id));
  if (terms.length === 0) push("register.bannedTerms: at least one banned term is required");

  // Text of each source by path, for permit hedge/prohibited-wording checks.
  const textByPath = new Map(sources.map((s) => [s.path, normalise(stripComments(s.text ?? ""))]));

  // ── Permits: structure + evidence binding + activeness. ──────────────────────────────────────
  const claims = Array.isArray(register.permittedClaims) ? register.permittedClaims : null;
  /** @type {Map<string, {location:string, term:string}[]>} active permits keyed by `${term} ${location}` */
  const activeByKey = new Map();
  const activePermits = [];
  if (claims === null) {
    push("register.permittedClaims: not an array");
  } else {
    const ids = new Set();
    for (const [i, c] of claims.entries()) {
      const at = `permittedClaims[${i}]${c && c.id ? ` (${c.id})` : ""}`;
      if (!c || typeof c !== "object") {
        push(`${at}: not an object`);
        continue;
      }
      if (!isNonEmptyString(c.id)) push(`${at}: missing id`);
      else if (ids.has(c.id)) push(`${at}: duplicate id`);
      else ids.add(c.id);
      for (const f of [
        "claim",
        "location",
        "claim_type",
        "term",
        "evidence_owner",
        "permitted_qualification",
        "prohibited_absolute_wording",
      ]) {
        if (!isNonEmptyString(c[f])) push(`${at}: missing ${f}`);
      }
      if (isNonEmptyString(c.term) && !termIds.has(c.term)) {
        push(`${at}: term "${c.term}" is not a declared bannedTerm`);
      }
      const evidence = Array.isArray(c.evidence) ? c.evidence : null;
      if (evidence === null || evidence.length === 0) {
        push(`${at}: evidence must be a non-empty array`);
      }
      const review = parseIsoDate(c.review_date);
      const expiry = parseIsoDate(c.expiry_date);
      if (review === null) push(`${at}: missing/invalid review_date`);
      if (expiry === null) push(`${at}: missing/invalid expiry_date`);

      // Activeness: every cited evidence current, and not past expiry.
      let active = true;
      if (expiry === null || expiry < now) active = false;
      const evList = evidence ?? [];
      const stale = evList.filter((e) => !currentEvidence.has(e));
      if (stale.length > 0) {
        active = false;
        push(
          `${at}: cites evidence not current in the control register [${stale.join(", ")}] — ` +
            `permit is inactive (fail-closed)`,
        );
      }
      if (expiry !== null && expiry < now) {
        push(`${at}: expired at ${c.expiry_date} (fail-closed)`);
      }

      if (!active) continue;
      activePermits.push({ at, permit: c });
      const key = `${c.term} ${c.location}`;
      if (!activeByKey.has(key)) activeByKey.set(key, []);
      activeByKey.get(key).push(c);

      // (4) The hedge actually ships: prohibited wording absent, mustContain phrases present.
      const pageText = textByPath.get(c.location);
      if (pageText === undefined) {
        push(`${at}: location "${c.location}" is not a scanned public-copy source`);
      } else {
        const prohibited = normalise(c.prohibited_absolute_wording);
        if (prohibited && pageText.includes(prohibited)) {
          push(
            `${at}: prohibited_absolute_wording appears verbatim at ${c.location} — ` +
              `use the qualified form ("${c.permitted_qualification}")`,
          );
        }
        for (const phrase of Array.isArray(c.mustContain) ? c.mustContain : []) {
          if (isNonEmptyString(phrase) && !pageText.includes(normalise(phrase))) {
            push(
              `${at}: mustContain phrase not found at ${c.location} (the qualification the permit ` +
                `relies on is missing): "${normalise(phrase)}"`,
            );
          }
        }
      }
    }
  }

  // ── 1 — banned-wording scan: every hit needs an active covering permit. ───────────────────────
  const coveredKeys = new Set();
  for (const hit of scanCopy(sources, terms)) {
    const key = `${hit.term} ${hit.path}`;
    if (activeByKey.has(key)) {
      coveredKeys.add(key);
      continue;
    }
    const prefer = terms.find((t) => t.id === hit.term)?.prefer;
    push(
      `${hit.path}: ${hit.label} ("${hit.match}") is not covered by a current evidence-backed ` +
        `permit — soften it${prefer ? ` (prefer: ${prefer})` : ""} or add a permit to ` +
        `docs/legal/absolute-claims.json`,
    );
  }

  // ── 3 — no stale permit: an active permit whose location no longer contains its term. ─────────
  for (const key of activeByKey.keys()) {
    if (coveredKeys.has(key)) continue;
    const [term, location] = key.split(" ");
    push(
      `permittedClaims: an active permit for "${term}" at ${location} matches nothing there — ` +
        `stale register entry (remove it or fix the location)`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);

const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SELF_REL = "scripts/check-absolute-claims.mjs";
const SCAN_PREFIX = "apps/web/src/";
const SCAN_EXT = /\.(svelte|ts)$/;
// Generated projections are governed by their own registers/guards (e.g. the privacy claims
// projection) — scanning them would double-police wording that is already substantiated there.
const SKIP = /\.generated\./;
/** Externally-visible copy carriers outside apps/web/src that also assert product claims. */
const SCAN_EXTRA = [
  "README.md",
  "SECURITY.md",
  "apps/web/static/manifest.webmanifest",
  "apps/web/static/robots.txt",
  "apps/web/src/lib/privacy/third-party-services.json",
  "apps/web/scripts/generate-og.mjs",
];

function safeRead(relPath) {
  try {
    return readFileSync(rel(relPath), "utf8");
  } catch {
    return "";
  }
}

function gatherSources() {
  const listed = execFileSync("git", ["ls-files"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(
      (p) =>
        p.startsWith(SCAN_PREFIX) &&
        SCAN_EXT.test(p) &&
        !IS_TEST.test(p) &&
        !SKIP.test(p) &&
        p !== SELF_REL,
    );
  const all = [...new Set([...listed, ...SCAN_EXTRA])];
  return all.map((p) => ({ path: p, text: safeRead(p) }));
}

/** Evidence ids marked status:"current" anywhere in the control register. */
function currentEvidenceIds() {
  let register;
  try {
    register = JSON.parse(safeRead("docs/legal/control-register.json"));
  } catch {
    return new Set();
  }
  const ids = new Set();
  for (const c of Array.isArray(register.controls) ? register.controls : []) {
    for (const e of Array.isArray(c.evidence) ? c.evidence : []) {
      if (e && e.status === "current" && isNonEmptyString(e.id)) ids.add(e.id);
    }
  }
  return ids;
}

function main() {
  let register;
  try {
    register = JSON.parse(safeRead("docs/legal/absolute-claims.json"));
  } catch (err) {
    console.error(`::error::cannot read absolute-claims register: ${err.message}`);
    process.exit(1);
  }

  const result = verdict({
    register,
    sources: gatherSources(),
    currentEvidence: currentEvidenceIds(),
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::absolute-claims: ${e}`);
    console.error(`absolute claims: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    "absolute claims OK — no unpermitted absolute wording; every permit is current and evidence-backed",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
