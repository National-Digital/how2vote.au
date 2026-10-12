#!/usr/bin/env node
/**
 * @fileoverview Opens, updates or closes the issue that tracks a failed store run.
 *
 * Each store workflow ends with a job that calls .github/workflows/store-release-alert.yml with the
 * results of the jobs it needs. One open issue, labelled `store-release-failure` and titled
 * "<name> <tag> failed" (or "<untagged name> failed" when there is no valid tag), stands for each
 * failing release:
 *
 *   failure  a job failed (a timeout included): open the issue, or note the run on the open one. A
 *            comment is added at most once a day; a run inside that window updates a counter in
 *            the issue body instead.
 *   success  no job failed, the terminal job (promote, submit, probe) succeeded, and the caller
 *            says such a run resolves: close the open issue, and the issues of older releases with
 *            the same name, which this release supersedes.
 *   none     anything else (a cancelled job, a skipped terminal job, a run that does not
 *            resolve): leave the issues alone.
 *
 * A deferred, skipped or retryable outcome that finishes green (an App Store submission recorded
 * `pending`) never opens an issue. CLEAR_UNTAGGED also closes the "<untagged name> failed" issue
 * when the caller knows the steps that can fail before a release is chosen went green.
 *
 * Usage:
 *   NAME='Android release' TAG=v1.5.0 RESULTS='{"build":{"result":"failure"}}' TERMINAL=promote \
 *     RUN_URL=https://… GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/store-release-alert.mjs
 *   Optional: UNTAGGED_NAME, RESOLVES (default true), CLEAR_UNTAGGED (default false).
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LABEL = "store-release-failure";
const LABEL_COLOR = "b60205";
const RUNBOOK = "docs/store-distribution.md";
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** Repeat failures inside this window update the counter instead of commenting. */
export const QUIET_MS = 24 * 60 * 60 * 1000;
const REPEAT_LINE = /^Repeat failures: \d+, latest .*$/m;
const REPEAT_PREFIX = "Failed again.";

/** @param {string} a @param {string} b vX.Y.Z tags */
function compareTags(a, b) {
  const [x, y] = [a, b].map((t) => t.slice(1).split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The issue title: "<name> <tag> failed" for a valid tag, else "<untaggedName or name> failed".
 * @param {{ name: string, tag?: string, untaggedName?: string }} input
 */
export function issueTitle({ name, tag = "", untaggedName = "" }) {
  const base = clean(name);
  if (!base) throw new Error("NAME must be set");
  const t = clean(tag);
  if (TAG.test(t)) return `${base} ${t} failed`;
  return `${clean(untaggedName) || base} failed`;
}

/**
 * Job id → result, from `toJSON(needs)` (`{ id: { result, outputs } }`) or a plain
 * `{ id: "result" }` map.
 * @param {string} json
 * @returns {Record<string, string>}
 */
export function parseResults(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("RESULTS is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("RESULTS must be an object of job results");
  }
  const results = {};
  for (const [job, entry] of Object.entries(parsed)) {
    const result = typeof entry === "string" ? entry : entry?.result;
    if (typeof result !== "string" || !result) throw new Error(`RESULTS has no result for ${job}`);
    results[job] = result;
  }
  if (Object.keys(results).length === 0) throw new Error("RESULTS names no job");
  return results;
}

/**
 * A cancelled job is never a failure: cancellation is deliberate (a superseded run, a pending job
 * replaced in its concurrency group).
 * @param {{ results: Record<string, string>, terminal: string, resolves: boolean }} input
 * @returns {{ outcome: "failure" | "success" | "none", failed: { job: string, result: string }[] }}
 */
export function outcomeOf({ results, terminal, resolves }) {
  const failed = Object.entries(results)
    .filter(([, result]) => result === "failure")
    .map(([job, result]) => ({ job, result }));
  if (failed.length) return { outcome: "failure", failed };
  const done = Boolean(terminal) && results[terminal] === "success";
  return { outcome: resolves && done ? "success" : "none", failed };
}

/**
 * @typedef {{ number: number, title: string, body?: string | null, created_at?: string,
 *   pull_request?: object }} Issue
 * @typedef {{ type: "create", title: string, body: string }
 *   | { type: "comment", number: number, body: string }
 *   | { type: "edit", number: number, body: string }
 *   | { type: "close", number: number, body: string }} Action
 */

/**
 * @param {Issue[]} issues open issues carrying LABEL
 * @param {string} title
 */
export function findIssue(issues, title) {
  return issues.find((i) => !i.pull_request && i.title === title) ?? null;
}

/**
 * Open issues of releases older than `tag` with the same name.
 * @param {Issue[]} issues
 * @param {string} name
 * @param {string} tag
 */
export function olderIssues(issues, name, tag) {
  if (!TAG.test(tag)) return [];
  const prefix = `${clean(name)} `;
  const suffix = " failed";
  return issues.filter((i) => {
    if (i.pull_request || !i.title.startsWith(prefix) || !i.title.endsWith(suffix)) return false;
    const t = i.title.slice(prefix.length, -suffix.length);
    return TAG.test(t) && compareTags(t, tag) < 0;
  });
}

/**
 * The body with its repeat counter incremented and pointing at `runUrl`.
 * @param {string | null | undefined} body
 * @param {string} runUrl
 */
export function bumpCounter(body, runUrl) {
  const text = body ?? "";
  const m = /^Repeat failures: (\d+),/m.exec(text);
  const line = `Repeat failures: ${m ? Number(m[1]) + 1 : 1}, latest ${runUrl}`;
  return m ? text.replace(REPEAT_LINE, line) : `${text}\n\n${line}`;
}

/**
 * What to do with the issues.
 * @param {{ outcome: "failure" | "success" | "none", title: string, existing: Issue | null,
 *   older?: Issue[], untagged?: Issue | null, recent?: boolean, runUrl: string,
 *   failed: { job: string, result: string }[] }} input
 *   older: issues this success supersedes; untagged: the untagged issue to clear; recent: the
 *   existing issue was opened or commented on inside QUIET_MS
 * @returns {Action[]}
 */
export function plan({
  outcome,
  title,
  existing,
  older = [],
  untagged = null,
  recent = false,
  runUrl,
  failed,
}) {
  /** @type {Action[]} */
  const actions = [];
  const close = (issue, body) => actions.push({ type: "close", number: issue.number, body });
  if (untagged && !(outcome === "failure" && untagged.title === title)) {
    close(untagged, `Resolved: ${runUrl} got past the steps this issue reported.`);
  }
  if (outcome === "success") {
    if (existing) close(existing, `Resolved: ${runUrl} succeeded.`);
    for (const issue of older) {
      if (issue.number !== existing?.number) {
        close(issue, `Superseded: a newer release succeeded in ${runUrl}.`);
      }
    }
    return actions;
  }
  if (outcome !== "failure") return actions;
  const jobs = failed.map((f) => `- \`${f.job}\`: ${f.result}`).join("\n");
  const report = `Run: ${runUrl}\n\nFailing jobs:\n${jobs}`;
  if (existing && recent) {
    actions.push({
      type: "edit",
      number: existing.number,
      body: bumpCounter(existing.body, runUrl),
    });
  } else if (existing) {
    actions.push({
      type: "comment",
      number: existing.number,
      body: `${REPEAT_PREFIX}\n\n${report}`,
    });
  } else {
    actions.push({
      type: "create",
      title,
      body:
        `${report}\n\nWhat to do for each store is in ${RUNBOOK} ("Failure alerts"). ` +
        "A later successful run of the same release, or of a newer one, closes this issue.",
    });
  }
  return actions;
}

/**
 * Whether the issue was opened, or last noted a repeat failure, inside QUIET_MS of `now`.
 * @param {Issue} issue
 * @param {{ body?: string, created_at?: string }[]} comments the issue's recent comments
 * @param {number} now
 */
export function recentlyAlerted(issue, comments, now) {
  const inWindow = (at) => Boolean(at) && now - Date.parse(at) < QUIET_MS;
  return (
    inWindow(issue.created_at) ||
    comments.some((c) => Boolean(c.body?.startsWith(REPEAT_PREFIX)) && inWindow(c.created_at))
  );
}

/**
 * Every open issue carrying LABEL, across pages.
 * @param {(method: string, path: string, body?: object) => Promise<any>} api
 * @returns {Promise<Issue[]>}
 */
export async function openIssues(api) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch =
      (await api(
        "GET",
        `/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`,
      )) ?? [];
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

/**
 * Reads the open issues, applies the plan and returns it.
 * @param {{ api: (method: string, path: string, body?: object) => Promise<any>,
 *   name: string, tag?: string, untaggedName?: string, results: Record<string, string>,
 *   terminal: string, resolves: boolean, clearUntagged?: boolean, runUrl: string,
 *   now?: number }} input
 * @returns {Promise<{ outcome: string, actions: Action[] }>}
 */
export async function report({
  api,
  name,
  tag = "",
  untaggedName = "",
  results,
  terminal,
  resolves,
  clearUntagged = false,
  runUrl,
  now = Date.now(),
}) {
  const title = issueTitle({ name, tag, untaggedName });
  const { outcome, failed } = outcomeOf({ results, terminal, resolves });
  if (outcome === "none" && !clearUntagged) return { outcome, actions: [] };
  const issues = await openIssues(api);
  const existing = findIssue(issues, title);
  let recent = false;
  if (outcome === "failure" && existing) {
    const since = new Date(now - QUIET_MS).toISOString();
    const comments =
      (await api("GET", `/issues/${existing.number}/comments?since=${since}&per_page=100`)) ?? [];
    recent = recentlyAlerted(existing, comments, now);
  }
  const actions = plan({
    outcome,
    title,
    existing,
    older: outcome === "success" ? olderIssues(issues, name, clean(tag)) : [],
    untagged: clearUntagged ? findIssue(issues, issueTitle({ name, untaggedName })) : null,
    recent,
    runUrl,
    failed,
  });
  for (const action of actions) {
    if (action.type === "create") {
      await api("POST", "/labels", {
        name: LABEL,
        color: LABEL_COLOR,
        description: "A store release workflow failed",
      }).catch((error) => {
        if (error.status !== 422) throw error;
      });
      await api("POST", "/issues", { title: action.title, body: action.body, labels: [LABEL] });
    } else if (action.type === "comment") {
      await api("POST", `/issues/${action.number}/comments`, { body: action.body });
    } else if (action.type === "edit") {
      await api("PATCH", `/issues/${action.number}`, { body: action.body });
    } else {
      await api("POST", `/issues/${action.number}/comments`, { body: action.body });
      await api("PATCH", `/issues/${action.number}`, {
        state: "closed",
        state_reason: "completed",
      });
    }
  }
  return { outcome, actions };
}

/* c8 ignore start -- network/CLI plumbing, exercised in CI */
async function github(method, path, body) {
  const res = await fetch(
    `https://api.github.com/repos/${process.env["GITHUB_REPOSITORY"]}${path}`,
    {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env["GH_TOKEN"]}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!res.ok) {
    const error = new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const { outcome, actions } = await report({
    api: github,
    name: process.env["NAME"] ?? "",
    tag: process.env["TAG"] ?? "",
    untaggedName: process.env["UNTAGGED_NAME"] ?? "",
    results: parseResults(process.env["RESULTS"] ?? ""),
    terminal: process.env["TERMINAL"] ?? "",
    resolves: process.env["RESOLVES"] !== "false",
    clearUntagged: process.env["CLEAR_UNTAGGED"] === "true",
    runUrl: process.env["RUN_URL"] ?? "",
  });
  const verb = {
    create: "opened an issue",
    comment: "commented on",
    edit: "counted a repeat on",
    close: "closed",
  };
  const done = actions.map((a) =>
    a.type === "create" ? verb.create : `${verb[a.type]} #${a.number}`,
  );
  const line = `${outcome}: ${done.length ? done.join(", ") : "no issue change"}`;
  console.info(line);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) appendFileSync(file, `### Store release alert\n- ${line}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
/* c8 ignore stop */
