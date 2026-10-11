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
 *                 waiting at a gate for an older tag, and with ALSO_CATCH_UP=true every
 *                 ios-submission-catch-up run parked at its gate (the newer release supersedes
 *                 whatever it was about to submit). A run with any job still executing (an F-Droid
 *                 publish, say) is left alone, and each run's jobs are read again just before it is
 *                 cancelled.
 *   catch-up      (ios-submission-catch-up.yml) writes `candidates`, the releases on main that
 *                 shipped the apps, newest first ("tag=commit=year …"); `in-flight`, the tags of
 *                 ios-release runs not yet completed; and `releases`, every trusted release version.
 *   releases      writes `versions`, every trusted release version (space-separated).
 *   wait-turn     (iOS submit job, after the gate) waits until no other App Store submit job that
 *                 started earlier is still running, so prepare and deliver never run for two
 *                 releases at once; jobs parked at the gate do not hold the turn. Writes
 *                 `turn=true`, or `turn=false` after WAIT_MINUTES (default 30).
 *
 * Release tags are trusted as store-release-scope.mjs trusts them: annotated release tags, and
 * lightweight tags only from before the first annotated one.
 *
 * Usage:
 *   WORKFLOW=ios-release.yml TAG=v1.5.1 [ALSO_CATCH_UP=true] node scripts/supersede-store-runs.mjs cancel-stale
 *   [TAG=v1.5.0] node scripts/supersede-store-runs.mjs catch-up
 *   node scripts/supersede-store-runs.mjs releases
 *   node scripts/supersede-store-runs.mjs wait-turn
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

/** The name every App Store submit job ends with (ios-submit.yml's job, under its caller's). */
export const SUBMIT_JOB = "Submit for App Store review";

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
 * Catch-up runs to cancel: parked at the gate, never this run.
 * @param {{ runs: { id: number, status: string }[], jobs: Map<number, { status: string }[]>,
 *   runId: number }} input
 * @returns {number[]}
 */
export function parkedCatchUps({ runs, jobs, runId }) {
  return runs
    .filter((r) => r.id !== runId && r.status === "waiting" && parkedAtGate(jobs.get(r.id) ?? []))
    .map((r) => r.id);
}

/**
 * The submit job this one must wait for: another running submit job that started earlier (ties
 * broken by job id), or null when it is this job's turn.
 * @param {{ id: number, name: string, status: string, started_at?: string | null }[]} jobs
 *   jobs of the in-progress release and catch-up runs
 * @param {number} me this job's id
 */
export function turnHolder(jobs, me) {
  const running = jobs.filter(
    (j) => j.name?.endsWith(SUBMIT_JOB) && j.status === "in_progress" && j.started_at,
  );
  const mine = running.find((j) => j.id === me);
  if (!mine) return null;
  const order = (j) => [Date.parse(j.started_at), j.id];
  return (
    running.find((j) => {
      if (j.id === me) return false;
      const [a, b] = [order(j), order(mine)];
      return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    }) ?? null
  );
}

/**
 * Versions of ios-release runs not yet completed, from their run names; dry runs excluded.
 * @param {{ status: string, display_title: string }[]} runs
 */
export function inFlightTags(runs) {
  return runs
    .filter((r) => r.status !== "completed")
    .map((r) => runTag(r.display_title))
    .filter(Boolean)
    .map((v) => `v${v}`);
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
 * @param {{ records: import("./store-release-scope.mjs").TagRecord[], requested: string }} input
 *   trusted records, newest first
 * @returns {{ candidates: import("./store-release-scope.mjs").TagRecord[] } | { reason: string }}
 */
export function catchUpCandidates({ records, requested }) {
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

const jobsOf = async (id) =>
  (await github("GET", `/actions/runs/${id}/jobs?per_page=100`)).jobs ?? [];

async function cancelRun(id, label) {
  try {
    if (!parkedAtGate(await jobsOf(id))) {
      console.info(`Run ${id} (${label}) is no longer parked at a gate; left alone.`);
      return;
    }
    await github("POST", `/actions/runs/${id}/cancel`);
    console.info(
      `::notice::Cancelled run ${id} (${label}), waiting at a gate for an older release.`,
    );
  } catch (error) {
    console.warn(`::warning::Could not cancel run ${id} (${label}): ${error.message}`);
  }
}

async function waitingRuns(workflow) {
  const { workflow_runs: runs } = await github(
    "GET",
    `/actions/workflows/${workflow}/runs?status=waiting&per_page=100`,
  );
  const jobs = new Map();
  for (const run of runs) jobs.set(run.id, await jobsOf(run.id));
  return { runs, jobs };
}

async function cancelStale() {
  const workflow = process.env["WORKFLOW"];
  const runId = Number(process.env["GITHUB_RUN_ID"]);
  const version = (process.env["TAG"] ?? "").replace(/^v/, "");
  if (!SEMVER.test(version))
    throw new Error(`TAG '${process.env["TAG"]}' is not vMAJOR.MINOR.PATCH`);
  const stale = staleRuns({ ...(await waitingRuns(workflow)), version, runId });
  if (stale.length === 0) console.info("No older run is waiting at a gate.");
  for (const run of stale) await cancelRun(run.id, `v${run.version}`);
  if (process.env["ALSO_CATCH_UP"] === "true") {
    const parked = parkedCatchUps({
      ...(await waitingRuns("ios-submission-catch-up.yml")),
      runId,
    });
    for (const id of parked) await cancelRun(id, "catch-up");
  }
}

function trusted() {
  return trustedRecords(
    parseTagRecords(
      git("for-each-ref", "--merged", "origin/main", `--format=${TAG_FORMAT}`, "refs/tags/v*"),
    ),
    isAncestor,
  );
}

async function catchUp() {
  const { workflow_runs: runs } = await github(
    "GET",
    "/actions/workflows/ios-release.yml/runs?per_page=50",
  );
  const records = trusted();
  const result = catchUpCandidates({ records, requested: process.env["TAG"] ?? "" });
  const inFlight = inFlightTags(runs);
  const releases = records.map((r) => r.version).join(" ");
  if ("reason" in result) {
    output({ candidates: "", "in-flight": inFlight.join(" "), releases });
    console.info(`Nothing to submit: ${result.reason}.`);
    return;
  }
  const entries = result.candidates.map((r) => {
    const year = git("log", "-1", "--format=%cd", "--date=format:%Y", r.commit).trim();
    return `${r.tag}=${r.commit}=${year}`;
  });
  output({ candidates: entries.join(" "), "in-flight": inFlight.join(" "), releases });
  console.info(`Shipped releases, newest first: ${result.candidates.map((r) => r.tag).join(", ")}`);
  if (inFlight.length) console.info(`ios-release runs in flight: ${inFlight.join(", ")}`);
}

async function waitTurn() {
  const runId = Number(process.env["GITHUB_RUN_ID"]);
  const deadline = Date.now() + Number(process.env["WAIT_MINUTES"] ?? 30) * 60000;
  for (;;) {
    const jobs = [];
    let me = null;
    for (const workflow of ["ios-release.yml", "ios-submission-catch-up.yml"]) {
      const { workflow_runs: runs } = await github(
        "GET",
        `/actions/workflows/${workflow}/runs?status=in_progress&per_page=100`,
      );
      for (const run of runs) {
        for (const job of await jobsOf(run.id)) {
          jobs.push(job);
          if (run.id === runId && job.name?.endsWith(SUBMIT_JOB) && job.status === "in_progress") {
            me = job.id;
          }
        }
      }
    }
    if (me === null) throw new Error("cannot find this submit job among the running jobs");
    const holder = turnHolder(jobs, me);
    if (!holder) {
      output({ turn: true });
      return;
    }
    if (Date.now() > deadline) {
      output({ turn: false });
      console.info(
        `::notice::Another App Store submission (${holder.html_url ?? holder.id}) is still running; the catch-up tries again.`,
      );
      return;
    }
    console.info(`Waiting for ${holder.html_url ?? `job ${holder.id}`} to finish.`);
    await new Promise((r) => setTimeout(r, 20000));
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "cancel-stale") return cancelStale();
  if (mode === "catch-up") return catchUp();
  if (mode === "releases")
    return output({
      versions: trusted()
        .map((r) => r.version)
        .join(" "),
    });
  if (mode === "wait-turn") return waitTurn();
  throw new Error("usage: supersede-store-runs.mjs cancel-stale|catch-up|releases|wait-turn");
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
