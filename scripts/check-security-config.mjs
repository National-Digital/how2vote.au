#!/usr/bin/env node
/**
 * @fileoverview CI guard: infrastructure-as-code / config security policy.
 *
 * Static policy tests over the committed config so a security-relevant setting can't silently
 * regress. It asserts:
 *   - the committed response headers (apps/web/static/_headers) carry every hardening header the
 *     security register requires (HSTS, nosniff, frame-ancestors 'none', referrer policy, COOP,
 *     permissions policy) — the register is the single source of truth for the list;
 *   - a CodeQL static-analysis workflow is committed AND visibility-gated (self-activates on the
 *     public flip, never accidentally always-on/off);
 *   - a dependency-review workflow is committed, visibility-gated, and fails on high (or critical);
 *   - the secret-scan job scans the FULL history / all refs (gitleaks --log-opts=--all) — a change
 *     that narrows it to HEAD would defeat the guarantee, so it fails closed;
 *   - every workflow declares a top-level least-privilege `permissions:` block (no implicit,
 *     over-broad default GITHUB_TOKEN scope).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/git/CLI plumbing only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/check-security-config.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @param {unknown} v */
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const VISIBILITY_GATE = /repository\.visibility\s*==\s*'public'/;
/** A top-level (column-0) `permissions:` key — least-privilege token scope for the whole workflow. */
const TOP_LEVEL_PERMISSIONS = /^permissions:/m;
/** `permissions: write-all` (or the read-all/write-all shorthand) defeats least privilege — a block
 *  that grants everything is no better than no block. Reject it wherever it appears in a workflow. */
const WRITE_ALL_PERMISSIONS = /^\s*permissions:\s*write-all\s*$/m;

/**
 * Validate the committed security config.
 *
 * @param {{
 *   headers: string,
 *   requiredResponseHeaders: string[],
 *   workflows: { path: string, text: string }[],
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(input) {
  const errors = [];
  const push = (m) => errors.push(m);

  // 1 — required response headers.
  const headers = typeof input?.headers === "string" ? input.headers : null;
  const required = Array.isArray(input?.requiredResponseHeaders)
    ? input.requiredResponseHeaders.filter(isNonEmptyString)
    : [];
  if (headers === null) {
    push("headers: _headers file is missing or unreadable (fail-closed)");
  } else if (required.length === 0) {
    push("requiredResponseHeaders: empty (fail-closed — nothing to enforce)");
  } else {
    for (const token of required) {
      if (!headers.includes(token)) {
        push(`_headers: missing required security header token "${token}"`);
      }
    }
  }

  // 2..5 — workflows.
  const workflows = Array.isArray(input?.workflows) ? input.workflows : null;
  if (workflows === null || workflows.length === 0) {
    push("workflows: none found (fail-closed)");
    return { ok: errors.length === 0, errors };
  }

  let codeql = null;
  let depReview = null;
  let secretScan = null;
  for (const wf of workflows) {
    if (!wf || typeof wf.text !== "string" || !isNonEmptyString(wf.path)) {
      push("workflow: malformed entry (expected { path, text })");
      continue;
    }
    if (!TOP_LEVEL_PERMISSIONS.test(wf.text)) {
      push(`${wf.path}: no top-level "permissions:" block (least-privilege token scope required)`);
    }
    if (WRITE_ALL_PERMISSIONS.test(wf.text)) {
      push(
        `${wf.path}: "permissions: write-all" defeats least privilege — scope each permission explicitly`,
      );
    }
    if (/codeql-action\/analyze/.test(wf.text)) codeql = wf;
    if (/dependency-review-action/.test(wf.text)) depReview = wf;
    if (/gitleaks\s+detect/.test(wf.text)) secretScan = wf;
  }

  // CodeQL: committed + visibility-gated.
  if (!codeql) {
    push("code scanning: no CodeQL workflow (codeql-action/analyze) is committed");
  } else if (!VISIBILITY_GATE.test(codeql.text)) {
    push(`${codeql.path}: CodeQL job must be visibility-gated (self-activates on the public flip)`);
  }

  // Dependency review: committed + visibility-gated + fails on high/critical.
  if (!depReview) {
    push("dependency review: no dependency-review-action workflow is committed");
  } else {
    if (!VISIBILITY_GATE.test(depReview.text)) {
      push(`${depReview.path}: dependency-review job must be visibility-gated`);
    }
    if (!/fail-on-severity:\s*(high|critical)/.test(depReview.text)) {
      push(`${depReview.path}: dependency-review must fail on high or critical severity`);
    }
  }

  // Secret scan: full-history / all refs.
  if (!secretScan) {
    push("secret scan: no gitleaks detect job is committed");
  } else if (!/--log-opts=--all/.test(secretScan.text)) {
    push(
      `${secretScan.path}: gitleaks must scan all refs (--log-opts=--all) — a leak on any branch must fail`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
const root = new URL("..", import.meta.url);
const rel = (p) => new URL(p, root);
const HEADERS = rel("apps/web/static/_headers");
const REGISTER = rel("docs/legal/security-register.json");

function gatherWorkflows() {
  const listed = execFileSync("git", ["ls-files", ".github/workflows"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => /\.ya?ml$/.test(p));
  return listed.map((p) => ({ path: p, text: readFileSync(rel(p), "utf8") }));
}

function main() {
  let headers;
  try {
    headers = readFileSync(HEADERS, "utf8");
  } catch {
    headers = null;
  }
  let requiredResponseHeaders;
  try {
    requiredResponseHeaders = JSON.parse(readFileSync(REGISTER, "utf8")).requiredResponseHeaders;
  } catch (err) {
    console.error(`::error::security-config: cannot read security register: ${err.message}`);
    process.exit(1);
    return;
  }
  const workflows = gatherWorkflows();
  const result = verdict({ headers, requiredResponseHeaders, workflows });
  if (!result.ok) {
    for (const e of result.errors) console.error(`::error::security-config: ${e}`);
    console.error(`security config: ${result.errors.length} problem(s)`);
    process.exit(1);
    return;
  }
  console.info(`security config OK — headers + ${workflows.length} workflow(s) validated`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
/* c8 ignore stop */
