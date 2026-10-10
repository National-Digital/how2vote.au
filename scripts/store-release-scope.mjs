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
 * `Store-Release: ship|skip` trailer. The diff base is the newest release tag reachable from HEAD
 * not marked `skip` (lightweight tags predate the trailer and all shipped).
 *
 * https://how2vote.au/app-version.json advertises the newest reachable release tag whose F-Droid
 * APK is published: a lightweight tag (every release before this record existed), or one whose
 * commit carries the `fdroid-apk/<tag>` success status that android-release's fdroid-publish job
 * writes after the APK is served. fdroid-publish then redeploys, so the endpoint advances as soon
 * as the APK exists and never before.
 *
 * Usage (deploy.yml):
 *   EVENT=push PR_TEXT_FILE=… node scripts/store-release-scope.mjs
 *   EVENT=pull_request PR_TEXT_FILE=… node scripts/store-release-scope.mjs   # summary only
 *   EVENT=schedule node scripts/store-release-scope.mjs                      # store version only
 *   node scripts/store-release-scope.mjs --classify < paths   # prints true if any path ships
 * Writes `ship`, `base`, `reason` and `store-version` to $GITHUB_OUTPUT and the decision to the
 * job summary. MARKER_LOOKUP=failed means the pull request text could not be read; the release
 * then ships. On any event but pull_request, a failure to read the tags or the F-Droid records
 * fails the step rather than publish a wrong endpoint. Reads statuses with GH_TOKEN.
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
  /^\.github\/workflows\/(android|ios)-release\.yml$/,
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
 * The newest release whose apps shipped: the diff base.
 * @param {TagRecord[]} records newest first
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

/** At most this many release tags are checked for an F-Droid record per deploy. */
export const MAX_RECORD_LOOKUPS = 50;

/**
 * The newest release whose F-Droid APK is published.
 * @param {TagRecord[]} records newest first
 * @param {(record: TagRecord) => Promise<boolean>} hasRecord
 * @returns {Promise<{ tag: string, version: string } | null>}
 */
export async function lastPublished(records, hasRecord) {
  let lookups = 0;
  for (const record of records) {
    if (!record.annotated) return { tag: record.tag, version: record.version };
    if (++lookups > MAX_RECORD_LOOKUPS) {
      throw new Error(`no F-Droid record within the newest ${MAX_RECORD_LOOKUPS} release tags`);
    }
    if (await hasRecord(record)) return { tag: record.tag, version: record.version };
  }
  return null;
}

/**
 * @param {{ state?: string, context?: string }[]} statuses a commit's statuses
 * @param {string} tag
 */
export function hasSuccessStatus(statuses, tag) {
  return statuses.some((s) => s?.context === fdroidContext(tag) && s?.state === "success");
}

/* c8 ignore start -- git/network/CLI plumbing, exercised in CI */
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });

async function statusesFor(commit) {
  const repo = process.env["GITHUB_REPOSITORY"];
  const url = `https://api.github.com/repos/${repo}/commits/${commit}/statuses?per_page=100`;
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env["GH_TOKEN"]}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (res.ok) return await res.json();
      last = new Error(`statuses for ${commit}: HTTP ${res.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw last;
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
      summary.push(`- to ship these changes anyway, merge a follow-up carrying \`${SHIP_MARKER}\``);
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
  try {
    const prText = textFile ? readFileSync(textFile, "utf8") : "";
    const records = parseTagRecords(
      git("for-each-ref", "--merged", "HEAD", `--format=${TAG_FORMAT}`, "refs/tags/v*"),
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
    if (event !== "pull_request") {
      const published = await lastPublished(records, async (r) =>
        hasSuccessStatus(await statusesFor(r.commit), r.tag),
      );
      version = published?.version ?? "";
    }
  } catch (error) {
    if (event !== "pull_request") {
      console.error(
        `::error::Could not read the release tags or F-Droid records: ${error.message}`,
      );
      process.exit(1);
    }
    console.warn(`::warning::Could not preview the store release: ${error.message}`);
    return;
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
