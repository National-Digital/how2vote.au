#!/usr/bin/env node
/**
 * @fileoverview CI guard: no identifier or personal-data field is ever passed to a log call in the
 * runtime source (PIA §6).
 *
 * The research endpoint deliberately logs NOTHING about a request — the in-flight payload is the one
 * place a profile momentarily exists and it must never be copied into a log or error reporter
 * (functions/api/research.ts header). This guard backstops that promise for the whole runtime: it
 * extracts every console.* call in the scanned source and fails if any of them references a field on
 * the forbidden list (IP, user agent, precise location, electorate, the raw contribution, …).
 *
 * The forbidden field list is read from the security register (docs/legal/security-register.json),
 * so the register is the single source of truth and the guard cannot drift from the public wording.
 *
 * Matching is precise: each field is matched with identifier boundaries and case-insensitively, so
 * it trips on `ip`, `.ip`, `"cf-connecting-ip"` or `userAgent`, but never on the letters appearing
 * inside an unrelated word (e.g. "description", "recipient", "params"). It is a backstop, not a
 * parser — the primary guarantee is the "no logging at all" invariant in the research endpoint.
 *
 * Pure decision logic is exported as verdict()/extractConsoleCalls() for unit tests; the fs/git/CLI
 * plumbing only runs when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-forbidden-log-fields.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Escape a string for use as a literal inside a RegExp. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the argument text of every console.<method>(...) call in a source string, balancing
 * parentheses so nested calls are captured whole. A dependency-free scan is sufficient: we only need
 * the text between the opening `(` and its matching `)`.
 *
 * @param {string} text
 * @returns {string[]} the argument text of each console call, in source order
 */
export function extractConsoleCalls(text) {
  const src = String(text);
  const out = [];
  const re = /console\s*\.\s*[A-Za-z]+\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    // i now points one past the matching ')'; the args are [start, i-1).
    out.push(src.slice(start, depth === 0 ? i - 1 : src.length));
    re.lastIndex = i;
  }
  return out;
}

/** Build a boundary-aware, case-insensitive matcher for a forbidden field token. */
function fieldMatcher(field) {
  // Identifier boundary: not preceded/followed by a JS identifier char. A hyphen is not an
  // identifier char, so hyphenated header names (cf-connecting-ip) work naturally.
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRe(field)}(?![A-Za-z0-9_$])`, "i");
}

/**
 * Decide whether the runtime source is free of forbidden fields in log calls.
 *
 * @param {{ files: { path: string, text: string }[], forbiddenFields: string[] }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);

  const files = Array.isArray(input?.files) ? input.files : null;
  if (files === null) {
    return { ok: false, errors: ["files: expected an array (fail-closed)"] };
  }
  const fields = Array.isArray(input?.forbiddenFields)
    ? input.forbiddenFields.filter(isNonEmptyString)
    : [];
  if (fields.length === 0) {
    return { ok: false, errors: ["forbiddenFields: empty (fail-closed — nothing to enforce)"] };
  }
  const matchers = fields.map((f) => ({ field: f, re: fieldMatcher(f) }));

  for (const file of files) {
    if (!file || typeof file.text !== "string" || !isNonEmptyString(file.path)) {
      push("file: malformed entry (expected { path, text })");
      continue;
    }
    for (const call of extractConsoleCalls(file.text)) {
      for (const { field, re } of matchers) {
        if (re.test(call)) {
          push(
            `${file.path}: a log call references the forbidden field "${field}" — identifiers and ` +
              `personal data must never reach a log (PIA §6)`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const REGISTER = new URL("docs/legal/security-register.json", root);
const RUNTIME_EXT = /\.(ts|tsx|js|mjs|cjs|svelte)$/;
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

function gatherFiles(scope) {
  const listed = execFileSync("git", ["ls-files", ...scope], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((p) => RUNTIME_EXT.test(p) && !IS_TEST.test(p));
  return listed.map((rel) => ({ path: rel, text: readFileSync(new URL(rel, root), "utf8") }));
}

function main() {
  let register;
  try {
    register = JSON.parse(readFileSync(REGISTER, "utf8"));
  } catch (err) {
    console.error(`::error::forbidden-log-fields: cannot read security register: ${err.message}`);
    process.exit(1);
    return;
  }
  const scope = Array.isArray(register.forbiddenLogScope) ? register.forbiddenLogScope : [];
  const forbiddenFields = Array.isArray(register.forbiddenLogFields)
    ? register.forbiddenLogFields
    : [];
  const files = gatherFiles(scope);
  const result = verdict({ files, forbiddenFields });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::forbidden-log-fields: ${e}`);
    console.error(`forbidden-log-field scan: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(
    `forbidden-log-field scan OK — ${files.length} runtime file(s), ${forbiddenFields.length} guarded field(s)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
