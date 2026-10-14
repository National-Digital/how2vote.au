#!/usr/bin/env node
/**
 * @fileoverview Claims the release tag for a merge to main (deploy.yml, release job).
 *
 * Push runs of deploy.yml run concurrently, so the version and the ship decision are settled here
 * against the remote's tags, after the deploys of earlier untagged merges finish. A lost push
 * race retries with the next version; a tag is never moved or overwritten.
 *
 * Usage: SHA=… REPO=… GH_TOKEN=… PR_TEXT_FILE=… [MARKER_LOOKUP=failed] node scripts/release-tag.mjs
 * Writes `action` (created|existing|superseded), `tag`, `ship`, `base`, `reason`, `waited` and
 * `shipped-by` to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { latestTag, nextVersion } from "./next-version.mjs";
import {
  decide,
  isSkipped,
  lastShipped,
  parseTagRecords,
  selectBase,
  TAG_FORMAT,
  TRAILER,
  trustedRecords,
} from "./store-release-scope.mjs";

/** Push attempts before giving up on a contended version. */
export const MAX_ATTEMPTS = 5;
/** How long to wait for earlier merges' deploys: their build job's timeout plus margin. */
export const WAIT_LIMIT_MS = 30 * 60_000;
export const POLL_MS = 20_000;
/** At most this many untagged ancestors are checked for an in-progress deploy. */
export const MAX_PENDING = 20;
export const WORKFLOW = "deploy.yml";

const BOT = [
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=41898282+github-actions[bot]@users.noreply.github.com",
];
/** Only a tag on main can supersede a commit; a tag elsewhere is a clash. */
const MAIN = "refs/remotes/origin/main";

/** @typedef {import("./store-release-scope.mjs").TagRecord} TagRecord */

/** @param {string} tag @param {boolean} ship */
export const tagMessage = (tag, ship) => `${tag}\n\n${TRAILER}: ${ship ? "ship" : "skip"}\n`;

/**
 * Where a commit stands, from the release tags on it or on its descendants. Only an annotated
 * tag, as this script creates, supersedes the commit; a lightweight one is hand-made.
 * @param {string} sha
 * @param {TagRecord[]} containing tags on main whose commit is `sha` or a descendant, newest first
 * @returns {{ state: "tagged", record: TagRecord } | { state: "superseded", records: TagRecord[] }
 *   | { state: "untagged" }}
 */
export function standing(sha, containing) {
  const own = containing.find((r) => r.commit === sha);
  if (own) return { state: "tagged", record: own };
  const later = containing.filter((r) => r.annotated);
  if (later.length > 0) return { state: "superseded", records: later };
  return { state: "untagged" };
}

/** @param {TagRecord} record */
const shipped = (record) => record.annotated && !isSkipped(record.message);

/**
 * The commits with a deploy.yml run still in progress, from a runs listing.
 * @param {{ workflow_runs?: { head_sha?: string, status?: string }[] }} listing
 * @returns {Set<string>}
 */
export function busyCommits(listing) {
  return new Set(
    (listing?.workflow_runs ?? [])
      .filter((r) => r?.status !== "completed" && r?.head_sha)
      .map((r) => /** @type {string} */ (r.head_sha)),
  );
}

/**
 * @typedef {{
 *   fetchTags: () => void,
 *   records: (scope: "merged" | "contains" | "all") => TagRecord[],
 *   isAncestor: (ancestor: string, descendant: string) => boolean,
 *   subjectsSince: (tag: string) => string[],
 *   headSubject: () => string,
 *   changedPaths: (base: string) => string[],
 *   history: (base: string) => string,
 *   ancestorsSince: (tag: string | null, max: number) => string[],
 *   pushTag: (tag: string, message: string) => boolean,
 * }} Repo all relative to the commit being released
 */

/**
 * The ship decision for the commit, against the newest trusted non-skip tag reachable from it.
 * @param {Repo} repo
 * @param {TagRecord[]} merged
 * @param {{ prText: string, lookupFailed: boolean }} markers
 */
export function decideFor(repo, merged, { prText, lookupFailed }) {
  const base = selectBase("push", lastShipped(trustedRecords(merged, repo.isAncestor))) ?? null;
  const decision = decide({
    paths: base ? repo.changedPaths(base) : null,
    prText,
    history: base ? repo.history(base) : "",
    lookupFailed,
  });
  return { ...decision, base };
}

/**
 * Waits while a deploy of an untagged ancestor is still running, so that ancestor tags first.
 * Returns whether it waited, or could not tell: an ancestor's deploy may then have finished after
 * this commit's.
 * @param {Repo} repo
 * @param {{ sha: string, running: () => Promise<Set<string>>,
 *   sleep: (ms: number) => Promise<void>, now: () => number, log: (line: string) => void,
 *   limitMs?: number }} io
 */
export async function waitForAncestors(repo, { sha, running, sleep, now, log, limitMs }) {
  const deadline = now() + (limitMs ?? WAIT_LIMIT_MS);
  let waited = false;
  for (;;) {
    repo.fetchTags();
    if (standing(sha, repo.records("contains")).state !== "untagged") return waited;
    const latest = latestTag(repo.records("merged").map((r) => r.tag));
    const pending = repo
      .ancestorsSince(latest?.tag ?? null, MAX_PENDING + 1)
      .filter((c) => c !== sha)
      .slice(0, MAX_PENDING);
    let inFlight;
    try {
      inFlight = await running();
    } catch (error) {
      // Unknown counts as waited, so the release job redeploys main.
      log(`::warning::could not read the deploy runs: ${error.message}`);
      return true;
    }
    const busy = pending.filter((c) => inFlight.has(c));
    if (busy.length === 0) return waited;
    if (now() >= deadline) {
      log(`::warning::stopped waiting for the deploys of ${busy.join(", ")}`);
      return true;
    }
    log(`Waiting for the deploys of earlier merges to tag first: ${busy.join(", ")}`);
    waited = true;
    await sleep(POLL_MS);
  }
}

/**
 * Claims the commit's release tag. Never moves or overwrites a tag.
 * @param {Repo} repo
 * @param {{ sha: string, prText?: string, lookupFailed?: boolean,
 *   log?: (line: string) => void }} input
 * @returns {{ action: "created" | "existing" | "superseded", tag: string, ship?: boolean,
 *   base?: string | null, reason?: string, shippedBy?: string }} shippedBy names a later ship
 *   release already tagged; this release then dispatches no store build
 */
export function claimTag(repo, { sha, prText = "", lookupFailed = false, log = () => {} }) {
  const markers = { prText, lookupFailed };
  // A store build of a lower version must not follow a higher one that shipped.
  const shippedLater = (containing) =>
    containing.filter((r) => r.commit !== sha && shipped(r)).at(-1)?.tag;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    repo.fetchTags();
    const containing = repo.records("contains");
    const where = standing(sha, containing);
    if (where.state === "tagged") {
      const { tag, annotated, message } = where.record;
      if (!annotated) {
        throw new Error(
          `${tag} on this commit is a lightweight tag, not a release tag this job made`,
        );
      }
      return {
        action: "existing",
        tag,
        ship: !isSkipped(message),
        shippedBy: shippedLater(containing),
      };
    }
    const merged = repo.records("merged");
    if (where.state === "superseded") {
      // The oldest descendant release is the one that carries this commit's changes.
      const by = where.records.at(-1);
      const own = decideFor(repo, merged, markers);
      if (own.ship && !where.records.some(shipped)) {
        throw new Error(
          `${where.records.map((r) => r.tag).join(", ")} already contain this commit and none ` +
            `shipped the apps — merge a follow-up carrying [ship-apps] so these app changes ` +
            `reach the stores`,
        );
      }
      return { action: "superseded", tag: by.tag };
    }

    const { next } = nextVersion({
      tags: merged.map((r) => r.tag),
      subjectsSince: repo.subjectsSince,
      headSubject: repo.headSubject,
    });
    const tag = `v${next.join(".")}`;
    const clash = repo.records("all").find((r) => r.tag === tag);
    if (clash) {
      throw new Error(
        `${tag} already exists at ${clash.commit} and is not a release tag this job can build on ` +
          `— delete or rename it`,
      );
    }
    const decision = decideFor(repo, merged, markers);
    if (repo.pushTag(tag, tagMessage(tag, decision.ship))) {
      repo.fetchTags();
      return {
        action: "created",
        tag,
        ...decision,
        shippedBy: shippedLater(repo.records("contains")),
      };
    }
    log(`${tag} was taken by a concurrent release (attempt ${attempt}/${MAX_ATTEMPTS})`);
  }
  throw new Error(`could not claim a release tag in ${MAX_ATTEMPTS} attempts`);
}

/**
 * A Repo over a local clone whose `origin` is the source of truth.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, sha: string }} options
 * @returns {Repo}
 */
export function gitRepo({ cwd, env, sha }) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 64 << 20,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const lines = (out) => out.split("\n").filter(Boolean);
  const isAncestor = (ancestor, descendant) => {
    try {
      git("merge-base", "--is-ancestor", ancestor, descendant);
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };
  const fetchTags = () =>
    git(
      "fetch",
      "--quiet",
      "--force",
      "origin",
      "+refs/tags/v*:refs/tags/v*",
      `+refs/heads/main:${MAIN}`,
    );
  const scopes = {
    merged: ["--merged", sha],
    contains: ["--contains", sha, "--merged", MAIN],
    all: [],
  };
  return {
    fetchTags,
    records: (scope) =>
      parseTagRecords(
        git("for-each-ref", ...scopes[scope], `--format=${TAG_FORMAT}`, "refs/tags/v*"),
      ),
    isAncestor,
    subjectsSince: (tag) => lines(git("log", "--format=%s", `${tag}..${sha}`)),
    headSubject: () => git("log", "-1", "--format=%s", sha).trim(),
    changedPaths: (base) =>
      git("diff", "--name-only", "--no-renames", "-z", base, sha).split("\0").filter(Boolean),
    history: (base) => git("log", "--format=%B", `${base}..${sha}`),
    ancestorsSince: (tag, max) =>
      lines(git("rev-list", `--max-count=${max}`, sha, ...(tag ? ["--not", tag] : []))),
    pushTag: (tag, message) => {
      git(...BOT, "tag", "-a", tag, sha, "-m", message);
      try {
        git("push", "--quiet", "origin", `refs/tags/${tag}`);
        return true;
      } catch (error) {
        git("tag", "-d", tag);
        fetchTags();
        let remote;
        try {
          remote = git("rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`).trim();
        } catch {
          // The remote does not have the tag, so the push failed for another reason.
          throw error;
        }
        // A push reported as failed that landed anyway is this run's own tag.
        return remote === sha;
      }
    },
  };
}

/* c8 ignore start -- CLI and network plumbing, exercised in CI */
async function runningDeploys() {
  const res = await fetch(
    `https://api.github.com/repos/${process.env["REPO"]}/actions/workflows/${WORKFLOW}/runs` +
      `?event=push&branch=main&per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env["GH_TOKEN"]}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: globalThis.AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return busyCommits(await res.json());
}

async function main() {
  const sha = process.env["SHA"] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("SHA must be a full commit id");
  const textFile = process.env["PR_TEXT_FILE"];
  const repo = gitRepo({ sha });
  const log = (line) => console.error(line);
  const waited = await waitForAncestors(repo, {
    sha,
    running: runningDeploys,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    log,
  });
  const result = claimTag(repo, {
    sha,
    prText: textFile ? readFileSync(textFile, "utf8") : "",
    lookupFailed: process.env["MARKER_LOOKUP"] === "failed",
    log,
  });
  const out = process.env["GITHUB_OUTPUT"];
  if (out) {
    appendFileSync(
      out,
      `action=${result.action}\ntag=${result.tag}\nship=${result.ship ?? ""}\n` +
        `base=${result.base ?? ""}\nreason=${result.reason ?? ""}\nwaited=${waited}\n` +
        `shipped-by=${result.shippedBy ?? ""}\n`,
    );
  }
  const text =
    result.action === "created"
      ? `### Release ${result.tag}: ${result.ship ? "ship the apps" : "skip the apps"}\n\n` +
        `- reason: ${result.reason}\n- compared against: ${result.base || "nothing"}`
      : result.action === "existing"
        ? `### Release ${result.tag}: already tagged on this commit`
        : `### Released as part of ${result.tag}, which contains this commit`;
  console.info(text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `${text}\n`);
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
