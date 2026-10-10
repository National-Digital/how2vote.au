#!/usr/bin/env node
/**
 * @fileoverview F-Droid update-check endpoint: apps/web/static/app-version.json.
 *
 * F-Droid discovers new releases by polling a URL we control (UpdateCheckMode: HTTP in
 * docs/fdroid/au.how2vote.app.yml) rather than by parsing build.gradle — the gradle files
 * deliberately carry no literal version (values arrive as project properties; see
 * apps/mobile/android/app/build.gradle). This script publishes the pair F-Droid needs at
 * https://how2vote.au/app-version.json on every production deploy:
 *
 *   { "versionName": "2.1.0", "versionCode": 201000000 }
 *
 * versionCode is the SAME deterministic semver encoding as resolve-store-version —
 * MAJOR×10^8 + MINOR×10^6 + PATCH×10^3 — with the three run-number digits pinned to 000.
 * Store uploads append the workflow run number (≥ 1, so a re-upload of one release out-ranks the
 * last) making a store versionCode for the same release always higher; that is fine because
 * versionCode only needs to be monotonic
 * WITHIN a channel, and F-Droid installs are never upgraded by Play or vice versa (different
 * signing keys). checkupdates then writes this exact pair into the new fdroiddata build block,
 * whose prebuild feeds it back into gradle — so the built APK always matches the declaration.
 * check-fdroid-ready.mjs guards the formula parity with resolve-store-version.
 *
 * STORE_APP_VERSION arrives from the deploy environment (deploy.yml → prebuild:assets, the same
 * route as the badge generator). It is the newest release whose F-Droid APK is published
 * (scripts/store-release-scope.mjs), not the web release being deployed: a release that skips the
 * stores never gets an APK, and a release that ships gets one only when android-release's
 * fdroid-publish succeeds, which then redeploys. Anything else (a PR preview, a local build,
 * unset) emits an explicit null payload rather than nothing, so the URL never 404s; F-Droid's
 * regexes simply find no match.
 *
 * Usage:
 *   STORE_APP_VERSION=2.1.0 node scripts/generate-app-version.mjs           # write the payload
 *   STORE_APP_VERSION=2.1.0 node scripts/generate-app-version.mjs --check   # print, write nothing
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_REL = "apps/web/static/app-version.json";

/** Same fail-closed strict-semver rule as resolve-store-version and the badge generator. Leading
 *  zeros are rejected on both sides so the two encodings cannot disagree about `1.01.0`. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Google Play's versionCode ceiling. */
export const MAX_VERSION_CODE = 2100000000;
/** Per-PR preview builds use 1e9 + run number; release codes must stay below that range. */
export const PREVIEW_CODE_FLOOR = 1000000000;
/** Major 9 is the largest that keeps every release code below PREVIEW_CODE_FLOOR. */
const MAX_MAJOR = 9;

/**
 * The source-build versionCode baseline for a release: semver encoded exactly as
 * .github/actions/resolve-store-version does, with the run-number digits pinned to 000.
 * A minor above 99 or a patch above 999 would carry into the next field and rank a later release
 * below an earlier one, so they are refused rather than encoded. Major 0 is refused so every code
 * stays above the legacy range (see legacyVersionCode).
 * @param {string} version strict semver ("2.1.0")
 * @returns {number|null} e.g. 201000000, or null for input this scheme cannot encode
 */
export function encodeVersionCode(version) {
  const m = SEMVER.exec(version ?? "");
  if (!m) return null;
  const [, major, minor, patch] = m.map(Number);
  if (major < 1 || major > MAX_MAJOR || minor > 99 || patch > 999) return null;
  return major * 100000000 + minor * 1000000 + patch * 1000;
}

/** Every code the current encoding emits is at or above this; every legacy code is below it. */
const LEGACY_CEILING = 100000000;

/** The last release published under the legacy encoding. */
export const LEGACY_LAST_VERSION = [1, 4, 6];

/**
 * The code a release up to LEGACY_LAST_VERSION was published with under the legacy encoding,
 * (MAJOR×10000 + MINOR×100 + PATCH)×1000, or null for any other version. Kept so the store
 * codes and recipe build blocks already issued still decode and validate.
 * @param {string} version strict semver
 * @returns {number|null}
 */
export function legacyVersionCode(version) {
  const m = SEMVER.exec(version ?? "");
  if (!m) return null;
  const [, major, minor, patch] = m.map(Number);
  const [lastMajor, lastMinor, lastPatch] = LEGACY_LAST_VERSION;
  const issued =
    major === lastMajor && (minor < lastMinor || (minor === lastMinor && patch <= lastPatch));
  if (!issued || minor > 99 || patch > 99) return null;
  return (major * 10000 + minor * 100 + patch) * 1000;
}

/**
 * The semver a store versionCode was built from — the inverse of encodeVersionCode (or of
 * legacyVersionCode for a code below the current range).
 * Store uploads append the workflow run number to the baseline (see above), so the low three
 * digits are discarded before decoding rather than treated as part of the version.
 * @param {number|string} code e.g. 201000007
 * @returns {string|null} e.g. "2.1.0", or null for input this scheme cannot have produced
 */
export function decodeVersionCode(code) {
  const n = Number(code);
  if (!Number.isInteger(n) || n <= 0) return null;
  const baseline = Math.floor(n / 1000) * 1000;
  let version;
  let encode;
  if (n >= LEGACY_CEILING) {
    version = `${Math.floor(n / 100000000)}.${Math.floor(n / 1000000) % 100}.${Math.floor(n / 1000) % 1000}`;
    encode = encodeVersionCode;
  } else {
    const b = baseline / 1000;
    version = `${Math.floor(b / 10000)}.${Math.floor(b / 100) % 100}.${b % 100}`;
    encode = legacyVersionCode;
  }
  // Round-trip rather than trust the arithmetic: anything the encoder would not have produced
  // (a versionCode from some other scheme, or a carry out of a field) decodes to null instead of
  // a plausible-looking wrong version.
  return encode(version) === baseline ? version : null;
}

/**
 * The endpoint payload for a given store version. Null fields (never a missing file) for
 * anything that is not a release version.
 * @param {string|undefined} appVersion
 */
export function payload(appVersion) {
  const versionCode = encodeVersionCode(appVersion);
  if (versionCode === null) {
    return { versionName: null, versionCode: null };
  }
  return { versionName: appVersion, versionCode };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
function main() {
  // `--code <semver>` prints just the encoded versionCode, so callers that need the F-Droid pair
  // (release workflow, recipe pin) take it from this one encoding rather than restating the formula.
  const codeFor = process.argv[process.argv.indexOf("--code") + 1];
  if (process.argv.includes("--code")) {
    const code = encodeVersionCode(codeFor);
    if (code === null) {
      console.error(`✗ "${codeFor}" is not a versionCode-encodable semver`);
      process.exit(1);
    }
    console.info(String(code));
    return;
  }
  const check = process.argv.includes("--check");
  const body = payload(process.env.STORE_APP_VERSION);
  if (check) {
    console.info(`app-version: ${JSON.stringify(body)}`);
    return;
  }
  const out = join(ROOT, OUT_REL);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  console.info(
    body.versionName
      ? `✓ app-version.json written (${body.versionName} / ${body.versionCode})`
      : `✓ app-version.json written (null payload — STORE_APP_VERSION is not a release semver)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
