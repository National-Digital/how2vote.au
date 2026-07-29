#!/usr/bin/env node
/**
 * @fileoverview CI guard: the Android shell stays buildable and acceptable on F-Droid.
 *
 * F-Droid builds from source on its own buildserver, from a git tag, via the recipe kept at
 * docs/fdroid/au.how2vote.app.yml — no store account, no CI, no secrets. That path only works
 * while a set of facts about this repo hold, and every one of them could drift silently (a
 * Capacitor upgrade re-adding the google-services template block is the canonical example).
 * This asserts them on every PR:
 *
 *   1. Inclusion-policy scanner simulation — no proprietary-service reference anywhere in the
 *      Android gradle files (google-services, Firebase, play-services, Crashlytics, ad SDKs).
 *      fdroidserver's scanner rejects these even when dormant.
 *   2. The version-injection contract — app/build.gradle reads versionCode/versionName from
 *      gradle PROJECT PROPERTIES (the recipe's prebuild appends them to gradle.properties from
 *      the build block's $$VERCODE$$/$$VERSION$$), and never requires CI's -P flags.
 *   3. Formula parity — resolve-store-version (bash) and generate-app-version.mjs (JS) encode
 *      the same versionCode; the endpoint the recipe polls must predict what gradle builds. Every
 *      version pair the recipe itself declares (the CurrentVersion header and each build block) is
 *      evaluated against that encoding, so a hand-edited digit cannot mis-rank a release.
 *   4. The recipe reference itself — public repo URL, right subdir, gradle build, the
 *      property-injection prebuild line, the update-check endpoint, AGPL license, and a
 *      single-fetch UpdateCheckData.
 *   5. Listing metadata — the fastlane android text tree is COMMITTED (F-Droid imports it from
 *      the repo at the tag; a gitignored tree would publish an empty listing), at the repo-root
 *      path fdroidserver globs (see FDROID_LISTING_RELS).
 *   6. No remote content — capacitor.config.ts must never grow a `server` block; the offline
 *      guarantee and store rule 2.5.2 both hang on bundled assets (and F-Droid would reject a
 *      wrapper around a remote site outright).
 *
 * Pure decision logic is exported as verdict() for unit tests; fs/CLI plumbing runs only when
 * executed directly. Same shape as check-store-channel.mjs.
 *
 * Usage: node scripts/check-fdroid-ready.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import { encodeVersionCode } from "./generate-app-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const RECIPE_REL = "docs/fdroid/au.how2vote.app.yml";

/** Gradle files the scanner simulation sweeps (all hand-kept Android build inputs). */
export const GRADLE_RELS = [
  "apps/mobile/android/build.gradle",
  "apps/mobile/android/app/build.gradle",
  "apps/mobile/android/variables.gradle",
  "apps/mobile/android/settings.gradle",
  "apps/mobile/android/gradle.properties",
  // cap-sync-maintained — a Capacitor upgrade can rewrite these, so they are swept too.
  "apps/mobile/android/capacitor.settings.gradle",
  "apps/mobile/android/app/capacitor.build.gradle",
];

/** Proprietary-service markers fdroidserver's scanner (or its reviewers) reject. */
export const FORBIDDEN = [
  "com.google.gms",
  "google-services",
  "com.google.firebase",
  "firebase",
  "play-services",
  "crashlytics",
  "com.google.android.play",
  "installreferrer",
];

/** The committed Play listing text (source of the F-Droid mirror below). */
export const LISTING_RELS = [
  "apps/mobile/fastlane/metadata/android/en-AU/title.txt",
  "apps/mobile/fastlane/metadata/android/en-AU/short_description.txt",
  "apps/mobile/fastlane/metadata/android/en-AU/full_description.txt",
];

/**
 * The listing files F-Droid imports. fdroidserver globs three locations, all relative to the repo
 * checkout ROOT rather than the build subdir:
 *   <checkout>/fastlane/metadata/android/<locale>/
 *   <checkout>/metadata/<locale>/
 *   <checkout>/src/<buildFlavor>/fastlane/metadata/android/<locale>/   (flavour builds only)
 * Nothing under apps/mobile/ is read. generate-store-metadata.mjs writes these; --check diffs
 * their bytes.
 */
export const FDROID_LISTING_RELS = [
  "fastlane/metadata/android/en-US/title.txt",
  "fastlane/metadata/android/en-US/short_description.txt",
  "fastlane/metadata/android/en-US/full_description.txt",
];

/** The one shared versionCode formula, as each side spells it. */
const FORMULA_BASH = "(10#$MAJOR * 10000 + 10#$MINOR * 100 + 10#$PATCH) * 1000";
const FORMULA_JS = "(major * 10000 + minor * 100 + patch) * 1000";

/**
 * @param {Record<string,string>} files map of rel-path → contents (missing = fail closed)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(files) {
  const errors = [];
  const push = (m) => errors.push(m);
  const need = (rel) => {
    const text = files[rel];
    if (typeof text !== "string") {
      push(`${rel}: not supplied (fail-closed)`);
      return null;
    }
    return text;
  };

  // 1 — scanner simulation over every Android gradle file.
  for (const rel of GRADLE_RELS) {
    const text = need(rel);
    if (text === null) continue;
    const lower = text.toLowerCase();
    for (const marker of FORBIDDEN) {
      if (lower.includes(marker)) {
        push(`${rel}: contains "${marker}" — fails the F-Droid inclusion scanner`);
      }
    }
  }

  // 2 — version-injection contract in app/build.gradle.
  const appGradle = files["apps/mobile/android/app/build.gradle"];
  if (typeof appGradle === "string") {
    for (const needle of [
      'project.hasProperty("versionCode")',
      'project.hasProperty("versionName")',
    ]) {
      if (!appGradle.includes(needle)) {
        push(
          `apps/mobile/android/app/build.gradle: missing ${needle} — the F-Droid recipe injects ` +
            `the version pair as gradle project properties and this is the read side`,
        );
      }
    }
  }

  // 3 — versionCode formula parity between the bash action and the JS endpoint generator.
  const action = need(".github/actions/resolve-store-version/action.yml");
  if (action !== null && !action.includes(FORMULA_BASH)) {
    push(
      `.github/actions/resolve-store-version/action.yml: versionCode formula changed — update ` +
        `scripts/generate-app-version.mjs (and this check) IN THE SAME PR or F-Droid builds drift`,
    );
  }
  const generator = need("scripts/generate-app-version.mjs");
  if (generator !== null && !generator.includes(FORMULA_JS)) {
    push(
      `scripts/generate-app-version.mjs: versionCode formula changed — update ` +
        `.github/actions/resolve-store-version (and this check) IN THE SAME PR or F-Droid builds drift`,
    );
  }

  // 4 — the recipe reference still declares the build the CI job mirrors.
  const recipe = need(RECIPE_REL);
  if (recipe !== null) {
    const wants = [
      ["Repo: https://github.com/National-Digital/how2vote.au.git", "public repo URL"],
      ["License: AGPL-3.0-or-later", "license"],
      ["subdir: apps/mobile/android", "gradle subdir"],
      ["- yes", "gradle build flavour"],
      ["versionCode=$$VERCODE$$\\nversionName=$$VERSION$$", "property-injection prebuild line"],
      ["https://how2vote.au/app-version.json", "update-check endpoint"],
      ["AutoUpdateMode: Version v%v", "tag pattern"],
      ["output: app/build/outputs/apk/release/app-release-unsigned.apk", "APK output glob"],
    ];
    for (const [needle, label] of wants) {
      if (!recipe.includes(needle)) push(`${RECIPE_REL}: ${label} — expected "${needle}"`);
    }
  }

  // 4a — UpdateCheckData is `codeURL|codeRegex|nameURL|nameRegex`. fdroidserver sends
  // `User-Agent: F-Droid` on the first request but constructs the second with no headers
  // (checkupdates.py check_http), and that request is answered 403 at the edge. The `.` sentinel
  // re-uses the fetched page, which both regexes match — the pair is in one JSON document.
  if (recipe !== null) {
    const ucd = recipe.match(/^UpdateCheckData:[ \t]*(\S+)[ \t]*$/m)?.[1];
    if (ucd === undefined) {
      push(`${RECIPE_REL}: UpdateCheckData missing — UpdateCheckMode HTTP needs it`);
    } else {
      const fields = ucd.split("|");
      if (fields.length !== 4) {
        push(
          `${RECIPE_REL}: UpdateCheckData must have 4 |-separated fields, found ${fields.length}`,
        );
      } else if (fields[2] !== ".") {
        push(
          `${RECIPE_REL}: UpdateCheckData's versionName URL is "${fields[2]}" — it must be the "." ` +
            `sentinel; a URL there triggers a second, headerless fetch that the edge answers 403`,
        );
      }
    }
  }

  // 4b — every version pair the recipe declares matches the shared encoding. checkupdates derives
  // these from the published endpoint, but the placeholder block and the CurrentVersion header are
  // hand-written: a wrong digit here ranks a release below its predecessor on the F-Droid index.
  if (recipe !== null) {
    /** @type {[string, string, string][]} label, versionName, versionCode */
    const pairs = [];
    const currentName = recipe.match(/^CurrentVersion:[ \t]*([\d.]+)[ \t]*$/m)?.[1];
    const currentCode = recipe.match(/^CurrentVersionCode:[ \t]*(\d+)[ \t]*$/m)?.[1];
    if (currentName === undefined || currentCode === undefined) {
      push(`${RECIPE_REL}: CurrentVersion/CurrentVersionCode missing — checkupdates needs both`);
    } else {
      pairs.push(["CurrentVersion", currentName, currentCode]);
    }
    const blocks = [
      ...recipe.matchAll(
        /^[ \t]*-[ \t]*versionName:[ \t]*([\d.]+)[ \t]*\n[ \t]*versionCode:[ \t]*(\d+)[ \t]*\n[ \t]*commit:[ \t]*(\S+)/gm,
      ),
    ];
    if (blocks.length === 0) {
      push(`${RECIPE_REL}: no build block declares a versionName/versionCode/commit triple`);
    }
    // Every declared block must parse as a full triple — otherwise a block with re-ordered or
    // interleaved fields (checkupdates appends blocks; hand edits happen) would silently skip
    // validation while the well-formed blocks keep the guard green.
    const declared = [...recipe.matchAll(/^[ \t]*-[ \t]*versionName:/gm)].length;
    if (declared !== blocks.length) {
      push(
        `${RECIPE_REL}: ${declared} build block(s) declare versionName but only ${blocks.length} ` +
          `parse as versionName/versionCode/commit triples — keep the three fields adjacent in ` +
          `that order so every block is validated`,
      );
    }
    for (const [, name, code, commit] of blocks) {
      pairs.push([`build block ${name}`, name, code]);
      // deploy.yml tags every release exactly v<version>, and AutoUpdateMode generates commit
      // refs the same way — a hand-written block that deviates points the buildserver at a ref
      // that will never exist.
      if (commit !== `v${name}`) {
        push(`${RECIPE_REL}: build block ${name}: commit "${commit}" must be "v${name}"`);
      }
    }
    for (const [label, name, code] of pairs) {
      const expected = encodeVersionCode(name);
      if (expected === null) {
        push(`${RECIPE_REL}: ${label}: "${name}" is not a versionCode-encodable semver`);
      } else if (Number(code) !== expected) {
        push(
          `${RECIPE_REL}: ${label}: versionCode ${code} is not the shared encoding of ${name} ` +
            `(expected ${expected})`,
        );
      }
    }
  }

  // 4c — license consistency with the tree the recipe describes.
  const license = need("LICENSE");
  if (license !== null && !license.startsWith("GNU AFFERO GENERAL PUBLIC LICENSE")) {
    push(
      "LICENSE: no longer AGPL — the recipe's License: field and F-Droid eligibility both break",
    );
  }
  const mobilePkg = need("apps/mobile/package.json");
  if (mobilePkg !== null && !mobilePkg.includes('"license": "AGPL-3.0-or-later"')) {
    push("apps/mobile/package.json: license drifted from AGPL-3.0-or-later");
  }

  // 5 — committed listing text (content is validated by generate-store-metadata --check; here we
  // only assert the files exist IN THE TREE, i.e. were not re-gitignored).
  for (const rel of LISTING_RELS) {
    if (typeof files[rel] !== "string" || files[rel].trim() === "") {
      push(`${rel}: missing or empty — the source of the F-Droid listing mirror`);
    }
  }
  for (const rel of FDROID_LISTING_RELS) {
    if (typeof files[rel] !== "string" || files[rel].trim() === "") {
      push(
        `${rel}: missing or empty — the path fdroidserver globs for the listing. ` +
          `Run node scripts/generate-store-metadata.mjs and commit the tree`,
      );
    }
  }

  // 6 — no remote-content escape hatch.
  const capConfig = need("apps/mobile/capacitor.config.ts");
  if (capConfig !== null && /\bserver\s*:/.test(capConfig)) {
    push(
      "apps/mobile/capacitor.config.ts: a `server` block appeared — remote content breaks the " +
        "offline guarantee, App Store rule 2.5.2 and F-Droid inclusion; the shells bundle webDir only",
    );
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
function main() {
  const rels = [
    ...GRADLE_RELS,
    ...LISTING_RELS,
    ...FDROID_LISTING_RELS,
    RECIPE_REL,
    ".github/actions/resolve-store-version/action.yml",
    "scripts/generate-app-version.mjs",
    "apps/mobile/capacitor.config.ts",
    "apps/mobile/package.json",
    "LICENSE",
  ];
  const files = {};
  for (const rel of rels) {
    try {
      files[rel] = readFileSync(resolve(ROOT, rel), "utf8");
    } catch {
      /* left undefined → verdict fails closed */
    }
  }
  const { ok, errors } = verdict(files);
  if (!ok) {
    console.error("✗ F-Droid readiness:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.info(
    "✓ F-Droid ready — gradle scanner-clean, property-injection contract intact, " +
      "version formula in parity, recipe + committed listing present",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
