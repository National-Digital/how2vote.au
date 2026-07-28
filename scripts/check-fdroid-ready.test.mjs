import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN,
  GRADLE_RELS,
  LISTING_RELS,
  RECIPE_REL,
  verdict,
} from "./check-fdroid-ready.mjs";
import { encodeVersionCode } from "./generate-app-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELS = [
  ...GRADLE_RELS,
  ...LISTING_RELS,
  RECIPE_REL,
  ".github/actions/resolve-store-version/action.yml",
  "scripts/generate-app-version.mjs",
  "apps/mobile/capacitor.config.ts",
  "apps/mobile/package.json",
  "LICENSE",
];

function realFiles() {
  const files = {};
  for (const rel of RELS) files[rel] = readFileSync(resolve(ROOT, rel), "utf8");
  return files;
}

describe("F-Droid readiness guard", () => {
  it("passes on the real tree", () => {
    expect(verdict(realFiles())).toEqual({ ok: true, errors: [] });
  });

  it("fails closed when a file is missing", () => {
    const files = realFiles();
    delete files[RECIPE_REL];
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes(RECIPE_REL))).toBe(true);
  });

  it("catches a proprietary-service reference reappearing in any gradle file", () => {
    for (const marker of FORBIDDEN) {
      const files = realFiles();
      files["apps/mobile/android/build.gradle"] += `\nclasspath '${marker}:x:1.0'\n`;
      const { ok, errors } = verdict(files);
      expect(ok).toBe(false);
      expect(errors.some((e) => e.includes(marker))).toBe(true);
    }
  });

  it("catches the Capacitor template's push-services block being restored verbatim", () => {
    const files = realFiles();
    files["apps/mobile/android/app/build.gradle"] +=
      "\ntry {\n  def servicesJSON = file('google-services.json')\n" +
      "  if (servicesJSON.text) { apply plugin: 'com.google.gms.google-services' }\n} catch(Exception e) {}\n";
    expect(verdict(files).ok).toBe(false);
  });

  it("catches the property-read side of the version contract being dropped", () => {
    const files = realFiles();
    files["apps/mobile/android/app/build.gradle"] = files[
      "apps/mobile/android/app/build.gradle"
    ].replace('project.hasProperty("versionCode")', 'project.hasProperty("vc")');
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("versionCode"))).toBe(true);
  });

  it("catches a one-sided versionCode formula change (bash action edited alone)", () => {
    const files = realFiles();
    files[".github/actions/resolve-store-version/action.yml"] = files[
      ".github/actions/resolve-store-version/action.yml"
    ].replace("MAJOR * 10000", "MAJOR * 100000");
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("formula"))).toBe(true);
  });

  it("catches a remote-content server block appearing in capacitor.config.ts", () => {
    const files = realFiles();
    files["apps/mobile/capacitor.config.ts"] +=
      '\n// @ts-ignore\nconst x = { server: { url: "https://example.com" } };\n';
    expect(verdict(files).ok).toBe(false);
  });

  it("catches the committed listing being emptied or re-gitignored", () => {
    const files = realFiles();
    files["apps/mobile/fastlane/metadata/android/en-AU/title.txt"] = " ";
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("title.txt"))).toBe(true);
  });
});

describe("recipe version pairs", () => {
  it("declares a build-block versionCode that matches the shared encoding of its versionName", () => {
    const recipe = readFileSync(resolve(ROOT, RECIPE_REL), "utf8");
    const name = recipe.match(/versionName:\s*([\d.]+)/)?.[1];
    const code = Number(recipe.match(/versionCode:\s*(\d+)/)?.[1]);
    expect(name).toBeTruthy();
    expect(code).toBe(encodeVersionCode(name));
  });

  it("declares a CurrentVersionCode that matches the shared encoding of CurrentVersion", () => {
    const recipe = readFileSync(resolve(ROOT, RECIPE_REL), "utf8");
    const name = recipe.match(/^CurrentVersion:[ \t]*([\d.]+)/m)?.[1];
    const code = Number(recipe.match(/^CurrentVersionCode:[ \t]*(\d+)/m)?.[1]);
    expect(name).toBeTruthy();
    expect(code).toBe(encodeVersionCode(name));
  });

  it("catches a mis-scaled CurrentVersionCode", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^CurrentVersionCode:.*$/m,
      "CurrentVersionCode: 1000000",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("CurrentVersion"))).toBe(true);
  });

  it("catches a mis-scaled build-block versionCode", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^(\s*)versionCode: \d+$/m,
      "$1versionCode: 10000001",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("build block"))).toBe(true);
  });

  it("catches the CurrentVersion header being dropped", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(/^CurrentVersionCode:.*$/m, "");
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("checkupdates needs both"))).toBe(true);
  });
});
