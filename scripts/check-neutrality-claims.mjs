#!/usr/bin/env node
/**
 * @fileoverview CI guard: neutrality claims register + methodology binding. This is the CLAIMS/COPY
 * arm of the neutrality lint; the monochrome-palette
 * arm lives in apps/web/scripts/neutrality-check.mjs (run after the build). Together they enforce the
 * project's neutrality guarantee: no hue can read as party allegiance (palette arm) AND no wording,
 * markup or data selection can read as advice, endorsement or a preselected ballot (this arm).
 *
 * The register (docs/legal/neutrality-claims.json) is the single machine-readable source of the
 * qualified neutrality wording and the versioned proposition-selection rationale + scoring spec.
 * Every claim maps wording → substantiating control → test IDs → evidence IDs → approver/expiry.
 *
 * This guard proves four things (all fail-closed):
 *
 *   1. BANNED PHRASES — the public copy contains no ABSOLUTE neutrality/accuracy claim
 *      ("completely neutral", "100% unbiased", "always accurate", …), no RECOMMENDATION verb
 *      ("we recommend", "you should vote for", "vote 1", "recommended preference", …) and no
 *      DEFAULT/PRESELECTED-RANK wording ("pre-filled", "pre-selected", "default ranking", …). The
 *      scan is negation-aware: the legitimate NEGATED disclaimers the product actually ships
 *      ("nothing is ranked", "How2Vote never suggests who to put first", "not a recommended
 *      preference", "nothing is pre-filled") are recognised and never tripped.
 *
 *   2. METHODOLOGY BINDING — every register `wording` string, and every proposition-selection
 *      `pageWording` string, appears verbatim (whitespace-normalised, tags stripped) on the public
 *      methodology page. CI fails if the page copy drifts from the register in either direction.
 *
 *   3. PROPOSITION-SELECTION BINDING (unexplained proposition changes) — the register records a
 *      `boundManifestHash` over the set + wording of the propositions actually shipped in the built
 *      datasets. If the propositions are added/removed/re-worded without re-versioning the rationale
 *      and updating the hash, the build fails: a proposition change must be explained, not silent.
 *
 *   4. SCORING-SPEC / METHOD-VERSION BINDING — the register's recorded methodology version matches
 *      @how2vote/data-schema's METHODOLOGY_VERSION, so the published scoring spec cannot lag a method
 *      bump. The register itself must be structurally well-formed (approver + future expiry on every
 *      claim and on the proposition-selection record).
 *
 * Pure decision logic is exported as verdict() (+ small pure helpers) for unit tests; the fs/git/CLI
 * plumbing only runs when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-neutrality-claims.mjs
 *   node scripts/check-neutrality-claims.mjs --print-hash   # print the current proposition hash
 */

import { createHash } from "node:crypto";
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
function parseIsoDate(v) {
  if (!isNonEmptyString(v)) return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

// ── Banned-phrase engine ──────────────────────────────────────────────────────────────────────
//
// Each rule is an ASSERTIVE construction. The product legitimately ships the NEGATED forms of most
// of these ("nothing is ranked", "never suggests …", "not a recommended preference"), so a match is
// ignored when a negation token appears anywhere earlier in the SAME clause (back to the nearest
// clause delimiter, capped at MAX_LOOKBACK so a negation in an unrelated earlier clause can't
// launder a violation). The rules are deliberately narrow: bare "vote for" / "ranked" / "neutral"
// are NOT banned (they appear constantly in factual and interrogative copy — "Who should I vote
// for?", "candidates are never ranked", "factual and neutral by construction"). Only directive or
// absolute constructions are.
const MAX_LOOKBACK = 80;
const CLAUSE_DELIM = /[.;!?\n]/;
const NEGATION_RE =
  /\b(no|not|never|none|nothing|neither|nor|without|cannot|can['’]t|won['’]t|do(?:es)?n['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\b|n['’]t\b/i;

const BANNED = [
  {
    label: "an absolute neutrality/accuracy claim",
    // intensifier + neutrality/accuracy adjective.
    re: /\b(completely|totally|100\s?%|perfectly|entirely|absolutely|utterly|fully|wholly|guaranteed)\s+(neutral|unbiased|objective|impartial|accurate|balanced|fair|independent|non-partisan|nonpartisan|infallible)\b/gi,
  },
  {
    label: "an absolute accuracy claim",
    // "always/100%/guaranteed accurate", "never wrong/mistaken", "infallible". Deliberately narrow:
    // "the same answers always produce the same result" (determinism) is NOT an accuracy claim.
    re: /\b(?:(?:always|100\s?%|guaranteed)\s+(?:accurate|correct|right|reliable)|never (?:wrong|mistaken|makes? (?:a |any )?mistakes?)|infallible)\b/gi,
  },
  {
    label: "a recommendation / how-to-vote verb",
    re: /\b(we recommend|we suggest|our recommendation|our top pick|you should vote|you should put|you should number|you should rank|vote 1\b|vote one for|recommended (?:preference|order|ranking|vote|candidate|party|choice)|best (?:party|candidate|choice) (?:for you|to vote))/gi,
  },
  {
    label: "a default/preselected candidate rank",
    re: /\b(pre-?fill(?:s|ed|ing)?|pre-?select(?:s|ed|ing|ion)?|pre-?rank(?:s|ed|ing)?|pre-?number(?:s|ed|ing)?|auto-?rank(?:s|ed|ing)?|automatically ranked|default (?:order|ranking|rank|preference|ballot)|starts? (?:pre-?)?ranked|suggested (?:order|ranking))\b/gi,
  },
];

/**
 * Strip code/markup comments so only PUBLIC COPY is scanned. Developer comments legitimately explain
 * the neutrality rules using the very phrases the guard bans ("so the display never implies a winner
 * or a suggested order"), and comments never reach the user. Removes block comments, HTML comments
 * and `//` line comments (but not the `//` in a URL scheme like `https://`).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripComments(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/<!--[\s\S]*?-->/g, " ") // <!-- html -->
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // // line (not scheme://)
}

/**
 * Scan public-copy sources for banned assertive constructions, negation-aware. Comments are stripped
 * first (see stripComments) so only user-facing copy is examined.
 *
 * @param {{ path: string, text: string }[]} sources
 * @returns {{ path: string, label: string, match: string }[]}
 */
export function scanCopy(sources) {
  const hits = [];
  for (const { path, text: raw } of sources) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const text = stripComments(raw);
    for (const { label, re } of BANNED) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        // Look back over the current clause only: from the LAST clause delimiter before the match
        // (or MAX_LOOKBACK chars, whichever is closer) up to the match.
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
        hits.push({ path, label, match: m[0].replace(/\s+/g, " ").trim() });
      }
    }
  }
  return hits;
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
    .replace(/&amp;/g, "&") // unescape last so it cannot re-form another entity
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical proposition-selection manifest: for each election (sorted), the set of propositions
 * (sorted by id) reduced to {id, text} — i.e. WHICH issues are included and HOW they are worded.
 * Position figures are deliberately excluded: a data refresh is not a selection change.
 *
 * @param {{ id: string, questions: { id: number, text: string }[] }[]} datasets
 */
export function propositionManifest(datasets) {
  return datasets
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id), "en"))
    .map((d) => ({
      election: String(d.id),
      propositions: (Array.isArray(d.questions) ? d.questions : [])
        .slice()
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((q) => ({ id: q.id, text: q.text })),
    }));
}

/** SHA-256 (hex) over the canonical proposition manifest. */
export function hashPropositionManifest(datasets) {
  return createHash("sha256")
    .update(JSON.stringify(propositionManifest(datasets)))
    .digest("hex");
}

/**
 * Decide whether the neutrality posture is clean.
 *
 * @param {{
 *   register?: unknown,
 *   sources?: { path: string, text: string }[],
 *   methodologyText?: string,
 *   propositionsHash?: string | null,
 *   methodologyVersion?: string | null,
 *   now?: number,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input = {}) {
  const errors = [];
  const push = (m) => errors.push(m);
  const now = input.now ?? Date.now();
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const page = normalisePageText(input.methodologyText ?? "");

  // 1 — banned phrases in public copy.
  for (const hit of scanCopy(sources)) {
    push(`${hit.path}: contains ${hit.label} ("${hit.match}") — neutrality guarantee forbids it`);
  }

  // Register structure.
  const register = input.register;
  if (typeof register !== "object" || register === null || Array.isArray(register)) {
    push("register: not a JSON object");
    return { ok: errors.length === 0, errors };
  }
  if (register.schemaVersion !== 1) {
    push(`register.schemaVersion: expected 1, got ${JSON.stringify(register.schemaVersion)}`);
  }

  const checkApproval = (at, rec) => {
    if (!isNonEmptyString(rec.approver)) push(`${at}: missing approver`);
    const approved = parseIsoDate(rec.approvedAt);
    const expires = parseIsoDate(rec.expiresAt);
    if (approved === null) push(`${at}: missing/invalid approvedAt`);
    if (expires === null) push(`${at}: missing/invalid expiresAt`);
    else if (expires < now) push(`${at}: approval expired at ${rec.expiresAt} (fail-closed)`);
  };

  // 2 — claims: well-formed + wording present verbatim on the methodology page.
  const claims = Array.isArray(register.claims) ? register.claims : null;
  if (claims === null) {
    push("register.claims: not an array");
  } else if (claims.length === 0) {
    push("register.claims: at least one neutrality claim is required");
  } else {
    for (const [i, c] of claims.entries()) {
      const at = `claim[${i}]${c && c.id ? ` (${c.id})` : ""}`;
      if (!c || typeof c !== "object") {
        push(`${at}: not an object`);
        continue;
      }
      if (!isNonEmptyString(c.id)) push(`${at}: missing id`);
      if (!isNonEmptyString(c.wording)) push(`${at}: missing wording`);
      if (!isNonEmptyString(c.substantiatingControl)) push(`${at}: missing substantiatingControl`);
      if (!Array.isArray(c.tests) || c.tests.length === 0)
        push(`${at}: needs at least one test id`);
      if (!Array.isArray(c.evidence)) push(`${at}: evidence must be an array`);
      checkApproval(at, c);
      if (isNonEmptyString(c.wording)) {
        const needle = normalisePageText(c.wording);
        if (!page.includes(needle)) {
          push(
            `${at}: wording not found on the methodology page (register/page drift): "${needle}"`,
          );
        }
      }
    }
  }

  // 3 + 4 — proposition-selection rationale + scoring spec.
  const ps = register.propositionSelection;
  if (typeof ps !== "object" || ps === null || Array.isArray(ps)) {
    push("register.propositionSelection: missing or not an object");
  } else {
    if (!isNonEmptyString(ps.version)) push("propositionSelection: missing version");
    // The version must be surfaced verbatim on the page, so a version bump cannot ship without the
    // public page reflecting it (binds version → page directly, independent of pageWording).
    else if (!page.includes(`proposition selection v${ps.version}`)) {
      push(
        `propositionSelection: the methodology page does not surface "proposition selection v${ps.version}" — ` +
          `re-version bump not reflected on the public page`,
      );
    }
    if (!isNonEmptyString(ps.rationale)) push("propositionSelection: missing rationale");
    if (typeof ps.scoringSpec !== "object" || ps.scoringSpec === null) {
      push("propositionSelection: missing scoringSpec");
    }
    checkApproval("propositionSelection", ps);

    // pageWording present verbatim on the methodology page (surfacing + drift gate).
    const pageWording = Array.isArray(ps.pageWording) ? ps.pageWording : [];
    if (pageWording.length === 0) {
      push("propositionSelection.pageWording: at least one surfaced string is required");
    }
    for (const w of pageWording) {
      if (!isNonEmptyString(w)) continue;
      if (!page.includes(normalisePageText(w))) {
        push(
          `propositionSelection: pageWording not found on the methodology page (drift): "${normalisePageText(w)}"`,
        );
      }
    }

    // proposition-hash binding (unexplained proposition changes).
    const propositionsHash = input.propositionsHash ?? null;
    if (propositionsHash !== null) {
      if (!isNonEmptyString(ps.boundManifestHash)) {
        push("propositionSelection: missing boundManifestHash");
      } else if (ps.boundManifestHash !== propositionsHash) {
        push(
          `propositionSelection.boundManifestHash is stale: register ${ps.boundManifestHash.slice(0, 12)}… ` +
            `vs datasets ${propositionsHash.slice(0, 12)}… — propositions changed; re-version the ` +
            `rationale and update boundManifestHash (unexplained proposition change)`,
        );
      }
    }

    // method-version binding.
    const methodologyVersion = input.methodologyVersion ?? null;
    if (methodologyVersion !== null) {
      if (!isNonEmptyString(ps.methodologyVersion)) {
        push("propositionSelection: missing methodologyVersion");
      } else if (ps.methodologyVersion !== methodologyVersion) {
        push(
          `propositionSelection.methodologyVersion "${ps.methodologyVersion}" is not data-schema ` +
            `METHODOLOGY_VERSION "${methodologyVersion}" — scoring spec lags a method bump`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);

const CODE_EXT = /\.(svelte|ts|js|mjs|cjs)$/;
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SELF_REL = "scripts/check-neutrality-claims.mjs";
// Public copy lives under apps/web/src. The engine module (plan.ts etc.) and route/component copy
// are all in scope; tests, this guard and the registers are excluded (they legitimately quote the
// very phrases the guard bans, as fixtures/wording).
const SCAN_PREFIX = "apps/web/src/";
/** Top-level prose docs, outside SCAN_PREFIX, that are also externally visible and drift-prone. */
const SCAN_EXTRA = ["README.md", "SECURITY.md"];

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
      (p) => p.startsWith(SCAN_PREFIX) && CODE_EXT.test(p) && !IS_TEST.test(p) && p !== SELF_REL,
    );
  // The front-page prose (README.md, SECURITY.md) is externally visible on GitHub and is a documented
  // drift source for the "ranks candidates" / "anonymous" claims the legal rebuild removed, so it is
  // scanned under the same banned-phrase rules as the in-app copy. stripComments handles their HTML
  // comments; Markdown code fences carry no neutrality claims.
  const extra = SCAN_EXTRA.map((p) => ({ path: p, text: safeRead(p) }));
  return [...listed.map((p) => ({ path: p, text: safeRead(p) })), ...extra];
}

function loadDatasets() {
  const elections = JSON.parse(safeRead("data/dist/elections.json"));
  return elections.map((e) => {
    const ds = JSON.parse(safeRead(`data/dist/${e.id}/dataset.json`));
    return { id: e.id, questions: ds.questions?.questions ?? [] };
  });
}

function methodologyVersion() {
  // METHODOLOGY_VERSION is a plain exported const; read it without a TS import.
  const src = safeRead("packages/data-schema/src/methodology.ts");
  const m = /METHODOLOGY_VERSION\s*=\s*["']([^"']+)["']/.exec(src);
  return m ? m[1] : null;
}

function main() {
  const datasets = loadDatasets();
  const propositionsHash = hashPropositionManifest(datasets);

  if (process.argv.includes("--print-hash")) {
    process.stdout.write(`${propositionsHash}\n`);
    return;
  }

  let register;
  try {
    register = JSON.parse(safeRead("docs/legal/neutrality-claims.json"));
  } catch (err) {
    console.error(`::error::cannot read neutrality-claims register: ${err.message}`);
    process.exit(1);
  }

  const result = verdict({
    register,
    sources: gatherSources(),
    methodologyText: safeRead("apps/web/src/routes/methodology/+page.svelte"),
    propositionsHash,
    methodologyVersion: methodologyVersion(),
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::neutrality-claims: ${e}`);
    console.error(`neutrality claims: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info("neutrality claims OK — copy clean, register bound to methodology page + dataset");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
