#!/usr/bin/env node
/**
 * @fileoverview The app version F-Droid is actually serving, for the F-Droid freshness badge.
 *
 * The badge answers "which build do users have, and how old is the candidate data inside it".
 * Only the index knows the first half — the repo runs ahead of F-Droid, because every merge to
 * main mints a release while F-Droid's buildserver picks it up on its own schedule and publishes
 * only once its build reproduces ours. Reporting the repo's version there would describe a build
 * nobody has installed.
 *
 * Unlike Play, the index is public and read-only: a plain GET of
 * https://f-droid.org/api/v1/packages/<appId>, no credential, no edit to open and discard. The
 * payload carries versionName directly, so nothing has to be decoded back out of a versionCode.
 *
 * FAILS OPEN. Every failure prints a warning and emits an empty version, which
 * generate-store-badges.mjs renders as a grey "not published" — visibly absent, never wrong. No
 * badge is worth failing a deploy over.
 *
 * Usage:
 *   node scripts/resolve-fdroid-live-version.mjs
 *   # writes `fdroid=<semver>` to $GITHUB_OUTPUT when set, and prints the version to stdout
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE = "au.how2vote.app";
const INDEX = `https://f-droid.org/api/v1/packages/${PACKAGE}`;

/** Same strict-semver rule as the badge generator: a versionName it cannot parse is not reported. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The versionName F-Droid recommends installing, or null when the payload does not say.
 *
 * `suggestedVersionCode` is the index's own answer to "which build does a user get", so it is
 * preferred over the newest entry: `packages` also lists superseded builds, and during a
 * suggestion change the highest code is not necessarily the one being offered. It falls back to
 * the highest code only when the suggestion names no package present in the list.
 *
 * @param {{suggestedVersionCode?: number, packages?: {versionName?: string, versionCode?: number}[]}} payload
 * @returns {string|null}
 */
export function liveVersion(payload) {
  const packages = (payload?.packages ?? []).filter(
    (p) => Number.isInteger(p?.versionCode) && SEMVER.test(p?.versionName ?? ""),
  );
  if (packages.length === 0) return null;
  const suggested = packages.find((p) => p.versionCode === payload?.suggestedVersionCode);
  const chosen = suggested ?? packages.reduce((a, b) => (b.versionCode > a.versionCode ? b : a));
  return chosen.versionName;
}

/**
 * The version published on f-droid.org, or null when the index cannot be read.
 * @param {(url: string, init?: object) => Promise<Response>} fetchImpl
 * @returns {Promise<string|null>}
 */
export async function publishedVersion(fetchImpl) {
  const res = await fetchImpl(INDEX, { headers: { Accept: "application/json" } });
  // A 404 is the honest answer while the app is not in the index yet, not an error to shout about.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`index unreadable: ${res.status}`);
  return liveVersion(await res.json());
}

/* c8 ignore start -- network/CLI plumbing, exercised in CI not unit tests */
function emit(version) {
  const out = process.env["GITHUB_OUTPUT"];
  if (out) appendFileSync(out, `fdroid=${version ?? ""}\n`);
  if (version) console.info(`F-Droid is serving ${version}.`);
  process.stdout.write(`${version ?? ""}\n`);
}

async function main() {
  try {
    const version = await publishedVersion(fetch);
    if (!version) console.warn("::warning::No published release in the F-Droid index.");
    return emit(version);
  } catch (error) {
    console.warn(`::warning::Could not read the live F-Droid version: ${error.message}`);
    return emit(null);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
/* c8 ignore stop */
