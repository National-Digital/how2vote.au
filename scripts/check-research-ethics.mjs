#!/usr/bin/env node
/**
 * @fileoverview CI guard: research ethics + statistical practice.
 *
 * The register (docs/research/standards-register.json) is the single machine-readable map from each
 * external standard the research programme is run against — the ABS quality + confidentiality
 * standards, the National Statement on Ethical Conduct in Human Research 2025, and (because
 * Indigenous status IS collected) the AIATSIS Code of Ethics — to the control that implements it and
 * its CI test IDs + external-evidence IDs. It also records the invariants that make the research
 * ethical-by-construction and are enforced in code.
 *
 * This guard proves, all fail-closed:
 *
 *   1. REGISTER STRUCTURE + EVIDENCE RATCHET — the register is well-formed; every standard carries a
 *      control, at least one test id, and a recognised status; the four required standard families
 *      are present. Evidence is well-formed and any "current" evidence needs a reviewer + approval +
 *      future expiry ("expired" always fails). A standard may sit at "pending-evidence" while its
 *      external determination is outstanding — but if it is marked "implemented", ALL its evidence
 *      must be current/not-required. So the ethics + Indigenous-governance determinations correctly
 *      stay PENDING (the control is partial-passing) and cannot be silently marked done.
 *
 *   2. AIATSIS APPLICABILITY — whether Indigenous status is collected is derived from the survey
 *      source (a SENSITIVE 'indigenous' question) and must match the register's declared
 *      indigenousStatusCollected. When it is collected, the AIATSIS standard must be present, scoped
 *      to "indigenous-status-collected", and carry its Indigenous data-governance evidence.
 *
 *   3. PREFER-NOT-TO-SAY ON EVERY SENSITIVE ITEM — the register's sensitiveItems set must equal
 *      SENSITIVE_DIMENSIONS in BOTH apps/web/src/lib/survey.ts and
 *      packages/data-pipeline/src/stats.ts (keeps the three in step), every sensitive item must be a
 *      real survey question, and the survey page must still render the single generic
 *      prefer-not-to-say control that stores nothing — so it applies to every item by construction.
 *
 *   4. VOLUNTARINESS — research participation is never a condition of core use: the survey gate must
 *      offer an un-gated skip-to-core action (goto the core /card output) that is not disabled by the
 *      consent tick.
 *
 *   5. PAGE BINDING — every insightsWarnings string appears verbatim (whitespace-normalised, tags
 *      stripped) on the Insights page, and every requiredStatements string appears on its declared
 *      page (privacy / survey / terms). CI fails if the public copy drifts from the register.
 *
 *   6. CONSENT-VERSION BINDING — the register's consentVersion equals RESEARCH_CONSENT_VERSION in
 *      survey.ts, so a consent-wording bump forces the register to be revisited.
 *
 * Pure decision logic is exported as verdict() (+ small pure helpers) for unit tests; the fs/CLI
 * plumbing only runs when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-research-ethics.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REQUIRED_STANDARDS = [
  "ABS-QUALITY",
  "ABS-CONFIDENTIALITY",
  "NATIONAL-STATEMENT-2025",
  "AIATSIS-CODE",
];
const STANDARD_STATUS = ["implemented", "pending-evidence"];
const EVIDENCE_STATUS = ["pending", "current", "expired", "not-required"];
const APPLIES_WHEN = ["always", "indigenous-status-collected"];

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Escape a string for literal use inside a RegExp. */
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
 * Whitespace-normalise a blob of page copy so verbatim register wordings can be located regardless
 * of source indentation, line wraps or markup. Strips HTML/Svelte tags and collapses whitespace.
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
    .replace(/&amp;/g, "&") // unescape last so it cannot re-form another entity
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the string members of a `new Set([... ])` initialiser for the named const from a TS/JS
 * source. Returns a sorted array (or null if the declaration isn't found).
 *
 * @param {string} source
 * @param {string} name
 * @returns {string[] | null}
 */
export function extractStringSet(source, name) {
  if (typeof source !== "string") return null;
  const re = new RegExp(`${name}[^=]*=\\s*new Set\\(\\s*\\[([\\s\\S]*?)\\]`, "m");
  const m = re.exec(source);
  if (!m) return null;
  const members = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  return members.slice().sort();
}

/**
 * Extract every survey question `key: "..."` from survey.ts (the SURVEY array). Returns a set of
 * question keys.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
export function extractSurveyKeys(source) {
  if (typeof source !== "string") return new Set();
  return new Set([...source.matchAll(/\bkey:\s*["']([a-z_]+)["']/g)].map((x) => x[1]));
}

/** @param {string} source */
export function extractConsentVersion(source) {
  if (typeof source !== "string") return null;
  const m = /RESEARCH_CONSENT_VERSION\s*=\s*["']([^"']+)["']/.exec(source);
  return m ? m[1] : null;
}

const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Decide whether the research-ethics posture is clean.
 *
 * @param {{
 *   register?: unknown,
 *   surveySensitive?: string[] | null,
 *   statsSensitive?: string[] | null,
 *   surveyKeys?: Set<string> | string[] | null,
 *   consentVersion?: string | null,
 *   surveyPageText?: string,
 *   pages?: Record<string, string>,
 *   now?: number,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const now = input.now ?? Date.now();

  const register = input.register;
  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    return { ok: false, errors: ["register: not a JSON object"] };
  }
  if (register.schemaVersion !== 1) {
    push(`register.schemaVersion: expected 1, got ${JSON.stringify(register.schemaVersion)}`);
  }

  // ── 3 — prefer-not-to-say on every sensitive item ───────────────────────────────────────────
  const pnts = register.preferNotToSay;
  const registerSensitive =
    pnts && Array.isArray(pnts.sensitiveItems) ? pnts.sensitiveItems.slice().sort() : null;
  if (typeof pnts !== "object" || pnts === null) {
    push("register.preferNotToSay: missing");
  } else {
    if (pnts.appliesToEverySensitiveItem !== true) {
      push("preferNotToSay.appliesToEverySensitiveItem must be true (ethics guarantee)");
    }
    if (registerSensitive === null || registerSensitive.length === 0) {
      push("preferNotToSay.sensitiveItems: must be a non-empty array");
    }
  }

  // The register's sensitive set must equal SENSITIVE_DIMENSIONS in both survey.ts and stats.ts.
  const surveySensitive = Array.isArray(input.surveySensitive)
    ? input.surveySensitive.slice().sort()
    : null;
  const statsSensitive = Array.isArray(input.statsSensitive)
    ? input.statsSensitive.slice().sort()
    : null;
  if (registerSensitive) {
    if (surveySensitive === null) {
      push("could not read SENSITIVE_DIMENSIONS from survey.ts");
    } else if (!sameSet(registerSensitive, surveySensitive)) {
      push(
        `preferNotToSay.sensitiveItems ≠ survey.ts SENSITIVE_DIMENSIONS ` +
          `(register [${registerSensitive.join(", ")}] vs survey [${surveySensitive.join(", ")}])`,
      );
    }
    if (statsSensitive === null) {
      push("could not read SENSITIVE_DIMENSIONS from stats.ts");
    } else if (!sameSet(registerSensitive, statsSensitive)) {
      push(
        `preferNotToSay.sensitiveItems ≠ stats.ts SENSITIVE_DIMENSIONS ` +
          `(register [${registerSensitive.join(", ")}] vs stats [${statsSensitive.join(", ")}])`,
      );
    }
  }

  // Every sensitive item must be a real survey question key.
  const surveyKeys =
    input.surveyKeys instanceof Set
      ? input.surveyKeys
      : new Set(Array.isArray(input.surveyKeys) ? input.surveyKeys : []);
  if (registerSensitive && surveyKeys.size > 0) {
    for (const k of registerSensitive) {
      if (!surveyKeys.has(k)) push(`sensitive item "${k}" is not a survey question key`);
    }
  }

  // The survey page must render the single generic prefer-not-to-say control that stores nothing,
  // AFTER the per-question options loop (so it applies to whatever question is shown — every item).
  const surveyPage =
    input.surveyPageText ?? input.pages?.["apps/web/src/routes/survey/+page.svelte"];
  if (isNonEmptyString(surveyPage)) {
    if (!/choose\(\s*current\.key\s*,\s*["']["']\s*\)/.test(surveyPage)) {
      push(
        'survey page: generic prefer-not-to-say control choose(current.key, "") not found — cannot ' +
          "prove prefer-not-to-say is on every item",
      );
    }
    if (!/prefer not to say/i.test(surveyPage)) {
      push('survey page: visible "Prefer not to say" label not found');
    }
    // Structural: the prefer control must sit outside (after) the options {#each} loop.
    const eachClose = surveyPage.lastIndexOf("{/each}");
    const prefer = surveyPage.search(/choose\(\s*current\.key\s*,\s*["']["']\s*\)/);
    if (eachClose !== -1 && prefer !== -1 && prefer < eachClose) {
      push("survey page: prefer-not-to-say control is inside the options loop, not per-question");
    }
  } else {
    push("survey page: source not available to verify prefer-not-to-say");
  }

  // ── 4 — voluntariness: research never a condition of core use ────────────────────────────────
  const vol = register.voluntariness;
  if (typeof vol !== "object" || vol === null) {
    push("register.voluntariness: missing");
  } else {
    if (vol.researchNeverRequiredForCoreUse !== true) {
      push("voluntariness.researchNeverRequiredForCoreUse must be true");
    }
    if (!isNonEmptyString(vol.skipRoute)) push("voluntariness.skipRoute: missing");
  }
  if (isNonEmptyString(surveyPage)) {
    const skipRoute = (vol && vol.skipRoute) || "/card";
    // A skip() that navigates to the core output, and a skip button that is NOT consent-gated.
    const skipsToCore = new RegExp(
      `function skip\\([^)]*\\)[^}]*goto\\(\\s*["']${escapeRegExp(skipRoute)}["']`,
    ).test(surveyPage);
    if (!skipsToCore) {
      push(`survey page: no un-gated skip() navigating to the core output ${skipRoute}`);
    }
    // The skip button (onclick={skip}) must not carry a disabled binding on the same element.
    const skipBtn = /<button[^>]*onclick=\{skip\}[^>]*>/.exec(surveyPage);
    if (!skipBtn) {
      push("survey page: no Skip button wired to skip()");
    } else if (/disabled/.test(skipBtn[0])) {
      push("survey page: the Skip button is disabled/gated — core use must not require research");
    }
  }

  // ── 6 — consent-version binding ──────────────────────────────────────────────────────────────
  if (!isNonEmptyString(register.consentVersion)) {
    push("register.consentVersion: missing");
  } else if (
    isNonEmptyString(input.consentVersion) &&
    register.consentVersion !== input.consentVersion
  ) {
    push(
      `register.consentVersion "${register.consentVersion}" ≠ survey.ts RESEARCH_CONSENT_VERSION ` +
        `"${input.consentVersion}" — consent wording changed; revisit the standards register`,
    );
  }

  // ── 2 — AIATSIS applicability (derived from the survey) ──────────────────────────────────────
  const indigenousCollected =
    surveyKeys.has("indigenous") && (surveySensitive?.includes("indigenous") ?? false);
  if (typeof register.indigenousStatusCollected !== "boolean") {
    push("register.indigenousStatusCollected: must be a boolean");
  } else if (register.indigenousStatusCollected !== indigenousCollected) {
    push(
      `register.indigenousStatusCollected (${register.indigenousStatusCollected}) does not match the ` +
        `survey (Indigenous status collected: ${indigenousCollected})`,
    );
  }

  // ── 1 + 2 — standards structure, required families, evidence ratchet ─────────────────────────
  const standards = Array.isArray(register.standards) ? register.standards : null;
  if (standards === null) {
    push("register.standards: not an array");
    return { ok: errors.length === 0, errors };
  }
  const byId = new Map();
  for (const s of standards) {
    const id = s && typeof s === "object" ? s.id : undefined;
    if (isNonEmptyString(id)) byId.set(id, s);
  }
  for (const id of REQUIRED_STANDARDS) {
    if (!byId.has(id)) push(`standards: missing required standard "${id}"`);
  }

  for (const s of standards) {
    if (!s || typeof s !== "object" || !isNonEmptyString(s.id)) {
      push("standard: missing id");
      continue;
    }
    const at = `standard ${s.id}`;
    if (!isNonEmptyString(s.name)) push(`${at}: missing name`);
    if (!isNonEmptyString(s.publisher)) push(`${at}: missing publisher`);
    if (!isNonEmptyString(s.reference)) push(`${at}: missing reference`);
    if (!isNonEmptyString(s.control)) push(`${at}: missing control (what implements it)`);
    if (!APPLIES_WHEN.includes(s.appliesWhen)) {
      push(`${at}: appliesWhen must be one of ${APPLIES_WHEN.join(", ")}`);
    }
    if (!STANDARD_STATUS.includes(s.status)) {
      push(`${at}: status must be one of ${STANDARD_STATUS.join(", ")}`);
    }
    const tests = Array.isArray(s.tests) ? s.tests : [];
    if (tests.length === 0) push(`${at}: needs at least one test id`);
    for (const [i, t] of tests.entries()) {
      if (!t || typeof t !== "object" || !isNonEmptyString(t.id))
        push(`${at} test[${i}]: missing id`);
      else if (!isNonEmptyString(t.owner)) push(`${at} test[${i}] (${t.id}): missing owner`);
    }

    const evidence = Array.isArray(s.evidence) ? s.evidence : null;
    if (evidence === null) {
      push(`${at}: evidence must be an array`);
    } else {
      for (const [i, e] of evidence.entries()) {
        const eat = `${at} evidence[${i}]`;
        if (!e || typeof e !== "object") {
          push(`${eat}: not an object`);
          continue;
        }
        if (!isNonEmptyString(e.id)) push(`${eat}: missing id`);
        if (!isNonEmptyString(e.description)) push(`${eat}: missing description`);
        if (!EVIDENCE_STATUS.includes(e.status)) {
          push(`${eat}: status must be one of ${EVIDENCE_STATUS.join(", ")}`);
        }
        if (e.status === "expired")
          push(`${eat}: evidence is expired and must be renewed (fail-closed)`);
        if (e.status === "current") {
          if (!isNonEmptyString(e.reviewer)) push(`${eat}: current evidence needs a reviewer`);
          const approved = parseIsoDate(e.approvedAt);
          const expires = parseIsoDate(e.expiresAt);
          if (approved === null) push(`${eat}: current evidence needs a valid approvedAt`);
          if (expires === null) push(`${eat}: current evidence needs a valid expiresAt`);
          else if (expires < now)
            push(`${eat}: current evidence expired at ${e.expiresAt} (fail-closed)`);
        }
      }
      // Evidence ratchet: an "implemented" standard cannot ride on pending/expired evidence.
      if (s.status === "implemented") {
        for (const [i, e] of evidence.entries()) {
          if (e && e.status !== "current" && e.status !== "not-required") {
            push(
              `${at}: status "implemented" requires all evidence current/not-required, but ` +
                `evidence[${i}] is "${e.status}"`,
            );
          }
        }
      }
    }
  }

  // AIATSIS specifics when Indigenous status is collected.
  if (indigenousCollected) {
    const aiatsis = byId.get("AIATSIS-CODE");
    if (aiatsis) {
      if (aiatsis.appliesWhen !== "indigenous-status-collected") {
        push('AIATSIS-CODE: appliesWhen must be "indigenous-status-collected"');
      }
      const ev = Array.isArray(aiatsis.evidence) ? aiatsis.evidence : [];
      if (ev.length === 0) {
        push(
          "AIATSIS-CODE: Indigenous status is collected, so an Indigenous data-governance evidence row is required",
        );
      }
    }
  }

  // ── 5 — page binding (Insights warnings + required statements) ───────────────────────────────
  const pages = input.pages ?? {};
  const normalisedCache = new Map();
  const pageText = (path) => {
    if (!normalisedCache.has(path)) {
      const raw =
        path === "apps/web/src/routes/survey/+page.svelte" &&
        typeof input.surveyPageText === "string"
          ? input.surveyPageText
          : pages[path];
      normalisedCache.set(path, normalisePageText(raw ?? ""));
    }
    return normalisedCache.get(path);
  };

  const checkStatement = (label, rec) => {
    if (!rec || typeof rec !== "object") {
      push(`${label}: not an object`);
      return;
    }
    if (!isNonEmptyString(rec.text)) {
      push(`${label}: missing text`);
      return;
    }
    if (!isNonEmptyString(rec.page)) {
      push(`${label}: missing page`);
      return;
    }
    const haystack = pageText(rec.page);
    if (!haystack) {
      push(`${label}: page "${rec.page}" not available`);
      return;
    }
    if (!haystack.includes(normalisePageText(rec.text))) {
      push(
        `${label}: text not found on ${rec.page} (register/page drift): "${normalisePageText(rec.text)}"`,
      );
    }
  };

  const warnings = Array.isArray(register.insightsWarnings) ? register.insightsWarnings : null;
  if (warnings === null || warnings.length === 0) {
    push(
      "register.insightsWarnings: at least one sample-size/non-representativeness warning required",
    );
  } else {
    for (const [i, w] of warnings.entries())
      checkStatement(`insightsWarnings[${i}]${w?.id ? ` (${w.id})` : ""}`, w);
  }

  const statements = Array.isArray(register.requiredStatements)
    ? register.requiredStatements
    : null;
  if (statements === null || statements.length === 0) {
    push("register.requiredStatements: at least one consent statement required");
  } else {
    for (const [i, st] of statements.entries())
      checkStatement(`requiredStatements[${i}]${st?.id ? ` (${st.id})` : ""}`, st);
    // Every required consent concern must be covered by at least one bound statement.
    const concerns = new Set(statements.map((s) => s && s.concern).filter(isNonEmptyString));
    for (const c of [
      "voluntary",
      "aggregate-only",
      "no-withdrawal",
      "indefinite-retention",
      "prefer-not-to-say",
    ]) {
      if (!concerns.has(c)) push(`requiredStatements: no statement covers the "${c}" concern`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);

function safeRead(relPath) {
  try {
    return readFileSync(rel(relPath), "utf8");
  } catch {
    return "";
  }
}

// Where the disclosure copy actually LIVES. The privacy notice and the terms are shared components
// rather than route files: the same body is rendered by the route and by the dialog a policy link
// raises over the current page, so there is exactly one copy of each. Pointed at the routes, this
// check would scan two files that now contain only a wrapper and pass on an empty string — the
// quietest possible way for a disclosure requirement to stop being enforced.
const PAGE_PATHS = [
  "apps/web/src/routes/insights/+page.svelte",
  "apps/web/src/lib/content/PrivacyContent.svelte",
  "apps/web/src/routes/survey/+page.svelte",
  "apps/web/src/lib/content/TermsContent.svelte",
];

function main() {
  let register;
  try {
    register = JSON.parse(safeRead("docs/research/standards-register.json"));
  } catch (err) {
    console.error(`::error::cannot read standards register: ${err.message}`);
    process.exit(1);
  }

  // The SURVEY array + SENSITIVE_DIMENSIONS moved to the survey-questions leaf module (so the
  // Pages Functions can bundle them); survey.ts only re-exports them since.
  const surveySrc = safeRead("apps/web/src/lib/survey-questions.ts");
  const statsSrc = safeRead("packages/data-pipeline/src/stats.ts");
  // RESEARCH_CONSENT_VERSION is defined in research/consent.ts (survey.ts only re-exports it), so
  // read the binding from its definition site — otherwise the check silently no-ops.
  const consentSrc = safeRead("apps/web/src/lib/research/consent.ts");
  const pages = Object.fromEntries(PAGE_PATHS.map((p) => [p, safeRead(p)]));

  const result = verdict({
    register,
    surveySensitive: extractStringSet(surveySrc, "SENSITIVE_DIMENSIONS"),
    statsSensitive: extractStringSet(statsSrc, "SENSITIVE_DIMENSIONS"),
    surveyKeys: extractSurveyKeys(surveySrc),
    consentVersion: extractConsentVersion(consentSrc),
    surveyPageText: pages["apps/web/src/routes/survey/+page.svelte"],
    pages,
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::research-ethics: ${e}`);
    console.error(`research ethics: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    "research ethics OK — standards register bound to survey/stats/pages; ethics + Indigenous-governance determinations recorded",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
