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
 *   - the one exception is a job that calls a local reusable workflow (`uses: ./.github/workflows/…`)
 *     and passes a credential under its own name in a `secrets:` block (`X: ${{ secrets.X }}`):
 *     allowed only when the called workflow reads X in at least one job, and every job there that
 *     reads it declares an environment listed for X, and the caller excludes untrusted triggers as
 *     below.
 *     GitHub gives such a job the environment's value, when the environment holds X, in place of
 *     the passed one, and a called workflow sees no secret its caller does not pass;
 *   - no registered credential is referenced outside a job (workflow-level `env:`);
 *   - the secrets context is only ever indexed by a literal name: `toJSON(secrets)`,
 *     `secrets[expr]` and `secrets: inherit` would hand over every secret the job can see;
 *   - in a workflow with any trigger outside SAFE_TRIGGERS (pull_request, pull_request_target,
 *     workflow_run, issue_comment, …), a job that reads a credential, passes one on, or names a
 *     main-only environment has an `if:` that is a plain conjunction pinning the event to safe
 *     triggers. `pull_request_target` runs with `github.ref` set to main, so only the event name
 *     counts;
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
  // Admin key on ios-build (only Admin can cloud-sign); App Manager key on app-store.
  ASC_KEY_ID: ["ios-build", "app-store"],
  ASC_ISSUER_ID: ["ios-build", "app-store"],
  ASC_API_KEY_P8: ["ios-build", "app-store"],
  PLAY_SHARE_SERVICE_ACCOUNT_JSON: ["play-share"],
  PLAY_SHARE_KEYSTORE: ["play-share"],
  PLAY_SHARE_KEYSTORE_PASSWORD: ["play-share"],
  PLAY_SHARE_KEY_ALIAS: ["play-share"],
  PLAY_SHARE_KEY_PASSWORD: ["play-share"],
};

/** Triggers an untrusted pull request cannot start. */
export const SAFE_TRIGGERS = new Set([
  "push",
  "schedule",
  "workflow_dispatch",
  "workflow_call",
  "release",
]);

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
 * The workflow's trigger names from its `on:` block (scalar, flow list, block list or mapping), or
 * null when the layout is not recognised.
 *
 * @param {string} on
 * @returns {Set<string> | null}
 */
export function workflowTriggers(on) {
  const lines = String(on)
    .split("\n")
    .filter((l) => !isSkippable(l));
  const head = /^(["']?)(?:on|true)\1\s*:(.*)$/.exec(lines[0] ?? "");
  if (!head) return null;
  const value = unquote(head[2]);
  const names = new Set();
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) return null;
    for (const n of value.slice(1, -1).split(",")) if (unquote(n)) names.add(unquote(n));
  } else if (value !== "") {
    names.add(value);
  } else {
    for (const line of lines.slice(1)) {
      const indent = indentOf(line);
      if (indent > 2) continue;
      const m = /^ {2}(?:-\s+)?(["']?)([A-Za-z_]+)\1\s*(?::.*)?$/.exec(line);
      if (indent !== 2 || !m) return null;
      names.add(m[2]);
    }
  }
  for (const n of names) if (!/^[A-Za-z_]+$/.test(n)) return null;
  return names.size ? names : null;
}

/**
 * True when the condition is false for every event in `untrusted`: a conjunction (no `||`
 * anywhere) with a top-level term `github.event_name == '<safe trigger>'`, or
 * `github.event_name != 'pull_request'` when pull_request is the only untrusted trigger.
 * `github.ref == 'refs/heads/main'` does not count: it holds under pull_request_target.
 *
 * @param {string} condition
 * @param {Set<string>} [untrusted]
 */
export function excludesUntrustedEvents(condition, untrusted = new Set(["pull_request"])) {
  let expr = condition.replace(/\s+/g, " ").trim();
  const wrapped = /^\$\{\{(.*)\}\}$/.exec(expr);
  if (wrapped) expr = wrapped[1].trim();
  if (expr === "" || expr.includes("||") || expr.includes("${{")) return false;
  const onlyPullRequest = untrusted.size === 1 && untrusted.has("pull_request");
  return splitTopLevel(expr, "&&").some((t) => {
    const pin = /^github\.event_name\s*==\s*(['"])([A-Za-z_]+)\1$/i.exec(t);
    if (pin) return SAFE_TRIGGERS.has(pin[2].toLowerCase());
    return onlyPullRequest && /^github\.event_name\s*!=\s*(['"])pull_request\1$/i.test(t);
  });
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
 * A reusable-workflow call's `secrets:` block. Each entry must be `NAME: ${{ secrets.NAME }}`, the
 * caller's secret passed under its own name; anything else is a problem. `rest` is the job body
 * without the block, so a secret named anywhere else in the job is still checked as a plain read.
 *
 * @param {string} body
 * @returns {{ passed: string[], rest: string, problems: string[] }}
 */
export function passedSecrets(body) {
  const lines = body.split("\n");
  const passed = [];
  const problems = [];
  const rest = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}secrets:(.*)$/.exec(lines[i]);
    if (!m) {
      rest.push(lines[i]);
      continue;
    }
    if (unquote(m[1]) !== "") problems.push(`secrets is not a block mapping: ${lines[i].trim()}`);
    for (; i + 1 < lines.length && (isSkippable(lines[i + 1]) || indentOf(lines[i + 1]) > 4); i++) {
      const line = lines[i + 1];
      if (isSkippable(line)) continue;
      const e =
        /^ {6}([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}\s*(#.*)?$/.exec(
          line,
        );
      if (e && e[1].toUpperCase() === e[2].toUpperCase()) passed.push(e[1].toUpperCase());
      else problems.push(`secrets entry is not NAME: \${{ secrets.NAME }}: ${line.trim()}`);
    }
  }
  return { passed, rest: rest.join("\n"), problems };
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
    const triggers = workflowTriggers(on);
    if (!triggers) push(`${wf.path}: unrecognised on: block (fail-closed)`);
    const untrusted = new Set([...(triggers ?? ["unknown"])].filter((t) => !SAFE_TRIGGERS.has(t)));
    const guarded = (job) =>
      untrusted.size === 0 || excludesUntrustedEvents(jobCondition(job.body), untrusted);
    const listed = [...untrusted].join(", ");
    for (const job of jobs) {
      const env = jobEnvironment(job.body);
      const call = /^ {4}uses:(.*)$/m.exec(job.body);
      let body = job.body;
      if (call) {
        const where = `${wf.path}:${job.line}: job "${job.id}"`;
        const pass = passedSecrets(job.body);
        for (const p of pass.problems) push(`${where}: ${p} (fail-closed)`);
        body = pass.rest;
        const target = /^\.\/(\.github\/workflows\/[\w.-]+\.ya?ml)$/.exec(unquote(call[1]))?.[1];
        const callee = target && workflows.find((w) => w?.path === target);
        const credentials = pass.passed.filter((name) => name in CREDENTIALS);
        if (credentials.length && !guarded(job)) {
          push(
            `${where} passes credentials but its if: does not exclude untrusted triggers (${listed})`,
          );
        }
        for (const name of credentials) {
          seen++;
          const allowed = CREDENTIALS[name];
          if (!callee || typeof callee.text !== "string") {
            push(
              `${where} passes ${name} to ${unquote(call[1])}, not a workflow in this repository`,
            );
            continue;
          }
          const readers = parseWorkflow(callee.text).jobs.filter((j) =>
            secretUses(j.body).names.has(name),
          );
          if (readers.length === 0)
            push(`${where} passes ${name} to ${target}, which no job reads`);
          for (const r of readers) {
            const renv = jobEnvironment(r.body);
            if (!allowed.includes(renv ?? "")) {
              push(
                `${where} passes ${name} to ${target} job "${r.id}" in ${renv ? `environment "${renv}"` : "no environment"} — allowed: ${allowed.join(", ")}`,
              );
            }
          }
        }
      }
      const uses = secretUses(body);
      for (const b of uses.bare) {
        push(`${wf.path}:${job.line}: job "${job.id}" uses secrets without a literal name: ${b}`);
      }
      const reads = [...uses.names].filter((name) => name in CREDENTIALS);
      if (reads.length && !guarded(job)) {
        push(
          `${wf.path}:${job.line}: job "${job.id}" reads ${reads.join(", ")} but its if: does not exclude untrusted triggers (${listed})`,
        );
      }
      for (const name of reads) {
        seen++;
        const allowed = CREDENTIALS[name];
        if (!allowed.includes(env ?? "")) {
          push(
            `${wf.path}:${job.line}: job "${job.id}" reads ${name} in ${env ? `environment "${env}"` : "no environment"} — allowed: ${allowed.join(", ")}`,
          );
        }
      }
      if (env && MAIN_ONLY.has(env) && !guarded(job)) {
        push(
          `${wf.path}:${job.line}: job "${job.id}" uses main-only environment "${env}" but its if: does not exclude untrusted triggers (${listed})`,
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
