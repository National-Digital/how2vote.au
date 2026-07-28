import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict } from "./check-store-channel.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELS = [
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

function realFiles() {
  const files = {};
  for (const rel of RELS) files[rel] = readFileSync(resolve(ROOT, rel), "utf8");
  return files;
}

describe("store-channel drift guard", () => {
  it("passes on the real, aligned tree", () => {
    expect(verdict(realFiles())).toEqual({ ok: true, errors: [] });
  });

  it("fails closed when a file is missing", () => {
    const files = realFiles();
    delete files["apps/mobile/fastlane/Appfile"];
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("Appfile"))).toBe(true);
  });

  it("catches an app-id drift", () => {
    const files = realFiles();
    files["apps/mobile/android/app/build.gradle"] = files[
      "apps/mobile/android/app/build.gradle"
    ].replace('applicationId "au.how2vote.app"', 'applicationId "com.example.other"');
    expect(verdict(files).errors.some((e) => e.includes("applicationId"))).toBe(true);
  });

  it("catches the app label being re-cased away from the brand name", () => {
    // The label is prose — it is drawn by a font and spoken by a screen reader — so it is
    // "How2Vote" while the application id stays lower case. Re-casing one of the four hand-kept
    // files is the way this drifts.
    const files = realFiles();
    files["apps/mobile/android/app/src/main/res/values/strings.xml"] = files[
      "apps/mobile/android/app/src/main/res/values/strings.xml"
    ].replace(
      '<string name="app_name">How2Vote</string>',
      '<string name="app_name">how2vote</string>',
    );
    expect(verdict(files).errors.some((e) => e.includes("Android app_name drift"))).toBe(true);
  });

  it("catches the F-Droid recipe name drifting from the label", () => {
    const files = realFiles();
    files["docs/fdroid/au.how2vote.app.yml"] = files["docs/fdroid/au.how2vote.app.yml"].replace(
      "AutoName: How2Vote",
      "AutoName: how2vote",
    );
    expect(verdict(files).errors.some((e) => e.includes("F-Droid recipe display name"))).toBe(true);
  });

  it("catches a template package remnant", () => {
    const files = realFiles();
    files["apps/mobile/android/app/build.gradle"] += "\n// com.getcapacitor leftover\n";
    expect(verdict(files).errors.some((e) => e.includes("com.getcapacitor"))).toBe(true);
  });

  it("catches an inline build-number formula in a release workflow", () => {
    const files = realFiles();
    files[".github/workflows/ios-release.yml"] += "\n# build=run_number * 10\n";
    expect(verdict(files).errors.some((e) => e.includes("run_number"))).toBe(true);
  });
});
