#!/usr/bin/env node
/**
 * @fileoverview CI guard: each store and signing credential is read only by jobs in the
 * environment that holds it.
 *
 * The credentials are environment secrets, and the environments that hold release credentials
 * admit only `main` (docs/store-distribution.md, "Credential environments"). That containment is a
 * repository setting, but it only holds while every job that names a credential also names the
 * environment: a job that references `secrets.ASC_API_KEY_P8` outside `ios-build`/`app-store`
 * would read the repository-level copy if one were ever re-added, from any branch. It asserts:
 *   - every registered credential is referenced only from jobs whose `environment:` is one of the
 *     environments listed for it in CREDENTIALS (names compared case-insensitively, as GitHub does);
 *   - no registered credential is referenced outside a job (workflow-level `env:`);
 *   - the secrets context is only ever indexed by a literal name: `toJSON(secrets)`,
 *     `secrets[expr]` and `secrets: inherit` would hand over every secret the job can see;
 *   - a job in a main-only environment, in a workflow that also runs on pull requests, has an `if:`
 *     that is a plain conjunction containing a pull-request exclusion (otherwise the environment
 *     refuses it on every PR);
 *   - the jobs block parses as expected (fail-closed on unrecognised layout), and at least one
 *     registered credential is found.
 *
 * A dependency-free line scan, like the other workflow guards: it must run with no install step.
 * It assumes the repository's two-space workflow layout and fails on anything else.
 *
 * Usage:
 *   node scripts/check-release-credentials.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Credential → the environments allowed to hold it. Keep in step with docs/store-distribution.md. */
export const CREDENTIALS = {
  ANDROID_UPLOAD_KEYSTORE: ["android-build"],
  ANDROID_KEYSTORE_PASSWORD: ["android-build"],
  ANDROID_KEY_ALIAS: ["android-build"],
  ANDROID_KEY_PASSWORD: ["android-build"],
  // Upload-only account on android-build; production-release account on play-store.
  PLAY_SERVICE_ACCOUNT_JSON: ["android-build", "play-store"],
  FDROID_KEYSTORE: ["fdroid-signing"],
  FDROID_KEYSTORE_PASSWORD: ["fdroid-signing"],
  FDROID_KEY_ALIAS: ["fdroid-signing"],
  FDROID_KEY_PASSWORD: ["fdroid-signing"],
  R2_ACCOUNT_ID: ["fdroid-publish"],
  R2_ACCESS_KEY_ID: ["fdroid-publish"],
  R2_SECRET_ACCESS_KEY: ["fdroid-publish"],
  // Developer key with cloud-signing access on ios-build; App Manager key on app-store.
  ASC_KEY_ID: ["ios-build", "app-store"],
  ASC_ISSUER_ID: ["ios-build", "app-store"],
  ASC_API_KEY_P8: ["ios-build", "app-store"],
  PLAY_SHARE_SERVICE_ACCOUNT_JSON: ["play-share"],
  PLAY_SHARE_KEYSTORE: ["play-share"],
  PLAY_SHARE_KEYSTORE_PASSWORD: ["play-share"],
  PLAY_SHARE_KEY_ALIAS: ["play-share"],
  PLAY_SHARE_KEY_PASSWORD: ["play-share"],
};

/** Environments whose deployment branch policy admits `main` only. */
export const MAIN_ONLY = new Set([
  "android-build",
  "play-store",
  "fdroid-signing",
  "fdroid-publish",
  "ios-build",
  "app-store",
]);

const indentOf = (line) => /^ */.exec(line)[0].length;
const isSkippable = (line) => line.trim() === "" || /^\s*#/.test(line);
const unquote = (v) =>
  v
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");

/**
 * Split a workflow into its top-level preamble, its `on:` block and its jobs, by indentation.
 * Anything in the jobs block that does not fit the two-space layout is reported in `problems`.
 *
 * @param {string} text
 * @returns {{ preamble: string, on: string, problems: string[],
 *   jobs: { id: string, line: number, body: string }[] }}
 */
export function parseWorkflow(text) {
  const lines = String(text).split("\n");
  const preamble = [];
  const on = [];
  const jobs = [];
  const problems = [];
  let section = null;
  let sawJobs = false;
  let job = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\t/.test(line) || /^ *\t/.test(line)) {
      problems.push(`line ${i + 1}: tab indentation`);
      continue;
    }
    const top = /^(["']?)([A-Za-z_][\w-]*)\1\s*:(.*)$/.exec(line);
    if (top) {
      section = top[2].toLowerCase();
      job = null;
      if (section === "jobs") {
        sawJobs = true;
        if (unquote(top[3]) !== "") problems.push(`line ${i + 1}: jobs is not a block mapping`);
        continue;
      }
    } else if (!isSkippable(line) && indentOf(line) === 0) {
      section = null;
      job = null;
    }
    if (section === "jobs") {
      if (isSkippable(line)) {
        if (job) job.lines.push(line);
        continue;
      }
      const indent = indentOf(line);
      if (indent === 2) {
        const header = /^ {2}(["']?)([A-Za-z0-9_-]+)\1\s*:\s*(#.*)?$/.exec(line);
        if (!header) {
          problems.push(`line ${i + 1}: unrecognised job header`);
          job = null;
          continue;
        }
        job = { id: header[2], line: i + 1, lines: [], started: false };
        jobs.push(job);
        continue;
      }
      if (indent < 4 || !job) {
        problems.push(`line ${i + 1}: unrecognised indentation in jobs`);
        continue;
      }
      if (!job.started) {
        job.started = true;
        if (indent !== 4) problems.push(`line ${i + 1}: job "${job.id}" is not indented by four`);
      }
      job.lines.push(line);
      continue;
    }
    if (section === "on" || section === "true") on.push(line);
    if (!/^\s*#/.test(line)) preamble.push(line);
  }
  if (!sawJobs) problems.push("no jobs block");
  else if (jobs.length === 0) problems.push("jobs block yields no jobs");
  return {
    preamble: preamble.join("\n"),
    on: on.join("\n"),
    problems,
    jobs: jobs.map(({ id, line, lines: body }) => ({ id, line, body: body.join("\n") })),
  };
}

/**
 * The job's environment name, lower-cased, from `environment: name`, an `environment:` block's
 * `name:`, or a flow mapping `{ name: x, ... }`. Null when the job names none.
 *
 * @param {string} body
 * @returns {string | null}
 */
export function jobEnvironment(body) {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}environment:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const value = unquote(m[1]);
    if (value.startsWith("{")) {
      const n = /(?:^|[{,])\s*name\s*:\s*([^,}]+)/.exec(value);
      return n ? unquote(n[1]).toLowerCase() : "";
    }
    if (value !== "") return value.toLowerCase();
    for (
      let j = i + 1;
      j < lines.length && (isSkippable(lines[j]) || indentOf(lines[j]) > 4);
      j++
    ) {
      const n = /^\s+name:(.*)$/.exec(lines[j]);
      if (n && indentOf(lines[j]) === 6) return unquote(n[1]).toLowerCase();
    }
    return "";
  }
  return null;
}

/**
 * The job's `if:` condition text (single line or block scalar), or "" when it has none.
 *
 * @param {string} body
 */
export function jobCondition(body) {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}if:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const parts = [m[1].replace(/^[|>][-+]?\s*$/, "")];
    for (
      let j = i + 1;
      j < lines.length && (lines[j].trim() === "" || indentOf(lines[j]) > 4);
      j++
    ) {
      parts.push(lines[j]);
    }
    return parts.join("\n").trim();
  }
  return "";
}

/** Split on a top-level operator, ignoring anything inside parentheses or quotes. */
function splitTopLevel(expr, op) {
  const terms = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) {
      terms.push(expr.slice(start, i));
      start = i + op.length;
      i += op.length - 1;
    }
  }
  terms.push(expr.slice(start));
  return terms.map((t) => t.trim());
}

/**
 * True when the condition is false for every pull_request event: a conjunction (no `||`
 * anywhere) with a top-level term `github.event_name != 'pull_request'` or
 * `github.ref == 'refs/heads/main'`.
 *
 * @param {string} condition
 */
export function excludesPullRequests(condition) {
  let expr = condition.replace(/\s+/g, " ").trim();
  const wrapped = /^\$\{\{(.*)\}\}$/.exec(expr);
  if (wrapped) expr = wrapped[1].trim();
  if (expr === "" || expr.includes("||") || expr.includes("${{")) return false;
  return splitTopLevel(expr, "&&").some(
    (t) =>
      /^github\.event_name\s*!=\s*(['"])pull_request\1$/i.test(t) ||
      /^github\.ref\s*==\s*(['"])refs\/heads\/main\1$/i.test(t),
  );
}

/**
 * Every use of the secrets context in a block of workflow text, comment lines excluded. Literal
 * lookups (`secrets.X`, `secrets['X']`) yield upper-cased names; anything else — `toJSON(secrets)`,
 * `secrets[expr]` — is reported as a bare use. Expressions are `${{ … }}` spans (which may span
 * lines) and the values of `if:` keys, which GitHub evaluates without the braces.
 *
 * @param {string} text
 * @returns {{ names: Set<string>, bare: string[] }}
 */
export function secretUses(text) {
  const kept = String(text)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l));
  const exprs = [];
  for (const m of kept.join("\n").matchAll(/\$\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1]);
  for (let i = 0; i < kept.length; i++) {
    const m = /^(\s*)(?:-\s+)?if:\s*(.*)$/.exec(kept[i]);
    if (!m || m[2].includes("${{")) continue;
    const parts = [m[2]];
    const base = indentOf(kept[i]);
    for (
      let j = i + 1;
      j < kept.length && (kept[j].trim() === "" || indentOf(kept[j]) > base + 2);
      j++
    ) {
      parts.push(kept[j]);
    }
    exprs.push(parts.join("\n"));
  }
  const names = new Set();
  const bare = [];
  for (const expr of exprs) {
    // A property named "secrets" (steps.secrets.outputs) is not the context.
    for (const m of expr.matchAll(/(?<![.\w-])secrets\b/gi)) {
      const rest = expr.slice(m.index + m[0].length);
      const dot = /^\s*\.\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(rest);
      const index = /^\s*\[\s*(['"])([^'"]+)\1\s*\]/.exec(rest);
      if (dot) names.add(dot[1].toUpperCase());
      else if (index) names.add(index[2].toUpperCase());
      else bare.push(expr.trim().replace(/\s+/g, " "));
    }
  }
  return { names, bare };
}

/**
 * @param {{ path: string, text: string }[]} workflows
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(workflows) {
  const errors = [];
  const push = (m) => errors.push(m);
  if (!Array.isArray(workflows) || workflows.length === 0) {
    push("workflows: none found (fail-closed)");
    return { ok: false, errors };
  }
  let seen = 0;
  for (const wf of workflows) {
    if (!wf || typeof wf.text !== "string" || typeof wf.path !== "string") {
      push("workflow: malformed entry (expected { path, text })");
      continue;
    }
    if (/^\s*secrets\s*:\s*inherit\b/im.test(wf.text)) {
      push(`${wf.path}: "secrets: inherit" forwards every secret — pass each one explicitly`);
    }
    const { preamble, on, jobs, problems } = parseWorkflow(wf.text);
    for (const p of problems) push(`${wf.path}: ${p} (fail-closed)`);
    const top = secretUses(preamble);
    for (const b of top.bare) push(`${wf.path}: secrets used without a literal name: ${b}`);
    for (const name of top.names) {
      if (name in CREDENTIALS) {
        seen++;
        push(`${wf.path}: ${name} referenced outside a job — scope it to a job in its environment`);
      }
    }
    const onPullRequest = /\bpull_request(_target)?\b/.test(on);
    for (const job of jobs) {
      const env = jobEnvironment(job.body);
      const uses = secretUses(job.body);
      for (const b of uses.bare) {
        push(`${wf.path}:${job.line}: job "${job.id}" uses secrets without a literal name: ${b}`);
      }
      for (const name of uses.names) {
        if (!(name in CREDENTIALS)) continue;
        seen++;
        const allowed = CREDENTIALS[name];
        if (!allowed.includes(env ?? "")) {
          push(
            `${wf.path}:${job.line}: job "${job.id}" reads ${name} in ${env ? `environment "${env}"` : "no environment"} — allowed: ${allowed.join(", ")}`,
          );
        }
      }
      if (
        env &&
        MAIN_ONLY.has(env) &&
        onPullRequest &&
        !excludesPullRequests(jobCondition(job.body))
      ) {
        push(
          `${wf.path}:${job.line}: job "${job.id}" uses main-only environment "${env}" but its if: does not exclude pull_request`,
        );
      }
    }
  }
  if (seen === 0) push("no registered credential referenced by any workflow (fail-closed)");
  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/git/fs plumbing, exercised via CI not unit tests */
function main() {
  const root = new URL("..", import.meta.url);
  const listed = execFileSync("git", ["ls-files", ".github/workflows"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => /\.ya?ml$/.test(p));
  const workflows = listed.map((p) => ({ path: p, text: readFileSync(new URL(p, root), "utf8") }));
  const { ok, errors } = verdict(workflows);
  if (!ok) {
    console.error("✗ release credentials escape their environments:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.info(
    `✓ release credentials OK — ${workflows.length} workflow(s), each credential held only in its environment`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
/* c8 ignore stop */
