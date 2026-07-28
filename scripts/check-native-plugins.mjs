#!/usr/bin/env node
/**
 * @fileoverview CI guard: every Capacitor plugin is registered in BOTH native projects.
 *
 * Adding a plugin is three steps — install it, then `cap sync ios` AND `cap sync android` — and
 * the third is silently skippable. `cap sync` rewrites committed files per platform
 * (`ios/App/CapApp-SPM/Package.swift`; `android/capacitor.settings.gradle` +
 * `android/app/capacitor.build.gradle`), so syncing one platform and committing produces a repo
 * where the plugin exists on one OS and not the other.
 *
 * That failure is invisible at every level we currently check. The web bundle does not import any
 * Capacitor package — `channel.ts` reads `window.Capacitor.Plugins` by name and falls back to null
 * when a plugin is absent, which is deliberate defence in depth and also means a missing plugin
 * looks exactly like "running on the web". Type-checking passes, unit tests pass, e2e passes
 * (a browser has no bridge at all), and the feature simply does nothing on the unsynced platform.
 *
 * No build catches this: even a compile SUCCEEDS with a plugin missing, since an absent SPM
 * dependency is only absent, not malformed.
 *
 * So this is a text comparison rather than a build: it is the only check that runs in a second, on
 * Linux, and catches the whole class. Both directions are enforced — a plugin in package.json and
 * absent from a native project, and a plugin registered natively but absent from package.json.
 *
 * Pure decision logic is exported as verdict() for unit tests; fs/CLI plumbing runs only when
 * executed directly. Same shape as check-fdroid-ready.mjs.
 *
 * Usage: node scripts/check-native-plugins.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PKG_REL = "apps/mobile/package.json";
export const SWIFT_REL = "apps/mobile/ios/App/CapApp-SPM/Package.swift";
export const GRADLE_SETTINGS_REL = "apps/mobile/android/capacitor.settings.gradle";
export const GRADLE_BUILD_REL = "apps/mobile/android/app/capacitor.build.gradle";

/**
 * Packages that ship no native code for a platform and so never appear in its project. Keep this
 * empty unless a real case turns up: an entry here is a hole in the guard, so each one needs a
 * reason. `@capacitor/core` and `@capacitor/cli` are excluded structurally below (they are the
 * runtime and the tool, not plugins), as are the two platform packages.
 */
export const NOT_PLUGINS = new Set([
  "@capacitor/core",
  "@capacitor/cli",
  "@capacitor/ios",
  "@capacitor/android",
]);

/** "@capacitor/browser" → "Browser" (the SPM product/name suffix Capacitor generates). */
export function swiftName(pkg) {
  const bare = pkg.replace(/^@capacitor\//, "");
  return bare.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
}

/** "@capacitor/browser" → "capacitor-browser" (the gradle project name Capacitor generates). */
export function gradleName(pkg) {
  return `capacitor-${pkg.replace(/^@capacitor\//, "")}`;
}

/**
 * @param {{pkg: string, swift: string, gradleSettings: string, gradleBuild: string}} files
 * @returns {{ ok: boolean, errors: string[], plugins: string[] }}
 */
export function verdict(files) {
  const errors = [];
  let deps;
  try {
    deps = JSON.parse(files.pkg).dependencies ?? {};
  } catch {
    return { ok: false, errors: [`${PKG_REL} is not readable JSON`], plugins: [] };
  }

  const plugins = Object.keys(deps)
    .filter((name) => name.startsWith("@capacitor/") && !NOT_PLUGINS.has(name))
    .sort();

  if (plugins.length === 0) {
    // Fail closed: an empty plugin list would make every assertion below vacuous, and the shells
    // do use plugins — so this means the parse found the wrong thing.
    errors.push(`no Capacitor plugins found in ${PKG_REL} — the guard would pass vacuously`);
  }

  for (const pkg of plugins) {
    const swift = swiftName(pkg);
    // Both the dependency declaration and the target product matter: Capacitor writes two entries
    // and a hand-edit can leave one behind, which builds but registers nothing.
    if (!files.swift.includes(`name: "Capacitor${swift}"`)) {
      errors.push(
        `${pkg} is a dependency but Capacitor${swift} is not declared in ${SWIFT_REL} — ` +
          `run 'pnpm --filter @how2vote/mobile sync:ios' and commit the result`,
      );
    } else if (!files.swift.includes(`.product(name: "Capacitor${swift}"`)) {
      errors.push(
        `${pkg} is declared in ${SWIFT_REL} but not listed as a target product — re-run sync:ios`,
      );
    }

    const gradle = gradleName(pkg);
    if (!files.gradleSettings.includes(`include ':${gradle}'`)) {
      errors.push(
        `${pkg} is a dependency but ${gradle} is not included in ${GRADLE_SETTINGS_REL} — ` +
          `run 'pnpm --filter @how2vote/mobile sync:android' and commit the result`,
      );
    } else if (!files.gradleBuild.includes(`project(':${gradle}')`)) {
      errors.push(
        `${pkg} is in ${GRADLE_SETTINGS_REL} but not a dependency in ${GRADLE_BUILD_REL} — ` +
          `re-run sync:android`,
      );
    }
  }

  // The other direction: a native project still wiring a plugin that is no longer installed. This
  // is what a removal forgets, and it breaks the build rather than the behaviour — but it breaks it
  // on one platform only, so it deserves the same treatment.
  const known = new Set(plugins.map(gradleName));
  for (const [, name] of files.gradleSettings.matchAll(/include ':(capacitor-[a-z0-9-]+)'/g)) {
    if (name === "capacitor-android" || known.has(name)) continue;
    errors.push(
      `${GRADLE_SETTINGS_REL} still includes ${name}, which is not a dependency in ${PKG_REL}`,
    );
  }

  return { ok: errors.length === 0, errors, plugins };
}

function read(rel) {
  try {
    return readFileSync(resolve(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, errors, plugins } = verdict({
    pkg: read(PKG_REL),
    swift: read(SWIFT_REL),
    gradleSettings: read(GRADLE_SETTINGS_REL),
    gradleBuild: read(GRADLE_BUILD_REL),
  });
  if (!ok) {
    for (const e of errors) console.error(`::error::native-plugins: ${e}`);
    process.exit(1);
  }
  console.info(
    `✓ native plugins OK — ${plugins.length} plugin(s) registered in both shells: ` +
      plugins.map((p) => p.replace("@capacitor/", "")).join(", "),
  );
}
