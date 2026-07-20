#!/usr/bin/env node
/**
 * @fileoverview CI guard: programme close-out — the compliance backbone is COMPLETE and ENFORCED.
 * Governing principle: FAIL CLOSED.
 *
 * The other controls each ship their own control + guard; this capstone proves nothing has been
 * left half-wired. It composes the structural control-register guard (check-control-register.mjs)
 * with the additional close-out invariants:
 *
 *   1. No orphan requirement — every control (control-1..31) maps to at least one test AND at least
 *      one evidence record, and every test names a concrete enforcement artefact (no "(none)").
 *   2. No ownerless / dangling test — every `scripts/…mjs` guard a test claims to be enforced by
 *      actually EXISTS on disk AND is referenced by a real CI workflow step (so a renamed or
 *      dropped guard is caught), and every one of the six canonical CI groups has a real, required
 *      compliance.yml job.
 *   3. Required-checks manifest has no drift — the set of jobs in .github/workflows/compliance.yml
 *      equals docs/legal/required-checks.json's requiredChecks (a new compliance job that is not
 *      registered, or a stale registration with no job, fails). This keeps the manual
 *      branch-protection repo setting from silently falling behind the workflow.
 *   4. No unaudited / open-ended bypass — every declared exception carries an owner, a reason, a
 *      backing control and an expiry, and fails closed once expired. The empty set is asserted
 *      explicitly.
 *   5. No disclaimer substitutes for a control — every "advice" / "no-recommendation" style
 *      disclaimer found in user-facing copy is on an audited allowlist that names the SUBSTANTIVE
 *      control(s) backing it, and each backing control is real, implemented-enough and test-backed.
 *   6. The workflow itself is well-formed — no duplicate sibling mapping keys in compliance.yml
 *      (a repeated key GitHub Actions rejects wholesale, taking every compliance gate offline).
 *
 * Pure decision logic is exported as verdict()/helpers for unit tests; the fs/CLI plumbing runs
 * only when executed directly.
 *
 * Usage:
 *   node scripts/check-close-out.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verdict as registerVerdict, CANONICAL_GROUPS } from "./check-control-register.mjs";

/** The six canonical group → its primary compliance.yml job display name. */
export const GROUP_JOB_NAMES = {
  Legal: "CI group (Legal)",
  Data: "CI group (Data)",
  "Privacy and Research": "CI group (Privacy and Research)",
  "Code and Supply Chain": "CI group (Code and Supply Chain)",
  "Accessibility and Product": "CI group (Accessibility and Product)",
  "Infrastructure and Operations": "CI group (Infrastructure and Operations)",
};

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
 * Extract every compliance.yml JOB display name. Job names sit at exactly four spaces of indent
 * (`    name: …`) directly under a two-space job key; step names are six-space `      - name:` and
 * never match. A dependency-free line scan (mirrors scripts/check-supply-chain.mjs) avoids adding a
 * YAML runtime to the frozen lockfile.
 * @param {string} yamlText
 * @returns {string[]}
 */
export function extractJobNames(yamlText) {
  const names = [];
  for (const line of yamlText.split("\n")) {
    const m = /^ {4}name: (.+?)\s*$/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Detect duplicate sibling keys in a block mapping — the failure mode that makes GitHub Actions
 * reject a whole workflow (e.g. a repeated `path:` / `retention-days:` in a step's `with:`). Handles
 * block scalars (`|`, `>`) and sequence items (a `- ` marker starts a fresh mapping frame). Not a
 * full YAML parser; deliberately conservative so it never false-positives on valid workflow YAML.
 * @param {string} yamlText
 * @returns {{ line: number, key: string, indent: number }[]}
 */
export function findDuplicateMappingKeys(yamlText) {
  const dups = [];
  /** @type {{ indent: number, keys: Set<string> }[]} */
  const stack = [];
  let blockScalarIndent = null; // when set, skip lines more-indented than this (scalar content)
  const lines = yamlText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.replace(/^ +/, "").length;

    // Inside a block scalar: any deeper line is opaque content, skip it. A line at or below the
    // scalar's own indent ends the scalar.
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    // A `- ` sequence marker starts a new mapping item; the key (if any) sits after the marker.
    const seq = /^( *)- (.*)$/.exec(raw);
    let keyIndent = indent;
    let rest = raw.slice(indent);
    if (seq) {
      keyIndent = seq[1].length + 2; // keys of this item align two past the marker
      rest = seq[2];
      // A `- ` always opens a fresh item frame at keyIndent: drop any deeper frames + reset.
      while (stack.length && stack[stack.length - 1].indent >= keyIndent) stack.pop();
      stack.push({ indent: keyIndent, keys: new Set() });
    }

    const km = /^([A-Za-z0-9_.@$-]+):(?:\s+(.*))?$/.exec(rest);
    if (!km) continue;
    const key = km[1];
    const value = (km[2] ?? "").trim();

    // Pop frames shallower-or-equal handling: a key belongs to the frame whose indent === keyIndent.
    if (!seq) {
      while (stack.length && stack[stack.length - 1].indent > keyIndent) stack.pop();
      if (!stack.length || stack[stack.length - 1].indent < keyIndent) {
        stack.push({ indent: keyIndent, keys: new Set() });
      }
    }
    const frame = stack[stack.length - 1];
    if (frame.keys.has(key)) {
      dups.push({ line: i + 1, key, indent: keyIndent });
    } else {
      frame.keys.add(key);
    }

    // Opening a block scalar? Its content follows and must be skipped.
    if (/^[|>][+-]?\d*\s*$/.test(value)) blockScalarIndent = keyIndent;
  }
  return dups;
}

/**
 * Extract the concrete `scripts/…(.mjs)` enforcement artefacts named in a test's free-text
 * `enforcedBy`. Only scripts/ paths are machine-checked (exact, CI-run); package source, unit and
 * e2e spec paths are documentation-grade and validated only for presence of the field.
 * @param {unknown} enforcedBy
 * @returns {string[]}
 */
export function scriptArtefacts(enforcedBy) {
  if (!isNonEmptyString(enforcedBy)) return [];
  return [...enforcedBy.matchAll(/scripts\/[A-Za-z0-9._-]+\.mjs/g)].map((m) => m[0]);
}

/**
 * Is a scripts/ artefact wired into CI? A guard (`scripts/x.mjs`) must be referenced verbatim by a
 * workflow run step; a scripts test (`scripts/x.test.mjs`) also counts as wired when the workflows
 * run the scripts vitest suite via `pnpm test` (vitest.scripts.config.js globs scripts/**\/*.test.mjs).
 * @param {string} artefact
 * @param {string} workflowText  concatenation of every .github/workflows file
 * @returns {boolean}
 */
export function isWired(artefact, workflowText) {
  // Only a reference on a NON-COMMENT line counts as wired — a script named in a workflow comment
  // (e.g. "# see scripts/x.mjs") is documentation, not execution, and must not satisfy the gate.
  const executableLines = workflowText
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  if (executableLines.includes(artefact)) return true;
  if (artefact.endsWith(".test.mjs") && /\bpnpm(?: -r)? test\b/.test(executableLines)) return true;
  return false;
}

/**
 * @param {object} input
 * @param {unknown} input.register        parsed docs/legal/control-register.json
 * @param {unknown} input.requiredChecks  parsed docs/legal/required-checks.json
 * @param {string[]} input.jobNames       compliance.yml job display names (extractJobNames)
 * @param {string} input.workflowText     concatenation of every workflow file
 * @param {{line:number,key:string}[]} input.duplicateKeys  findDuplicateMappingKeys(compliance.yml)
 * @param {Set<string>} input.existingScripts  scripts/ artefacts (from the register) that exist on disk
 * @param {{patternId:string,file:string,line:number,text:string}[]} input.disclaimerHits
 * @param {{ now?: number }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input, options = {}) {
  const errors = [];
  const now = options.now ?? Date.now();
  const push = (m) => errors.push(m);
  const {
    register,
    requiredChecks,
    jobNames = [],
    workflowText = "",
    duplicateKeys = [],
    existingScripts = new Set(),
    disclaimerHits = [],
  } = input;

  // (0) Structural register — compose the base guard so close-out can never pass on a register the
  // base guard would reject.
  const base = registerVerdict(register, { now });
  for (const e of base.errors) push(`register: ${e}`);

  const controls = Array.isArray(register?.controls) ? register.controls : [];
  const controlIds = new Set(controls.map((c) => c?.id).filter(isNonEmptyString));
  const controlById = new Map(controls.map((c) => [c?.id, c]));

  // (1) No orphan requirement + (2) no dangling test artefact.
  for (const c of controls) {
    if (!c || typeof c !== "object" || !isNonEmptyString(c.id)) continue;
    const at = `control ${c.id}`;
    const evidence = Array.isArray(c.evidence) ? c.evidence : [];
    if (evidence.length === 0)
      push(`${at}: no evidence record (orphan requirement — needs ≥1 evidence id)`);
    const tests = Array.isArray(c.tests) ? c.tests : [];
    for (const [i, t] of tests.entries()) {
      const tat = `${at} test[${i}]${t && t.id ? ` (${t.id})` : ""}`;
      const eb = t && t.enforcedBy;
      if (!isNonEmptyString(eb) || eb.trim() === "(none)") {
        push(`${tat}: enforcedBy missing — every test must name its enforcement artefact`);
        continue;
      }
      for (const art of scriptArtefacts(eb)) {
        if (!existingScripts.has(art)) {
          push(`${tat}: enforcedBy names ${art}, which does not exist on disk (dangling)`);
        } else if (!isWired(art, workflowText)) {
          push(`${tat}: enforcedBy names ${art}, which no CI workflow runs (ownerless test)`);
        }
      }
    }
  }

  // (3) Required-checks manifest shape + drift.
  const rc = requiredChecks && typeof requiredChecks === "object" ? requiredChecks : null;
  if (!rc) {
    push("required-checks: not a JSON object");
  } else {
    if (rc.schemaVersion !== 1) {
      push(`required-checks: schemaVersion must be 1, got ${JSON.stringify(rc.schemaVersion)}`);
    }
    if (!isNonEmptyString(rc.branch)) push("required-checks: missing branch");
    const declaredGroups = Array.isArray(rc.ciGroups) ? rc.ciGroups : [];
    for (const g of CANONICAL_GROUPS) {
      if (!declaredGroups.includes(g)) push(`required-checks: missing canonical group "${g}"`);
    }

    const declared = Array.isArray(rc.requiredChecks) ? rc.requiredChecks : null;
    if (!declared) {
      push("required-checks: requiredChecks must be an array");
    } else {
      const declaredSet = new Set(declared);
      const jobSet = new Set(jobNames);
      // Every compliance job must be a declared required check (a new unregistered job fails).
      for (const name of jobSet) {
        if (!declaredSet.has(name)) {
          push(
            `required-checks: compliance job "${name}" is not a declared required check (drift)`,
          );
        }
      }
      // Every declared required check must be a real compliance job (stale registration fails).
      for (const name of declaredSet) {
        if (!jobSet.has(name)) {
          push(`required-checks: "${name}" is declared required but is not a compliance.yml job`);
        }
      }
      // The six canonical group jobs must each exist AND be required.
      for (const g of CANONICAL_GROUPS) {
        const jobName = GROUP_JOB_NAMES[g];
        if (!jobSet.has(jobName))
          push(`required-checks: no compliance job for group "${g}" (${jobName})`);
        if (!declaredSet.has(jobName))
          push(`required-checks: group "${g}" job not marked required`);
      }
    }
  }

  // (4) Bypasses — audited + expiring, or the empty set.
  if (rc) {
    const bypasses = Array.isArray(rc.bypasses) ? rc.bypasses : null;
    if (bypasses === null) {
      push("required-checks: bypasses must be an array (may be empty)");
    } else {
      for (const [i, b] of bypasses.entries()) {
        const bat = `bypass[${i}]${b && b.id ? ` (${b.id})` : ""}`;
        if (!b || typeof b !== "object") {
          push(`${bat}: not an object`);
          continue;
        }
        if (!isNonEmptyString(b.id)) push(`${bat}: missing id`);
        if (!isNonEmptyString(b.owner)) push(`${bat}: missing owner`);
        if (!isNonEmptyString(b.reason)) push(`${bat}: missing reason`);
        if (!isNonEmptyString(b.control) || !controlIds.has(b.control)) {
          push(`${bat}: control must reference a real control id`);
        }
        const expires = parseIsoDate(b.expiresAt);
        if (expires === null) push(`${bat}: needs a valid expiresAt (audited, time-boxed)`);
        else if (expires < now) push(`${bat}: expired at ${b.expiresAt} (fail-closed)`);
      }
    }
  }

  // (5) Disclaimers — none may substitute for a control.
  if (rc) {
    const allow = Array.isArray(rc.disclaimers) ? rc.disclaimers : null;
    if (allow === null) {
      push("required-checks: disclaimers must be an array (may be empty)");
    } else {
      for (const [i, d] of allow.entries()) {
        const dat = `disclaimer[${i}]${d && d.id ? ` (${d.id})` : ""}`;
        if (!d || typeof d !== "object") {
          push(`${dat}: not an object`);
          continue;
        }
        if (!isNonEmptyString(d.patternId)) push(`${dat}: missing patternId`);
        if (!Array.isArray(d.files) || d.files.length === 0) push(`${dat}: missing files`);
        const backing = Array.isArray(d.backingControls) ? d.backingControls : [];
        if (backing.length === 0)
          push(`${dat}: no backingControls — a disclaimer needs a real control`);
        for (const cid of backing) {
          const c = controlById.get(cid);
          if (!c) {
            push(`${dat}: backingControl ${cid} is not a real control`);
            continue;
          }
          if (c.status === "planned") {
            push(
              `${dat}: backingControl ${cid} is only "planned" — disclaimer cannot stand in for it`,
            );
          }
          if (!Array.isArray(c.tests) || c.tests.length === 0) {
            push(`${dat}: backingControl ${cid} has no test — not a substantive control`);
          }
        }
      }
      // Every disclaimer found in user-facing copy must be covered by an allowlist entry for its file.
      for (const hit of disclaimerHits) {
        const covered = allow.some(
          (d) =>
            d &&
            d.patternId === hit.patternId &&
            Array.isArray(d.files) &&
            d.files.includes(hit.file),
        );
        if (!covered) {
          push(
            `disclaimer scan: unaudited "${hit.patternId}" disclaimer at ${hit.file}:${hit.line} ` +
              `(${JSON.stringify(hit.text)}) — allowlist it with its backing control`,
          );
        }
      }
    }
  }

  // (6) Workflow well-formedness.
  for (const d of duplicateKeys) {
    push(
      `compliance.yml: duplicate mapping key "${d.key}" at line ${d.line} (GitHub rejects the whole workflow)`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);

/** Disclaimer families scanned in user-facing copy (comment-only lines are skipped). */
export const DISCLAIMER_PATTERNS = [
  ["advice", /not\s+(?:legal|electoral|financial|professional|official)\s+advice/i],
  ["advice", /does not constitute[^.\n]{0,40}advice/i],
  ["not-affiliated", /not\s+affiliated/i],
  ["not-endorsed", /not\s+endorsed/i],
  [
    "no-recommendation",
    /(?:does not recommend|do not recommend|not a recommendation|no recommendation)/i,
  ],
  ["informational", /informational purposes only/i],
  ["not-substitute", /is not a substitute for/i],
];

function gitTrackedWebSource() {
  // Enumerate user-facing web source; fall back to a recursive walk if git is unavailable.
  const roots = ["apps/web/src/routes", "apps/web/src/lib"];
  const out = [];
  const walk = (dirRel) => {
    let entries;
    try {
      entries = readdirSync(rel(dirRel + "/"), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = `${dirRel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (/\.(svelte|ts)$/.test(e.name)) out.push(child);
    }
  };
  for (const r of roots) walk(r);
  return out;
}

function collectDisclaimerHits() {
  const hits = [];
  const isComment = (l) => {
    const t = l.trim();
    return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--");
  };
  for (const f of gitTrackedWebSource()) {
    let lines;
    try {
      lines = readFileSync(rel(f), "utf8").split("\n");
    } catch {
      continue;
    }
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const [patternId, re] of DISCLAIMER_PATTERNS) {
        const m = re.exec(line);
        if (m) hits.push({ patternId, file: f, line: i + 1, text: m[0] });
      }
    });
  }
  return hits;
}

function main() {
  let register;
  let requiredChecks;
  let complianceText;
  try {
    register = JSON.parse(readFileSync(rel("docs/legal/control-register.json"), "utf8"));
    requiredChecks = JSON.parse(readFileSync(rel("docs/legal/required-checks.json"), "utf8"));
    complianceText = readFileSync(rel(".github/workflows/compliance.yml"), "utf8");
  } catch (err) {
    console.error(`::error::close-out: cannot read an input: ${err.message}`);
    process.exit(1);
  }

  // Concatenate every workflow for the wiring check.
  let workflowText = "";
  try {
    for (const f of readdirSync(rel(".github/workflows/"))) {
      if (/\.ya?ml$/.test(f))
        workflowText += readFileSync(rel(`.github/workflows/${f}`), "utf8") + "\n";
    }
  } catch {
    workflowText = complianceText;
  }

  // Resolve which scripts/ artefacts named across the register actually exist.
  const existingScripts = new Set();
  for (const c of register.controls ?? []) {
    for (const t of c.tests ?? []) {
      for (const art of scriptArtefacts(t.enforcedBy)) {
        if (existsSync(rel(art))) existingScripts.add(art);
      }
    }
  }

  const result = verdict({
    register,
    requiredChecks,
    jobNames: extractJobNames(complianceText),
    workflowText,
    duplicateKeys: findDuplicateMappingKeys(complianceText),
    existingScripts,
    disclaimerHits: collectDisclaimerHits(),
  });

  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::close-out: ${e}`);
    console.error(`close-out: ${result.errors.length} problem(s)`);
    process.exit(1);
  }
  console.info(
    `close-out OK — ${(register.controls ?? []).length} controls, ` +
      `${extractJobNames(complianceText).length} compliance jobs required, ` +
      `${(requiredChecks.bypasses ?? []).length} bypass(es)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
