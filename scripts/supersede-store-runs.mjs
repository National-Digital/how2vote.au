#!/usr/bin/env node
/**
 * @fileoverview Keeps an older release from reaching a store after a newer one, and finds the
 * release the App Store catch-up owes.
 *
 * Each store run waits at a required-reviewer gate (`play-store`, `app-store`), and the release
 * workflows run one concurrency group per tag, so with frequent releases several runs can be
 * waiting at once. Approving an older one would promote a stale build. The gated jobs themselves
 * stand down on store-side evidence of a newer build (scripts/app-store-submission.mjs,
 * scripts/play-promotion.mjs); this tidies up and selects:
 *
 *   cancel-stale  (newer run, after its build succeeds) cancels runs of the same workflow that are
 *                 waiting at a gate for an older tag. A run with any job still executing (an
 *                 F-Droid publish, say) is left alone, and each run's jobs are read again just
 *                 before it is cancelled.
 *   catch-up      (ios-submission-catch-up.yml) lists the releases on main that shipped the apps,
 *                 newest first, as `candidates` ("tag=commit=year …"); empty while an ios-release
 *                 run is in flight. Release tags are trusted as store-release-scope.mjs trusts
 *                 them: annotated release tags, and lightweight tags only from before the first
 *                 annotated one.
 *
 * Usage:
 *   WORKFLOW=ios-release.yml TAG=v1.5.1 node scripts/supersede-store-runs.mjs cancel-stale
 *   [TAG=v1.5.0] node scripts/supersede-store-runs.mjs catch-up
 * GitHub calls use GH_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID. Release tags are read from the
 * checkout this script lives in, which needs main's history (`origin/main`).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isSkipped, parseTagRecords, TAG_FORMAT, trustedRecords } from "./store-release-scope.mjs";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The commit status the iOS submit job records for a release. */
export const appStoreContext = (tag) => `app-store/${tag}`;

/** At most this many shipped releases are offered to the catch-up. */
export const MAX_CANDIDATES = 10;

/** @param {string} a @param {string} b */
function compare(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * The release a run was dispatched for, from its run-name ("iOS release v1.5.0"). Null for a dry
 * run or a run without a tag.
 * @param {string} title
 */
export function runTag(title) {
  if (/\(dry run\)/i.test(title ?? "")) return null;
  const m = /(?:^|\s)v(\d+\.\d+\.\d+)(?:\s|$)/.exec(title ?? "");
  return m && SEMVER.test(m[1]) ? m[1] : null;
}

/**
 * Whether a run is parked at a gate and nothing else: a job waiting, every other job completed.
 * @param {{ status: string }[]} jobs
 */
export function parkedAtGate(jobs) {
  return (
    jobs.some((j) => j.status === "waiting") &&
    jobs.every((j) => j.status === "completed" || j.status === "waiting")
  );
}

/**
 * Runs to cancel: waiting at a gate for an older release, with no job still executing.
 * @param {{ runs: { id: number, status: string, display_title: string }[],
 *   jobs: Map<number, { status: string }[]>, version: string, runId: number }} input
 * @returns {{ id: number, version: string }[]}
 */
export function staleRuns({ runs, jobs, version, runId }) {
  return runs
    .filter((r) => r.id !== runId && r.status === "waiting")
    .map((r) => ({ id: r.id, version: runTag(r.display_title) }))
    .filter((r) => r.version && compare(r.version, version) < 0)
    .filter((r) => parkedAtGate(jobs.get(r.id) ?? []));
}

/**
 * The newest state of `context` among a commit's statuses (GitHub lists newest first).
 * @param {{ context?: string, state?: string }[]} statuses
 * @param {string} context
 */
export function latestState(statuses, context) {
  return statuses.find((s) => s?.context === context)?.state ?? null;
}

/**
 * The releases the catch-up may submit, newest first, or why none.
 * @param {{ records: import("./store-release-scope.mjs").TagRecord[], requested: string,
 *   inFlight: boolean }} input trusted records, newest first
 * @returns {{ candidates: import("./store-release-scope.mjs").TagRecord[] } | { reason: string }}
 */
export function catchUpCandidates({ records, requested, inFlight }) {
  if (inFlight) return { reason: "an iOS release run is in flight; it handles its own submission" };
  if (requested) {
    const record = records.find((r) => r.tag === requested);
    if (!record) return { reason: `${requested} is not a trusted release tag on main` };
    return { candidates: [record] };
  }
  const shipped = records
    .filter((r) => !(r.annotated && isSkipped(r.message)))
    .slice(0, MAX_CANDIDATES);
  return shipped.length ? { candidates: shipped } : { reason: "no release has shipped the apps" };
}

/* c8 ignore start -- git/network/CLI plumbing, exercised in CI */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const git = (...args) =>
  execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });

const isAncestor = (ancestor, descendant) => {
  try {
    git("merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
};

async function github(method, path) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `https://api.github.com/repos/${process.env["GITHUB_REPOSITORY"]}${path}`,
      {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env["GH_TOKEN"]}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    ).catch((error) => error);
    if (res instanceof Error) last = res;
    else if (res.ok) return res.status === 202 || res.status === 204 ? {} : res.json();
    else if (res.status < 500 && res.status !== 429) {
      throw new Error(`${method} ${path}: HTTP ${res.status}`);
    } else last = new Error(`${method} ${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw last;
}

function output(values) {
  const out = process.env["GITHUB_OUTPUT"];
  if (out)
    appendFileSync(
      out,
      Object.entries(values)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
}

async function cancelStale() {
  const workflow = process.env["WORKFLOW"];
  const runId = Number(process.env["GITHUB_RUN_ID"]);
  const version = (process.env["TAG"] ?? "").replace(/^v/, "");
  if (!SEMVER.test(version))
    throw new Error(`TAG '${process.env["TAG"]}' is not vMAJOR.MINOR.PATCH`);
  const jobsOf = async (id) =>
    (await github("GET", `/actions/runs/${id}/jobs?per_page=100`)).jobs ?? [];
  const { workflow_runs: runs } = await github(
    "GET",
    `/actions/workflows/${workflow}/runs?status=waiting&per_page=100`,
  );
  const jobs = new Map();
  for (const run of runs) jobs.set(run.id, await jobsOf(run.id));
  const stale = staleRuns({ runs, jobs, version, runId });
  if (stale.length === 0) console.info("No older run is waiting at a gate.");
  for (const run of stale) {
    try {
      if (!parkedAtGate(await jobsOf(run.id))) {
        console.info(`Run ${run.id} (v${run.version}) is no longer parked at a gate; left alone.`);
        continue;
      }
      await github("POST", `/actions/runs/${run.id}/cancel`);
      console.info(
        `::notice::Cancelled run ${run.id} (v${run.version}), waiting at a gate for an older release.`,
      );
    } catch (error) {
      console.warn(`::warning::Could not cancel run ${run.id} (v${run.version}): ${error.message}`);
    }
  }
}

async function catchUp() {
  const { workflow_runs: runs } = await github(
    "GET",
    "/actions/workflows/ios-release.yml/runs?per_page=50",
  );
  const records = trustedRecords(
    parseTagRecords(
      git("for-each-ref", "--merged", "origin/main", `--format=${TAG_FORMAT}`, "refs/tags/v*"),
    ),
    isAncestor,
  );
  const result = catchUpCandidates({
    records,
    requested: process.env["TAG"] ?? "",
    inFlight: runs.some((r) => r.status !== "completed"),
  });
  if ("reason" in result) {
    output({ candidates: "" });
    console.info(`Nothing to submit: ${result.reason}.`);
    return;
  }
  const entries = result.candidates.map((r) => {
    const year = git("log", "-1", "--format=%cd", "--date=format:%Y", r.commit).trim();
    return `${r.tag}=${r.commit}=${year}`;
  });
  output({ candidates: entries.join(" ") });
  console.info(`Shipped releases, newest first: ${result.candidates.map((r) => r.tag).join(", ")}`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "cancel-stale") return cancelStale();
  if (mode === "catch-up") return catchUp();
  throw new Error("usage: supersede-store-runs.mjs cancel-stale|catch-up");
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
