import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FDROID_LISTING_RELS,
  FORBIDDEN,
  GRADLE_RELS,
  LISTING_RELS,
  RECIPE_REL,
  phaseItems,
  verdict,
} from "./check-fdroid-ready.mjs";
import { encodeVersionCode } from "./generate-app-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELS = [
  ...GRADLE_RELS,
  ...LISTING_RELS,
  ...FDROID_LISTING_RELS,
  RECIPE_REL,
  ".github/actions/resolve-store-version/action.yml",
  "scripts/generate-app-version.mjs",
  ".nvmrc",
  "package.json",
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

  it("catches a second update-check fetch", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^UpdateCheckData:.*$/m,
      'UpdateCheckData: https://how2vote.au/app-version.json|"versionCode":\\s*(\\d+)|' +
        'https://how2vote.au/app-version.json|"versionName":\\s*"([\\d.]+)"',
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("sentinel"))).toBe(true);
  });

  it("catches UpdateCheckData losing a field", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^UpdateCheckData:.*$/m,
      'UpdateCheckData: https://how2vote.au/app-version.json|"versionCode":\\s*(\\d+)',
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("4 |-separated fields"))).toBe(true);
  });

  it("catches the F-Droid listing being emptied", () => {
    for (const rel of FDROID_LISTING_RELS) {
      const files = realFiles();
      files[rel] = "";
      const { ok, errors } = verdict(files);
      expect(ok).toBe(false);
      expect(errors.some((e) => e.startsWith(`${rel}:`))).toBe(true);
    }
  });

  it("looks for the listing at the repo root, where fdroidserver globs", () => {
    for (const rel of FDROID_LISTING_RELS) {
      expect(rel.startsWith("fastlane/metadata/android/en-US/")).toBe(true);
    }
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

  it("declares a build-block commit that is either v<versionName> or a full hash", () => {
    const recipe = readFileSync(resolve(ROOT, RECIPE_REL), "utf8");
    const name = recipe.match(/versionName:\s*([\d.]+)/)?.[1];
    const commit = recipe.match(/^\s*commit:[ \t]*(\S+)/m)?.[1];
    expect(commit === `v${name}` || /^[0-9a-f]{40}$/.test(commit)).toBe(true);
  });

  it("accepts the v<versionName> tag form", () => {
    const files = realFiles();
    const name = files[RECIPE_REL].match(/versionName:\s*([\d.]+)/)?.[1];
    files[RECIPE_REL] = files[RECIPE_REL].replace(/^(\s*)commit: \S+$/m, `$1commit: v${name}`);
    expect(verdict(files, { revParse: () => null })).toEqual({ ok: true, errors: [] });
  });

  it("catches a commit ref that is neither the tag nor a full hash", () => {
    const files = realFiles();
    for (const bad of ["v9.9.9", "615f2581", "main", "615F25814211DD7CE7A0667533E37A3E2FC3943D"]) {
      files[RECIPE_REL] = realFiles()[RECIPE_REL].replace(
        /^(\s*)commit: \S+$/m,
        `$1commit: ${bad}`,
      );
      const { ok, errors } = verdict(files, { revParse: () => null });
      expect(ok, `${bad} should be rejected`).toBe(false);
      expect(errors.some((e) => e.includes("or a full "))).toBe(true);
    }
  });

  it("catches a hash that is not the commit its versionName's tag points at", () => {
    const files = realFiles();
    const wrong = "a".repeat(40);
    files[RECIPE_REL] = files[RECIPE_REL].replace(/^(\s*)commit: \S+$/m, `$1commit: ${wrong}`);
    const { ok, errors } = verdict(files, { revParse: () => "b".repeat(40) });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("is not what v"))).toBe(true);
  });

  it("skips the hash-to-tag check when the tag is absent (a CI checkout has no tags)", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^(\s*)commit: \S+$/m,
      `$1commit: ${"c".repeat(40)}`,
    );
    expect(verdict(files, { revParse: () => null })).toEqual({ ok: true, errors: [] });
  });

  it("catches a block whose fields are interleaved and so would skip triple validation", () => {
    const files = realFiles();
    // A second block with a field between versionCode and commit — the triple regex cannot see
    // it, so without the declared-vs-parsed count it would be silently unvalidated.
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^AutoUpdateMode:/m,
      "  - versionName: 9.9.9\n    versionCode: 90909000\n    disable: example\n    commit: v9.9.9\n\nAutoUpdateMode:",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("parse as versionName/versionCode/commit"))).toBe(true);
  });
});

describe("toolchain parity", () => {
  it("catches a suite whose Node major is not .nvmrc's", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replaceAll("-t forky", "-t trixie");
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes(".nvmrc pins"))).toBe(true);
  });

  it("catches a suite with no recorded Node major", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replaceAll("-t forky", "-t duke");
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("is not recorded"))).toBe(true);
  });

  it("catches an installer script piped into a shell", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      "      - apt-get update\n",
      "      - curl -fsSL https://deb.nodesource.com/setup_24.x | bash -\n",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("pipes a downloaded script into a shell"))).toBe(true);
  });

  it("catches the recipe's pnpm pin drifting from package.json", () => {
    const files = realFiles();
    const pinned = /"packageManager":[ \t]*"pnpm@([^"]+)"/.exec(files["package.json"])?.[1];
    expect(pinned).toBeDefined();
    files[RECIPE_REL] = files[RECIPE_REL].replaceAll(`pnpm@${pinned}`, "pnpm@10.0.0");
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("but package.json pins"))).toBe(true);
  });

  it("catches a dropped pnpm pin", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replaceAll(/^.*npm install -g pnpm@.*\n/gm, "");
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('no "npm install -g pnpm@<version>" line'))).toBe(true);
  });
});

describe("one command per phase item", () => {
  it("catches a chained command", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      "      - npm install -g pnpm@",
      "      - npm install -g corepack && corepack enable\n      - npm install -g pnpm@",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("chains with &&"))).toBe(true);
  });

  it("catches a command that changes directory", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replaceAll(
      "pnpm -C ../../.. install --frozen-lockfile",
      "cd ../../..",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("changes directory"))).toBe(true);
  });

  it("reads every command from every build block", () => {
    const recipe = readFileSync(resolve(ROOT, RECIPE_REL), "utf8");
    const blocks = recipe.match(/^[ \t]*-[ \t]*versionName:/gm)?.length ?? 0;
    expect(blocks).toBeGreaterThan(1);
    const installs = phaseItems(recipe).filter(
      ([cmd, phase]) => phase === "prebuild" && cmd.includes("--frozen-lockfile"),
    );
    expect(installs).toHaveLength(blocks);
  });
});

describe("reproducible-build pinning", () => {
  it("catches Binaries without AllowedAPKSigningKeys", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^AllowedAPKSigningKeys:(?:[ \t]+[0-9a-fA-F]{64}[ \t]*|\n(?:\s+-\s*[0-9a-fA-F]{64}\s*\n)+)\n?/m,
      "",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("AllowedAPKSigningKeys missing"))).toBe(true);
  });

  it("catches a Binaries URL that cannot follow releases", () => {
    const files = realFiles();
    files[RECIPE_REL] = files[RECIPE_REL].replace(
      /^Binaries:.*$/m,
      "Binaries: https://example.org/how2vote.apk",
    );
    const { ok, errors } = verdict(files);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("no %v"))).toBe(true);
  });
});
