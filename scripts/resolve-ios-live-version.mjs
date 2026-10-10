#!/usr/bin/env node
/**
 * @fileoverview The app version the App Store is actually serving, for the iOS freshness badge.
 *
 * The repo runs ahead of the App Store: every merge to main mints a release, but a build reaches
 * users only after App Review and a manual release. Reporting the repo's version would describe a
 * build nobody has installed.
 *
 * The iTunes lookup endpoint is public and read-only, keyed by bundle id, so this needs no App
 * Store Connect credential: https://itunes.apple.com/lookup?bundleId=<appId>&country=au.
 *
 * FAILS OPEN. Every failure prints a warning and emits an empty version, which
 * generate-store-badges.mjs renders as a grey "not published" — visibly absent, never wrong. No
 * badge is worth failing a deploy over.
 *
 * Usage:
 *   node scripts/resolve-ios-live-version.mjs
 *   # writes `ios=<semver>` to $GITHUB_OUTPUT when set, and prints the version to stdout
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUNDLE_ID = "au.how2vote.app";
const LOOKUP = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&country=au`;

/** Same strict-semver rule as the badge generator: a version it cannot parse is not reported. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The version of this app's listing, or null when the payload does not carry one.
 * @param {{results?: {bundleId?: string, version?: string}[]}} payload
 * @returns {string|null}
 */
export function liveVersion(payload) {
  const listing = (payload?.results ?? []).find((r) => r?.bundleId === BUNDLE_ID);
  return SEMVER.test(listing?.version ?? "") ? listing.version : null;
}

/**
 * The version published on the AU App Store, or null when nothing is listed.
 * @param {(url: string, init?: object) => Promise<Response>} fetchImpl
 * @returns {Promise<string|null>}
 */
export async function publishedVersion(fetchImpl) {
  const res = await fetchImpl(LOOKUP, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`lookup unreadable: ${res.status}`);
  return liveVersion(await res.json());
}

/* c8 ignore start -- network/CLI plumbing, exercised in CI not unit tests */
function emit(version) {
  const out = process.env["GITHUB_OUTPUT"];
  if (out) appendFileSync(out, `ios=${version ?? ""}\n`);
  if (version) console.info(`The App Store is serving ${version}.`);
  process.stdout.write(`${version ?? ""}\n`);
}

async function main() {
  try {
    const version = await publishedVersion(fetch);
    if (!version) console.warn("::warning::No published release in the App Store lookup.");
    return emit(version);
  } catch (error) {
    console.warn(`::warning::Could not read the live App Store version: ${error.message}`);
    return emit(null);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
/* c8 ignore stop */
