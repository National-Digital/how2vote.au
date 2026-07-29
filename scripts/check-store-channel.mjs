#!/usr/bin/env node
/**
 * @fileoverview CI guard: the three distribution channels (web PWA / iOS / Android) stay aligned.
 *
 * The product is a single codebase shipped three ways; this asserts the facts that would otherwise
 * drift silently across the hand-kept native project files:
 *
 *   1. App identifier `au.how2vote.app` is identical across capacitor.config.ts, the iOS pbxproj,
 *      the Android build.gradle (namespace + applicationId), the fastlane Appfile, and strings.xml.
 *   2. Display name `How2Vote` is identical across capacitor.config.ts, iOS Info.plist, Android
 *      strings.xml and the PWA web manifest.
 *   3. No Capacitor template package remnant (`com.getcapacitor`) survives under apps/mobile.
 *   4. The brand palette (PAPER/SLATE) matches between the native asset generator, the Android
 *      colour resources and the PWA theme-colors — system chrome must carry the brand ground.
 *   5. Neither release workflow hard-codes a build-number formula: both derive the version pair
 *      from the shared resolve-store-version composite action (single source, no drift).
 *
 * Pure decision logic is exported as verdict() for unit tests; the fs/CLI plumbing runs only when
 * executed directly.
 *
 * Usage: node scripts/check-store-channel.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_ID = "au.how2vote.app";
const APP_NAME = "How2Vote";
const PAPER = "#F6F4EE";
const SLATE = "#151410";

const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * @param {Record<string,string>} files map of rel-path → contents
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verdict(files) {
  const errors = [];
  const push = (m) => errors.push(m);
  const has = (rel, needle, label) => {
    const text = files[rel];
    if (typeof text !== "string") return push(`${rel}: not supplied (fail-closed)`);
    if (!text.includes(needle)) push(`${rel}: ${label} — expected "${needle}"`);
  };

  // 1 — app id everywhere it is hand-kept.
  has("apps/mobile/capacitor.config.ts", `appId: "${APP_ID}"`, "appId drift");
  has("apps/mobile/ios/App/App.xcodeproj/project.pbxproj", APP_ID, "iOS bundle id drift");
  has(
    "apps/mobile/android/app/build.gradle",
    `applicationId "${APP_ID}"`,
    "Android applicationId drift",
  );
  has("apps/mobile/android/app/build.gradle", `namespace = "${APP_ID}"`, "Android namespace drift");
  has("apps/mobile/fastlane/Appfile", APP_ID, "fastlane Appfile id drift");

  // 2 — display name everywhere it is hand-kept.
  has("apps/mobile/capacitor.config.ts", `appName: "${APP_NAME}"`, "appName drift");
  has("apps/mobile/ios/App/App/Info.plist", APP_NAME, "iOS display name drift");
  // Anchored on the key, not just the value: strings.xml carries the name twice (app_name and
  // title_activity_main), so a bare `>How2Vote<` search passes while one of them is re-cased.
  for (const key of ["app_name", "title_activity_main"]) {
    has(
      "apps/mobile/android/app/src/main/res/values/strings.xml",
      `<string name="${key}">${APP_NAME}</string>`,
      `Android ${key} drift`,
    );
  }
  has("apps/web/static/manifest.webmanifest", APP_NAME, "PWA manifest name drift");
  // The F-Droid client shows AutoName as the app's name. fdroidserver refreshes it from the built
  // APK's label, so a stale value here is not load-bearing — but it is the name a reader sees in
  // the recipe, and nothing else would catch it drifting from the label it claims to mirror.
  has(
    "docs/fdroid/au.how2vote.app.yml",
    `AutoName: ${APP_NAME}`,
    "F-Droid recipe display name drift",
  );

  // 3 — no template package remnant.
  for (const rel of Object.keys(files)) {
    if (rel.startsWith("apps/mobile/") && files[rel].includes("com.getcapacitor")) {
      push(`${rel}: contains a Capacitor template package remnant (com.getcapacitor)`);
    }
  }

  // 4 — brand palette alignment (system chrome must not fall back to a template accent colour).
  has(
    "apps/mobile/scripts/generate-native-assets.mjs",
    PAPER,
    "PAPER token missing from asset generator",
  );
  has(
    "apps/mobile/android/app/src/main/res/values/colors.xml",
    PAPER,
    "Android light ground not PAPER",
  );
  has(
    "apps/mobile/android/app/src/main/res/values-night/colors.xml",
    SLATE,
    "Android dark ground not SLATE",
  );
  has(
    "apps/mobile/android/app/src/main/res/values/ic_launcher_background.xml",
    PAPER,
    "launcher bg not PAPER",
  );
  has("apps/web/src/app.html", PAPER.toLowerCase(), "PWA light theme-color not PAPER");

  // 5 — both release workflows use the shared version resolver, none inline a build formula.
  for (const rel of [
    ".github/workflows/ios-release.yml",
    ".github/workflows/android-release.yml",
  ]) {
    has(
      rel,
      "uses: ./.github/actions/resolve-store-version",
      "does not use the shared version resolver",
    );
    if (files[rel]?.includes("run_number")) {
      push(`${rel}: hard-codes a build-number formula (run_number) — use resolve-store-version`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/* c8 ignore start -- CLI/fs plumbing, exercised via CI not unit tests */
function main() {
  const rels = [
    "apps/mobile/capacitor.config.ts",
    "apps/mobile/ios/App/App.xcodeproj/project.pbxproj",
    "apps/mobile/ios/App/App/Info.plist",
    "apps/mobile/android/app/build.gradle",
    "apps/mobile/android/app/src/main/res/values/strings.xml",
    "apps/mobile/android/app/src/main/res/values/colors.xml",
    "apps/mobile/android/app/src/main/res/values-night/colors.xml",
    "apps/mobile/android/app/src/main/res/values/ic_launcher_background.xml",
    "apps/mobile/fastlane/Appfile",
    "apps/mobile/scripts/generate-native-assets.mjs",
    "apps/web/static/manifest.webmanifest",
    "apps/web/src/app.html",
    "docs/fdroid/au.how2vote.app.yml",
    ".github/workflows/ios-release.yml",
    ".github/workflows/android-release.yml",
  ];
  const files = {};
  for (const rel of rels) {
    try {
      files[rel] = read(rel);
    } catch {
      /* left undefined → verdict fails closed */
    }
  }
  const { ok, errors } = verdict(files);
  if (!ok) {
    console.error("✗ store-channel drift:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.info(
    `✓ store-channel OK — appId, name, palette and version resolver aligned across web/iOS/Android`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
