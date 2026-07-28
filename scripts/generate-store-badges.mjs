#!/usr/bin/env node
/**
 * @fileoverview Shields.io endpoint badges for per-channel data freshness.
 *
 * Because the dataset ships INSIDE each native binary with no OTA path, a store build is not just
 * an older UI — it is older *candidate data*. These badges make that visible on the README: for
 * each distribution channel, which version is live and how old the data inside it is.
 *
 * The version → dataVersion mapping needs no manifest: every release is a git tag and
 * data/dist/elections.json is committed, so the dataset a released build shipped is recoverable
 * with `git show v<version>:data/dist/elections.json`. Nothing extra to publish or keep in sync.
 *
 * Live versions arrive via environment, so this script stays pure, offline and testable — the
 * store APIs are queried by the workflow that sets them, never here:
 *   IOS_LIVE_VERSION      → badges/ios.json
 *   ANDROID_LIVE_VERSION  → badges/android.json
 *   FDROID_LIVE_VERSION   → badges/fdroid.json
 * An unset channel emits a grey "not published" badge rather than nothing, so the README renders
 * identically before and after a store goes live. The web badge is always emitted from the
 * working tree.
 *
 * Deliberately reports a DATE, never a verdict like "stale": native builds legitimately trail web
 * by days while a release sits in review, so a scary word would fire on every normal release. The
 * in-app stale-data notice (apps/web/src/lib/staleness.ts) is what actually judges staleness, and
 * it does so against the electoral timetable rather than against web.
 *
 * Usage:
 *   node scripts/generate-store-badges.mjs            # write apps/web/static/badges/*.json
 *   node scripts/generate-store-badges.mjs --check    # print, write nothing
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET_REL = "data/dist/elections.json";
const OUT_DIR = join(ROOT, "apps/web/static/badges");

/** Channels in README order. `env` is the variable carrying that channel's live version. */
export const CHANNELS = [
  { id: "ios", label: "iOS", env: "IOS_LIVE_VERSION" },
  { id: "android", label: "Android", env: "ANDROID_LIVE_VERSION" },
  { id: "fdroid", label: "F-Droid", env: "FDROID_LIVE_VERSION" },
];

/** Only ever interpolate a strict semver into a git ref — same fail-closed rule as resolve-store-version. */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** The `current: true` election's dataVersion — the dataset age a fresh install would get. */
export function currentDataVersion(elections) {
  return elections.find((e) => e.current)?.dataVersion ?? null;
}

/**
 * The dataVersion bundled in a released version, read from that release's git tag.
 * Returns null for a non-semver input or a tag that isn't in this clone (shallow checkout,
 * or a version published before the tag existed) — the badge then omits the data age rather
 * than guessing.
 */
export function dataVersionAtTag(version, { exec = execFileSync, root = ROOT } = {}) {
  if (!SEMVER.test(version ?? "")) return null;
  try {
    // execFile with an argument array — never a shell string, so the ref cannot be injected.
    const raw = exec("git", ["show", `v${version}:${DATASET_REL}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return currentDataVersion(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * A shields.io endpoint payload (https://shields.io/badges/endpoint-badge).
 * Green when the channel ships today's dataset, yellow when it trails, grey when unpublished.
 */
export function badge({ label, version, dataVersion, current }) {
  if (!version) {
    return { schemaVersion: 1, label, message: "not published", color: "lightgrey" };
  }
  if (!dataVersion) {
    return { schemaVersion: 1, label, message: version, color: "blue" };
  }
  const fresh = dataVersion === current;
  return {
    schemaVersion: 1,
    label,
    message: `${version} · data ${dataVersion}`,
    color: fresh ? "brightgreen" : "yellow",
  };
}

/** Every badge file as `filename → payload`. */
export function buildBadges(elections, envs, resolve = dataVersionAtTag) {
  const current = currentDataVersion(elections);
  const files = {
    // The web channel is always the working tree: it is what a deploy would ship right now.
    "web.json": {
      schemaVersion: 1,
      label: "web",
      message: current ? `data ${current}` : "unknown",
      color: current ? "brightgreen" : "lightgrey",
    },
  };
  for (const { id, label, env } of CHANNELS) {
    const version = (envs[env] ?? "").trim() || null;
    files[`${id}.json`] = badge({
      label,
      version,
      dataVersion: version ? resolve(version) : null,
      current,
    });
  }
  return files;
}

function main() {
  const check = process.argv.includes("--check");
  const elections = JSON.parse(readFileSync(join(ROOT, DATASET_REL), "utf8"));
  const files = buildBadges(elections, process.env);

  if (check) {
    for (const [name, payload] of Object.entries(files)) {
      console.info(`${name}: ${payload.label} — ${payload.message} (${payload.color})`);
    }
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, payload] of Object.entries(files)) {
    writeFileSync(join(OUT_DIR, name), `${JSON.stringify(payload, null, 2)}\n`);
  }
  console.info(`✓ store badges written (${Object.keys(files).length} files → static/badges/)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
