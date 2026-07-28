#!/usr/bin/env node
/**
 * @fileoverview CI guard: versioned Terms-of-Use incorporation + internal consistency.
 *
 * Terms are incorporated by ACTIVE, VERSIONED click-acceptance at each consequential action (build a
 * plan, create a share link, print the s321D worksheet, contribute to research). This guard fails the
 * build if the mechanism or the wording could quietly stop matching what the code does. It proves
 * five things, all fail-closed:
 *
 *   1. VERSION BINDING — the single source of truth (apps/web/src/lib/terms/terms.ts TERMS_VERSION),
 *      the terms hash registry (docs/legal/terms-registry.json currentVersion) and the surfaced
 *      version on the public Terms page all agree. A bump in one place that is not mirrored fails.
 *
 *   2. IMMUTABLE HASH — the content-addressed hash of the CURRENT Terms wording matches the registry
 *      entry for the current version. If a version's wording is altered without bumping the version
 *      and adding a new registry entry, the recomputed hash no longer matches and the build fails
 *      (a version's text cannot silently change).
 *
 *   3. REQUIRED WORDING — every clause the implemented design depends on (shared links are read-only
 *      and cannot be revoked or made to expire; a plan cannot be built from a shared link; owner-only
 *      builder; local-only, never-transmitted s321D particulars; no organisation / foreign-campaigner
 *      use; no withdrawal of already-merged aggregates; separate data + map licences; preserved
 *      consumer guarantees) appears verbatim on the Terms page. Removing one fails the build.
 *
 *   4. NO CONTRADICTORY / OBSOLETE COPY — the Terms page contains no assertive wording that
 *      contradicts the implemented behaviour (links that expire or can be revoked; building a plan
 *      from a shared link; National Digital authorising the user's plan; authorisation particulars
 *      that are stored or transmitted; withdrawing a merged research contribution). The scan is
 *      negation-aware so the legitimate NEGATED clauses the Terms actually ship ("cannot be revoked",
 *      "never transmitted", "cannot be … withdrawn …") are not tripped.
 *
 *   5. ACCEPTANCE WIRING — the acceptance store records a VERSION + TIMESTAMP and treats acceptance
 *      of any other version as not-accepted (fail closed); the acceptance affirmation is a CAPACITY
 *      declaration (natural person, not an organisation, not a foreign campaigner); and every gated
 *      surface (card + survey) reads the versioned store and gates on `.accepted`.
 *
 * Pure decision logic is exported as verdict() (+ small pure helpers) for unit tests; the fs/git/CLI
 * plumbing only runs when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-terms.mjs             # check (CI default)
 *   node scripts/check-terms.mjs --write     # (re)compute + write the current version's hash
 *   node scripts/check-terms.mjs --print-hash
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Parse an ISO-8601 date (YYYY-MM-DD or full timestamp) to epoch ms, or null. */
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whitespace-normalise a blob of page copy so verbatim register wordings can be located regardless
 * of source indentation/line wraps. Strips HTML/Svelte tags and collapses runs of whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalisePageText(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, " ") // strip tags
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&") // unescape last so it cannot re-form another entity
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The canonical, content-addressed Terms BODY: the +page.svelte with its <script> and <style> blocks
 * removed (they are not the legal copy) and the remaining markup normalised to plain text. Hashing
 * this — rather than the raw file — means an incidental formatting change to the script/style is not a
 * wording change, while any change to the visible legal copy IS.
 *
 * @param {string} svelteSource
 * @returns {string}
 */
export function extractTermsBody(svelteSource) {
  if (typeof svelteSource !== "string") return "";
  const withoutBlocks = svelteSource
    .replace(/<script[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style[^>]*>/gi, " ");
  return normalisePageText(withoutBlocks);
}

/** SHA-256 (hex) over the canonical Terms body. */
export function hashTermsBody(svelteSource) {
  return createHash("sha256").update(extractTermsBody(svelteSource)).digest("hex");
}

// ── Contradiction engine ──────────────────────────────────────────────────────────────────────
//
// Each rule is an ASSERTIVE construction that would CONTRADICT the implemented behaviour. The Terms
// legitimately ship the NEGATED forms of most of these ("a shared link … cannot be revoked",
// "never transmitted", "cannot be identified, withdrawn or deleted"), so a match is ignored when a
// negation token appears earlier in the SAME clause (back to the nearest delimiter, capped).
const MAX_LOOKBACK = 90;
const CLAUSE_DELIM = /[.;:!?\n]/;
const NEGATION_RE =
  /\b(no|not|never|none|nothing|neither|nor|without|cannot|can['’]t|won['’]t|do(?:es)?n['’]t|isn['’]t|aren['’]t)\b|n['’]t\b/i;

const CONTRADICTIONS = [
  {
    label: "a share link that expires (shared links do not expire)",
    re: /\b(?:share\s+)?links?\s+(?:that\s+)?(?:will\s+|can\s+)?expires?\b|\bexpiry\s+(?:date\s+)?of\s+(?:the|a|your)\s+(?:share\s+)?link\b/gi,
  },
  {
    label: "a revocable share link (shared links cannot be revoked)",
    re: /\b(?:you\s+can\s+|we\s+can\s+|can\s+be\s+)(?:revoke|deactivate)\w*\b|\brevoke\s+(?:the|a|your|any)\s+(?:share\s+)?link\b|\blinks?\s+can\s+be\s+(?:revoked|deactivated|deleted)\b/gi,
  },
  {
    label: "building a plan from a shared link (shared is read-only)",
    re: /\bbuild(?:s|ing)?\s+(?:a\s+|your\s+|the\s+)?(?:voting\s+)?plan\s+from\s+(?:a\s+|the\s+|any\s+)?(?:shared\s+|received\s+)?link\b|\bcreate\s+(?:a\s+|your\s+)?(?:voting\s+)?plan\s+from\s+(?:a\s+|the\s+)link\b/gi,
  },
  {
    label: "National Digital authorising the user's plan (the user authorises it)",
    re: /\bnational\s+digital\s+authorises\s+your\b|\bwe\s+authorise\s+your\s+(?:voting\s+)?plan\b/gi,
  },
  {
    label: "authorisation particulars that are stored or transmitted (they are local-only)",
    re: /\b(?:your\s+)?(?:authorisation\s+)?(?:name\s+and\s+address|particulars)\s+(?:are|is|will\s+be)\s+(?:sent|transmitted|uploaded|stored|saved)\b|\bwe\s+(?:store|save|collect|transmit|upload)\s+your\s+(?:name\s+and\s+address|authorisation)\b/gi,
  },
  {
    label: "withdrawing a merged research contribution (merged aggregates cannot be withdrawn)",
    re: /\byou\s+can\s+withdraw\s+your\s+(?:research\s+)?contribution\b|\bwithdraw\s+(?:your\s+|a\s+)(?:merged\s+|research\s+)?(?:contribution|aggregate)\b|\bdelete\s+your\s+(?:research\s+)?contribution\b/gi,
  },
];

/**
 * Scan the Terms copy for assertive constructions that contradict the implemented behaviour,
 * negation-aware.
 *
 * @param {string} raw  the raw Terms +page.svelte source
 * @returns {{ label: string, match: string }[]}
 */
export function scanContradictions(raw) {
  if (typeof raw !== "string" || raw.length === 0) return [];
  // Scan the visible copy only (drop script/style, keep it as text with clause delimiters intact).
  const text = normalisePageText(
    raw
      .replace(/<script[\s\S]*?<\/script[^>]*>/gi, " ")
      .replace(/<style[\s\S]*?<\/style[^>]*>/gi, " "),
  );
  const hits = [];
  for (const { label, re } of CONTRADICTIONS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const capped = text.slice(Math.max(0, m.index - MAX_LOOKBACK), m.index);
      let delim = -1;
      for (let i = capped.length - 1; i >= 0; i--) {
        if (CLAUSE_DELIM.test(capped[i])) {
          delim = i;
          break;
        }
      }
      const clause = delim === -1 ? capped : capped.slice(delim + 1);
      if (NEGATION_RE.test(clause)) continue; // legitimate negated/disclaiming usage
      hits.push({ label, match: m[0].replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

/**
 * Decide whether the Terms incorporation posture is clean.
 *
 * @param {{
 *   registry?: unknown,
 *   termsSource?: string,
 *   termsVersion?: string | null,
 *   acceptanceLabel?: string | null,
 *   storeSource?: string,
 *   wiringSources?: { path: string, text: string }[],
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const termsSource = typeof input.termsSource === "string" ? input.termsSource : "";
  const body = extractTermsBody(termsSource);
  const termsVersion = input.termsVersion ?? null;

  // ── Registry structure ──────────────────────────────────────────────────────────────────────
  const registry = input.registry;
  if (typeof registry !== "object" || registry === null || Array.isArray(registry)) {
    push("registry: not a JSON object");
    return { ok: errors.length === 0, errors };
  }
  if (registry.schemaVersion !== 1) {
    push(`registry.schemaVersion: expected 1, got ${JSON.stringify(registry.schemaVersion)}`);
  }
  if (!isNonEmptyString(registry.currentVersion)) push("registry.currentVersion: missing");

  const versions = Array.isArray(registry.versions) ? registry.versions : null;
  if (versions === null) {
    push("registry.versions: not an array");
  } else if (versions.length === 0) {
    push("registry.versions: at least one recorded version is required");
  }
  const byVersion = new Map();
  for (const [i, v] of (versions ?? []).entries()) {
    const at = `registry.versions[${i}]${v && v.version ? ` (${v.version})` : ""}`;
    if (!v || typeof v !== "object") {
      push(`${at}: not an object`);
      continue;
    }
    if (!isNonEmptyString(v.version)) push(`${at}: missing version`);
    if (!/^[0-9a-f]{64}$/.test(String(v.sha256))) push(`${at}: sha256 must be 64 hex chars`);
    if (parseIsoDate(v.effectiveDate) === null) push(`${at}: missing/invalid effectiveDate`);
    if (isNonEmptyString(v.version)) byVersion.set(v.version, v);
  }

  // ── 1 — version binding (leaf ↔ registry ↔ page) ────────────────────────────────────────────
  if (termsVersion !== null) {
    if (!isNonEmptyString(termsVersion)) {
      push("TERMS_VERSION: could not read the version from terms/terms.ts");
    } else {
      if (registry.currentVersion !== termsVersion) {
        push(
          `registry.currentVersion "${registry.currentVersion}" != TERMS_VERSION "${termsVersion}" — bump both together`,
        );
      }
      if (!byVersion.has(termsVersion)) {
        push(`registry.versions: no entry for the current version "${termsVersion}"`);
      }
      // The version must be surfaced on the public page, so a bump cannot ship without the page
      // reflecting it. The page interpolates the single-source const (`Terms version {TERMS_VERSION}`)
      // rather than a hard-coded literal, so the surfaced value is the leaf value by construction; a
      // rendered page (the literal version) is also accepted so this is testable off a built page.
      if (
        !body.includes("Terms version {TERMS_VERSION}") &&
        !body.includes(`Terms version ${termsVersion}`)
      ) {
        push(
          `the Terms page does not surface the Terms version (expected "Terms version {TERMS_VERSION}") — version bump not reflected on the public page`,
        );
      }
    }
  }

  // ── 2 — immutable hash for the current version ──────────────────────────────────────────────
  if (isNonEmptyString(registry.currentVersion) && termsSource) {
    const entry = byVersion.get(registry.currentVersion);
    if (entry && /^[0-9a-f]{64}$/.test(String(entry.sha256))) {
      const computed = hashTermsBody(termsSource);
      if (computed !== entry.sha256) {
        push(
          `the current Terms wording hashes to ${computed.slice(0, 12)}… but the registry records ` +
            `${String(entry.sha256).slice(0, 12)}… for version ${registry.currentVersion} — the ` +
            `wording changed: bump TERMS_VERSION and add a new registry entry (a version's text ` +
            `cannot silently change), or run --write if this is that new version`,
        );
      }
    }
  }

  // ── 3 — required wording present verbatim on the page ────────────────────────────────────────
  const required = Array.isArray(registry.requiredWording) ? registry.requiredWording : null;
  if (required === null) {
    push("registry.requiredWording: not an array");
  } else if (required.length === 0) {
    push("registry.requiredWording: at least one bound clause is required");
  } else {
    for (const [i, w] of required.entries()) {
      const at = `requiredWording[${i}]${w && w.id ? ` (${w.id})` : ""}`;
      if (!w || typeof w !== "object" || !isNonEmptyString(w.text)) {
        push(`${at}: missing text`);
        continue;
      }
      const needle = normalisePageText(w.text);
      if (!body.includes(needle)) {
        push(
          `${at}: required clause not found on the Terms page (removed or reworded): "${needle}"`,
        );
      }
    }
  }

  // ── 4 — no contradictory / obsolete copy ────────────────────────────────────────────────────
  for (const hit of scanContradictions(termsSource)) {
    push(
      `Terms page contains ${hit.label} ("${hit.match}") — contradicts the implemented behaviour`,
    );
  }

  // ── 5 — acceptance wiring ───────────────────────────────────────────────────────────────────
  const acceptanceLabel = input.acceptanceLabel ?? null;
  if (acceptanceLabel !== null) {
    const l = String(acceptanceLabel).toLowerCase();
    for (const term of ["natural person", "organisation", "foreign campaigner"]) {
      if (!l.includes(term)) {
        push(
          `TERMS_ACCEPTANCE_LABEL: missing the "${term}" capacity declaration — acceptance must ` +
            `affirm individual (natural-person) use and disclaim organisation / foreign-campaigner use`,
        );
      }
    }
  }

  const storeSource = input.storeSource ?? null;
  if (storeSource !== null) {
    if (typeof storeSource !== "string" || storeSource.length === 0) {
      push("acceptance store: could not read terms.svelte.ts (fail closed)");
    } else {
      if (!/export\s+const\s+termsAcceptance\b/.test(storeSource)) {
        push("acceptance store: must export the termsAcceptance singleton the gates depend on");
      }
      if (!/TERMS_VERSION/.test(storeSource)) {
        push("acceptance store: must bind acceptance to TERMS_VERSION (versioned acceptance)");
      }
      if (!/acceptedAt/.test(storeSource)) {
        push("acceptance store: must record an acceptance timestamp (acceptedAt)");
      }
      // `accepted` must compare the stored version to the CURRENT version (fail closed on a bump).
      if (!/version\s*===\s*TERMS_VERSION/.test(storeSource)) {
        push(
          "acceptance store: `accepted` must be true only when the stored version === TERMS_VERSION (fail closed)",
        );
      }
    }
  }

  for (const src of Array.isArray(input.wiringSources) ? input.wiringSources : []) {
    if (!src || typeof src.text !== "string" || src.text.length === 0) {
      push(`acceptance wiring: could not read ${src?.path ?? "a gated surface"} (fail closed)`);
      continue;
    }
    if (!/\btermsAcceptance\b/.test(src.text)) {
      push(
        `${src.path}: does not reference the termsAcceptance store — this gated action must require a Terms acceptance`,
      );
    }
    if (!/termsAcceptance\.accepted\b/.test(src.text)) {
      push(
        `${src.path}: does not gate on termsAcceptance.accepted — a consequential action must fail closed without a current-version acceptance`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const ROOT = new URL("../", import.meta.url);
const rel = (p) => new URL(p, ROOT);

// The legal copy itself, which is a shared component rather than the route: the same body is
// rendered by /terms AND by the dialog a policy link raises over the current page, so that there is
// exactly one copy of the text a reader is asked to accept. Hash and scan the copy where it lives —
// pointed at the route, this guard would content-address a file that contains only a wrapper.
const TERMS_PAGE = "apps/web/src/lib/content/TermsContent.svelte";
const LEAF = "apps/web/src/lib/terms/terms.ts";
const STORE = "apps/web/src/lib/terms.svelte.ts";
const REGISTRY = "docs/legal/terms-registry.json";
const WIRING = ["apps/web/src/routes/card/+page.svelte", "apps/web/src/routes/survey/+page.svelte"];

function read(relPath) {
  return readFileSync(rel(relPath), "utf8");
}
function safeRead(relPath) {
  try {
    return read(relPath);
  } catch {
    return "";
  }
}

/** Read a plain exported string const from the leaf module without a TS import. */
function leafConst(src, name) {
  // Handles both single-line and concatenated ("a" + "b") literals.
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([\\s\\S]*?);`).exec(src);
  if (!m) return null;
  const literals = m[1].match(/"([^"]*)"|'([^']*)'/g);
  if (!literals) return null;
  return literals.map((s) => s.slice(1, -1)).join("");
}

function main() {
  const leafSrc = safeRead(LEAF);
  const termsVersion = leafConst(leafSrc, "TERMS_VERSION");
  const termsSource = safeRead(TERMS_PAGE);

  if (process.argv.includes("--print-hash")) {
    process.stdout.write(`${hashTermsBody(termsSource)}\n`);
    return;
  }

  let registry;
  try {
    registry = JSON.parse(read(REGISTRY));
  } catch (err) {
    if (!process.argv.includes("--write")) {
      console.error(`::error::cannot read terms registry: ${err.message}`);
      process.exit(1);
    }
    registry = {
      schemaVersion: 1,
      currentVersion: termsVersion,
      versions: [],
      requiredWording: [],
    };
  }

  if (process.argv.includes("--write")) {
    // (Re)compute the CURRENT version's hash and write it, preserving prior versions.
    const hash = hashTermsBody(termsSource);
    registry.currentVersion = termsVersion;
    const versions = Array.isArray(registry.versions) ? registry.versions : [];
    const existing = versions.find((v) => v && v.version === termsVersion);
    const today = new Date().toISOString().slice(0, 10);
    if (existing) {
      existing.sha256 = hash;
      if (!existing.effectiveDate) existing.effectiveDate = today;
    } else {
      versions.push({ version: termsVersion, sha256: hash, effectiveDate: today });
    }
    registry.versions = versions;
    writeFileSync(rel(REGISTRY), `${JSON.stringify(registry, null, 2)}\n`);
    console.info(`terms registry written: ${termsVersion} → ${hash.slice(0, 12)}…`);
    return;
  }

  const result = verdict({
    registry,
    termsSource,
    termsVersion,
    acceptanceLabel: leafConst(leafSrc, "TERMS_ACCEPTANCE_LABEL"),
    storeSource: safeRead(STORE),
    wiringSources: WIRING.map((p) => ({ path: p, text: safeRead(p) })),
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::terms: ${e}`);
    console.error(`terms incorporation: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    "terms OK — version bound (leaf ↔ registry ↔ page), wording hash immutable, required clauses present, no contradictory copy, acceptance wired",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
