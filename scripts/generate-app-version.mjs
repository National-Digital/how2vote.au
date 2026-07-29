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
 *   { "versionName": "2.1.0", "versionCode": 20100000 }
 *
 * versionCode is the SAME deterministic semver encoding as resolve-store-version —
 * (MAJOR×10000 + MINOR×100 + PATCH)×1000 — with the three run-number digits pinned to 000.
 * Store uploads append the workflow run number (≥ 1, so a re-upload of one release out-ranks the
 * last) making a store versionCode for the same release always higher; that is fine because
 * versionCode only needs to be monotonic
 * WITHIN a channel, and F-Droid installs are never upgraded by Play or vice versa (different
 * signing keys). checkupdates then writes this exact pair into the new fdroiddata build block,
 * whose prebuild feeds it back into gradle — so the built APK always matches the declaration.
 * check-fdroid-ready.mjs guards the formula parity with resolve-store-version.
 *
 * APP_VERSION arrives from the deploy environment (deploy.yml → prebuild:assets, the same route
 * as the badge generator). A non-release build (PR preview `1.2.3-pr7`, local `0.0.0-dev`, unset)
 * emits an explicit null payload rather than nothing, so the URL never 404s and never advertises
 * a version that was not actually released; F-Droid's regexes simply find no match. Production
 * pushes always deploy a strict-semver APP_VERSION, so the apex always serves the latest release.
 *
 * Usage:
 *   APP_VERSION=2.1.0 node scripts/generate-app-version.mjs           # write the payload
 *   APP_VERSION=2.1.0 node scripts/generate-app-version.mjs --check   # print, write nothing
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_REL = "apps/web/static/app-version.json";

/** Same fail-closed strict-semver rule as resolve-store-version and the badge generator. Leading
 *  zeros are rejected on both sides so the two encodings cannot disagree about `1.01.0`. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The source-build versionCode baseline for a release: semver encoded exactly as
 * .github/actions/resolve-store-version does, with the run-number digits pinned to 000.
 * Minor/patch above 99 would carry into the next field and rank a later release below an earlier
 * one, so they are refused rather than encoded.
 * @param {string} version strict semver ("2.1.0")
 * @returns {number|null} e.g. 20100000, or null for input this scheme cannot encode
 */
export function encodeVersionCode(version) {
  const m = SEMVER.exec(version ?? "");
  if (!m) return null;
  const [, major, minor, patch] = m.map(Number);
  if (minor > 99 || patch > 99) return null;
  return (major * 10000 + minor * 100 + patch) * 1000;
}

/**
 * The endpoint payload for a given APP_VERSION. Null fields (never a missing file) for
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
  const body = payload(process.env.APP_VERSION);
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
      : `✓ app-version.json written (null payload — APP_VERSION is not a release semver)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
