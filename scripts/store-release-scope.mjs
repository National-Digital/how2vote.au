#!/usr/bin/env node
/**
 * @fileoverview Whether a release ships the native apps, and which version F-Droid is told about.
 *
 * Every merge to main is a web release, but a store release costs an App Review, a Play rollout
 * and an F-Droid build. A release dispatches the store workflows only when something that reaches
 * the apps (or how they are built and listed) changed since the last release whose apps shipped.
 *
 * The rule is a deny-list: a path is app-affecting unless it is known not to be. Unknown paths
 * ship. The deny-list covers repository docs and community files, CI that is not part of a store
 * build, tests, the Pages Functions and their migrations, deploy and infra tooling, and the data
 * pipeline (whose outputs are committed under data/). Exceptions inside those trees are listed in
 * APP_PATHS and APP_SCRIPTS. Dependency changes (pnpm-lock.yaml) and changes to the store
 * workflows and composite actions always ship: they change the bytes of the binary, and F-Droid
 * only publishes a version whose APK we built from that exact tree.
 *
 * `[ship-apps]` in the merged pull request's title or body, or in any commit message since the
 * base, ships the apps regardless. `[skip-apps]` in the pull request's title or body holds back an
 * app-affecting change; because the base stays at the last release that shipped, those changes
 * ship with the next release that does. `[ship-apps]` wins when both are present. A marker inside
 * backticks, or joined to a word, is ignored so the markers can be written about.
 *
 * The decision is recorded on the release tag: deploy.yml creates it annotated, with a
 * `Store-Release: ship|skip` trailer. The diff base is the newest trusted release tag not marked
 * `skip`. Lightweight tags are legacy releases and count as shipped and published, but only
 * those that predate the first annotated release tag (see trustedRecords).
 *
 * https://how2vote.au/app-version.json advertises the newest trusted release tag whose F-Droid APK
 * is published: a legacy tag, or a ship tag whose commit carries a success `fdroid-apk/<tag>`
 * status pointing at the android-release run on main that verified the served APK. fdroid-publish
 * writes that status and redeploys, so the endpoint advances as soon as the APK exists and never
 * before. When the records cannot be read, the endpoint keeps the version it already serves.
 *
 * Usage (deploy.yml):
 *   EVENT=push PR_TEXT_FILE=… node scripts/store-release-scope.mjs
 *   EVENT=pull_request PR_TEXT_FILE=… node scripts/store-release-scope.mjs   # summary only
 *   EVENT=schedule node scripts/store-release-scope.mjs                      # store version only
 *   node scripts/store-release-scope.mjs --classify < paths   # prints true if any path ships
 * Writes `ship`, `base`, `reason` and `store-version` to $GITHUB_OUTPUT and the decision to the
 * job summary. MARKER_LOOKUP=failed means the pull request text could not be read; the release
 * then ships. On any event but pull_request, a failure to read the git tags fails the step.
 * Reads statuses and workflow runs with GH_TOKEN.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SHIP_MARKER = "[ship-apps]";
export const SKIP_MARKER = "[skip-apps]";
export const TRAILER = "Store-Release";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Root scripts a store build runs (store workflows, composite actions), with their relative
 * imports. store-release-scope.test.mjs derives this set from those files and fails on drift.
 */
export const APP_SCRIPTS = new Set([
  "scripts/build-native-documents.mjs",
  "scripts/check-native-answer-scale.mjs",
  "scripts/check-play-permission.mjs",
  "scripts/fdroid-recipe-build.mjs",
  "scripts/generate-app-version.mjs",
  "scripts/generate-store-metadata.mjs",
  "scripts/play-auth.mjs",
]);

/** App-affecting paths inside otherwise denied trees. */
const APP_PATHS = [
  /^docs\/research\//, // $docs imports in the web bundle
  /^docs\/fdroid\//, // the recipe android-release replays for the F-Droid APK
  /^docs\/legal\/(native-copy|required-checks)\.json$/, // native copy sources
  /^\.github\/workflows\/(android-release|ios-release|ios-submit)\.yml$/,
  /^\.github\/actions\//,
];

/** Paths known not to reach the apps or their store builds. */
const NON_APP_PATHS = [
  /^[^/]+\.md$/,
  /^(LICENSE|CITATION\.cff)$/,
  /^docs\//,
  /^\.github\//,
  /^\.(githooks|vscode)\//,
  /^\.(gitleaks\.toml|editorconfig|prettierrc\.json|prettierignore)$/,
  /^(eslint\.config\.js|vitest\.scripts\.config\.js)$/,
  /^scripts\//,
  /^infra\//,
  /^tools\//,
  /^packages\/data-pipeline\//,
  /^apps\/web\/(functions|migrations|e2e|features|test-support)\//,
  /^apps\/web\/(wrangler\.toml|vitest\.config\.ts|playwright(\.[a-z]+)?\.config\.ts|lighthouserc\.json|budgets\.json)$/,
  /\.(test|spec)\.(js|mjs|ts)$/,
];

/** @param {string} path repo-relative, forward slashes */
export function isAppPath(path) {
  if (APP_SCRIPTS.has(path) || APP_PATHS.some((re) => re.test(path))) return true;
  return !NON_APP_PATHS.some((re) => re.test(path));
}

/**
 * Whether the bracketed marker stands on its own: not inside backticks, not joined to a word.
 * @param {string | undefined} text
 * @param {string} marker
 */
export function hasMarker(text, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w\`-])${escaped}(?=$|[^\\w\`-])`, "im").test(text ?? "");
}

/**
 * @param {{ paths: string[] | null, prText?: string, history?: string, lookupFailed?: boolean }}
 *   input paths is null when there is no shipped release to compare against; prText is the
 *   merged pull request's title and body; history is every commit message since the base
 * @returns {{ ship: boolean, reason: string, appPaths: string[] }}
 */
export function decide({ paths, prText = "", history = "", lookupFailed = false }) {
  if (paths === null) {
    return { ship: true, reason: "no shipped release to compare against", appPaths: [] };
  }
  const appPaths = paths.filter(isAppPath);
  const forced = hasMarker(prText, SHIP_MARKER) || hasMarker(history, SHIP_MARKER);
  if (appPaths.length > 0) {
    // Read from the pull request only: a commit message stays in range until a release ships, so
    // a skip marker there would hold back every later change too.
    if (!forced && hasMarker(prText, SKIP_MARKER)) {
      return {
        ship: false,
        reason: `${SKIP_MARKER} marker; these changes ship with the next release that ships`,
        appPaths,
      };
    }
    return { ship: true, reason: `${appPaths.length} app-affecting path(s) changed`, appPaths };
  }
  if (forced) return { ship: true, reason: `${SHIP_MARKER} marker`, appPaths };
  if (lookupFailed) {
    return {
      ship: true,
      reason: "pull request text unreadable, so a marker cannot be ruled out",
      appPaths,
    };
  }
  return { ship: false, reason: "no app-affecting change", appPaths };
}

/** The for-each-ref format parseTagRecords reads. */
export const TAG_FORMAT =
  "%(refname:strip=2)%1f%(objecttype)%1f%(objectname)%1f%(*objectname)%1f%(contents)%1e";

/**
 * @typedef {{ tag: string, annotated: boolean, commit: string, message: string,
 *   version: string, parts: number[] }} TagRecord
 */

/**
 * Release tags from `git for-each-ref --format=TAG_FORMAT`, newest version first. Non-release
 * tags are dropped. A lightweight tag carries no message of its own (for-each-ref prints the
 * commit's), so its message is discarded.
 * @param {string} output
 * @returns {TagRecord[]}
 */
export function parseTagRecords(output) {
  return output
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter(Boolean)
    .map((r) => {
      const [tag, type, object, peeled, message = ""] = r.split("\x1f");
      const annotated = type === "tag";
      const version = (tag ?? "").replace(/^v/, "");
      return {
        tag,
        annotated,
        commit: annotated ? peeled : object,
        message: annotated ? message : "",
        version,
        parts: version.split(".").map(Number),
      };
    })
    .filter((t) => t.tag.startsWith("v") && SEMVER.test(t.version))
    .sort((a, b) => {
      const [x, y] = [a.parts, b.parts];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}

/** @param {string} message an annotated tag's message */
export function isSkipped(message) {
  return new RegExp(`^${TRAILER}:[ \\t]*skip[ \\t]*$`, "mi").test(message ?? "");
}

/**
 * The release tags that can be trusted. Annotated tags carry their own ship/skip decision. A
 * lightweight tag is trusted only as a legacy release: before any annotated release tag exists,
 * or when its commit is an ancestor of the oldest annotated release tag's commit. Any other
 * lightweight tag (made by hand, in the GitHub UI, by `gh release create`) is neither shipped nor
 * published, so it is never the diff base and never advertised.
 * @param {TagRecord[]} records newest first
 * @param {(ancestor: string, descendant: string) => boolean} isAncestor
 * @returns {TagRecord[]}
 */
export function trustedRecords(records, isAncestor) {
  const oldestAnnotated = records.filter((t) => t.annotated).at(-1);
  if (!oldestAnnotated) return records;
  return records.filter((t) => t.annotated || isAncestor(t.commit, oldestAnnotated.commit));
}

/**
 * The newest release whose apps shipped: the diff base.
 * @param {TagRecord[]} records trusted, newest first
 * @returns {{ tag: string, version: string } | null}
 */
export function lastShipped(records) {
  const shipped = records.find((t) => !(t.annotated && isSkipped(t.message)));
  return shipped ? { tag: shipped.tag, version: shipped.version } : null;
}

/**
 * What a decision compares against: the base branch for a preview, the last shipped release on a
 * push, nothing otherwise. Null on a push with no shipped release (the apps then ship).
 * @param {string} event
 * @param {{ tag: string } | null} shipped
 * @returns {string | null | undefined} undefined when the event takes no decision
 */
export function selectBase(event, shipped) {
  if (event === "pull_request") return "HEAD^1";
  if (event === "push") return shipped?.tag ?? null;
  return undefined;
}

/** The commit status fdroid-publish writes once a tag's APK is served. */
export const fdroidContext = (tag) => `fdroid-apk/${tag}`;

/** At most this many ship tags are checked for an F-Droid record per deploy. */
export const MAX_RECORD_LOOKUPS = 20;

/** The endpoint as deployed, the fallback when the records cannot be read. */
export const SERVED_URL = "https://how2vote.au/app-version.json";

/**
 * The newest release whose F-Droid APK is published. Skip tags are passed over without a lookup:
 * a skipped release never gets an APK. `complete` is false when the answer is unknown (a lookup
 * failed, or the cap was reached first); the caller then falls back rather than guess.
 * @param {TagRecord[]} records trusted, newest first
 * @param {(record: TagRecord) => Promise<boolean>} hasRecord
 * @returns {Promise<{ complete: boolean, published: { tag: string, version: string } | null,
 *   reason?: string }>}
 */
export async function lastPublished(records, hasRecord) {
  let lookups = 0;
  for (const record of records) {
    const found = { tag: record.tag, version: record.version };
    if (!record.annotated) return { complete: true, published: found };
    if (isSkipped(record.message)) continue;
    if (++lookups > MAX_RECORD_LOOKUPS) {
      return {
        complete: false,
        published: null,
        reason: `no F-Droid record within the newest ${MAX_RECORD_LOOKUPS} ship tags`,
      };
    }
    try {
      if (await hasRecord(record)) return { complete: true, published: found };
    } catch (error) {
      return { complete: false, published: null, reason: error.message };
    }
  }
  return { complete: true, published: null };
}

/**
 * The workflow run a tag's F-Droid record points at, from the combined status (latest per
 * context), or null when there is no success record with a run URL in this repository.
 * @param {{ statuses?: { state?: string, context?: string, target_url?: string }[] }} combined
 * @param {string} tag
 * @param {string} repo owner/name
 * @returns {string | null} the run id
 */
export function recordRunId(combined, tag, repo) {
  const status = (combined?.statuses ?? []).find((s) => s?.context === fdroidContext(tag));
  if (status?.state !== "success") return null;
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/.exec(
    status.target_url ?? "",
  );
  return m && m[1].toLowerCase() === repo.toLowerCase() ? m[2] : null;
}

/** The fdroid-publish job and the step whose success means the APK is served. */
export const PUBLISH_JOB = "Publish the F-Droid APK";
export const PUBLISH_STEP = "Verify the published URL serves the signed bytes";

/**
 * Whether a record's run is a real android-release run on main whose publish job verified the
 * served APK. Anyone able to write a status could otherwise claim an APK that does not exist.
 * @param {{ path?: string, head_branch?: string, event?: string,
 *   repository?: { full_name?: string } }} run
 * @param {{ jobs?: { name?: string, steps?: { name?: string, conclusion?: string }[] }[] }} jobs
 * @param {string} repo owner/name
 */
export function isPublishRun(run, jobs, repo) {
  if (run?.path !== ".github/workflows/android-release.yml") return false;
  if (run?.head_branch !== "main" || run?.event !== "workflow_dispatch") return false;
  if ((run?.repository?.full_name ?? "").toLowerCase() !== repo.toLowerCase()) return false;
  const job = (jobs?.jobs ?? []).find((j) => j?.name === PUBLISH_JOB);
  return (job?.steps ?? []).some((st) => st?.name === PUBLISH_STEP && st?.conclusion === "success");
}

/**
 * The version a previously deployed app-version.json named, if it is still a trusted release
 * whose payload is well formed; otherwise null.
 * @param {{ versionName?: unknown, versionCode?: unknown } | null} served
 * @param {TagRecord[]} records trusted
 * @param {(version: string) => (number | null)[]} codes the versionCodes a release may have been
 *   advertised with (generate-app-version's current and legacy encodings)
 */
export function servedVersion(served, records, codes) {
  const name = typeof served?.versionName === "string" ? served.versionName : "";
  if (!SEMVER.test(name) || !codes(name).includes(Number(served?.versionCode))) return null;
  const record = records.find((t) => t.version === name);
  if (!record || (record.annotated && isSkipped(record.message))) return null;
  return name;
}

/* c8 ignore start -- git/network/CLI plumbing, exercised in CI */
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });

const isAncestor = (ancestor, descendant) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
};

async function getJson(url, headers = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
      if (res.ok) return await res.json();
      last = new Error(`${url}: HTTP ${res.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw last;
}

const api = (path) =>
  getJson(`https://api.github.com/repos/${process.env["GITHUB_REPOSITORY"]}/${path}`, {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${process.env["GH_TOKEN"]}`,
    "X-GitHub-Api-Version": "2022-11-28",
  });

/** @param {TagRecord} record */
async function hasVerifiedRecord(record) {
  const repo = process.env["GITHUB_REPOSITORY"] ?? "";
  const runId = recordRunId(await api(`commits/${record.commit}/status`), record.tag, repo);
  if (!runId) return false;
  const [run, jobs] = await Promise.all([
    api(`actions/runs/${runId}`),
    api(`actions/runs/${runId}/jobs?filter=latest&per_page=100`),
  ]);
  if (isPublishRun(run, jobs, repo)) return true;
  console.warn(
    `::warning::${record.tag}'s F-Droid record points at run ${runId}, which is not a verified publish`,
  );
  return false;
}

function summarise({ event, decision, base, version }) {
  const summary = [];
  if (decision) {
    const heading = event === "pull_request" ? "Store release on merge" : "Store release";
    summary.push(`### ${heading}: ${decision.ship ? "ship the apps" : "skip the apps"}`, "");
    summary.push(`- reason: ${decision.reason}`);
    summary.push(
      `- compared against: ${base === "HEAD^1" ? "the base branch" : base || "nothing"}`,
    );
    if (decision.appPaths.length > 0) {
      summary.push("- app-affecting paths:");
      for (const p of decision.appPaths.slice(0, 100)) summary.push(`  - \`${p}\``);
      if (decision.appPaths.length > 100) {
        summary.push(`  - …and ${decision.appPaths.length - 100} more`);
      }
    }
    if (event === "pull_request") {
      summary.push(
        `- on merge the base is the last release that shipped; \`${SHIP_MARKER}\` or ` +
          `\`${SKIP_MARKER}\` in this pull request overrides the decision`,
      );
    } else if (!decision.ship) {
      summary.push(
        `- the next app-affecting merge ships these changes; to ship them sooner, merge a ` +
          `follow-up carrying \`${SHIP_MARKER}\``,
      );
    }
  }
  if (event !== "pull_request") {
    summary.push(`- app-version.json advertises: ${version || "nothing (null payload)"}`);
  }
  return summary.join("\n");
}

async function main() {
  if (process.argv.includes("--classify")) {
    const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
    process.stdout.write(`${paths.some(isAppPath)}\n`);
    return;
  }
  const event = process.env["EVENT"] ?? "";
  const textFile = process.env["PR_TEXT_FILE"];
  const lookupFailed = process.env["MARKER_LOOKUP"] === "failed";

  let decision = null;
  let base = "";
  let version = "";
  /** @type {TagRecord[]} */
  let records;
  try {
    const prText = textFile ? readFileSync(textFile, "utf8") : "";
    records = trustedRecords(
      parseTagRecords(
        git("for-each-ref", "--merged", "HEAD", `--format=${TAG_FORMAT}`, "refs/tags/v*"),
      ),
      isAncestor,
    );
    const selected = selectBase(event, lastShipped(records));
    if (selected !== undefined) {
      base = selected ?? "";
      decision = decide({
        paths: selected
          ? git("diff", "--name-only", "--no-renames", "-z", selected, "HEAD")
              .split("\0")
              .filter(Boolean)
          : null,
        prText,
        history: selected ? git("log", "--format=%B", `${selected}..HEAD`) : "",
        lookupFailed,
      });
    }
  } catch (error) {
    if (event !== "pull_request") {
      console.error(`::error::Could not read the release tags: ${error.message}`);
      process.exit(1);
    }
    console.warn(`::warning::Could not preview the store release: ${error.message}`);
    return;
  }

  // Only the endpoint depends on the F-Droid records: an unknown answer falls back to what the
  // endpoint already serves, which named a published APK when it was deployed, and never fails
  // the deploy.
  if (event !== "pull_request") {
    const result = await lastPublished(records, hasVerifiedRecord);
    if (result.complete) {
      version = result.published?.version ?? "";
    } else {
      console.warn(
        `::warning::F-Droid records unreadable (${result.reason}); keeping the served version`,
      );
      try {
        const { encodeVersionCode, legacyVersionCode } = await import("./generate-app-version.mjs");
        const codes = (v) => [encodeVersionCode(v), legacyVersionCode(v)].filter((c) => c !== null);
        version = servedVersion(await getJson(SERVED_URL), records, codes) ?? "";
      } catch (error) {
        console.warn(`::warning::Could not read ${SERVED_URL}: ${error.message}`);
      }
      if (!version) console.warn("::warning::app-version.json will carry a null payload");
    }
  }

  const out = process.env["GITHUB_OUTPUT"];
  if (out) {
    appendFileSync(
      out,
      `ship=${decision ? decision.ship : ""}\nbase=${base.startsWith("v") ? base : ""}\n` +
        `reason=${decision?.reason ?? ""}\nstore-version=${version}\n`,
    );
  }
  const text = summarise({ event, decision, base, version });
  console.info(text);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file && text) appendFileSync(file, `${text}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
/* c8 ignore stop */
