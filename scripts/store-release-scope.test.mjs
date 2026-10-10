import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_SCRIPTS,
  decide,
  fdroidContext,
  hasMarker,
  hasSuccessStatus,
  isAppPath,
  isSkipped,
  lastPublished,
  lastShipped,
  MAX_RECORD_LOOKUPS,
  parseTagRecords,
  selectBase,
  SHIP_MARKER,
  SKIP_MARKER,
  TRAILER,
} from "./store-release-scope.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("isAppPath", () => {
  it("ships what the apps are built from", () => {
    for (const p of [
      "apps/web/src/routes/+page.svelte",
      "apps/web/src/lib/operator.json",
      "apps/web/static/fonts/x.woff2",
      "apps/web/svelte.config.js",
      "apps/web/vite.config.ts",
      "apps/web/scripts/strip-native-states.mjs",
      "apps/web/package.json",
      "apps/mobile/ios/App/App/AppDelegate.swift",
      "apps/mobile/android/app/build.gradle",
      "apps/mobile/fastlane/Fastfile",
      "apps/mobile/fastlane/metadata/ios/en-AU/description.txt",
      "apps/mobile/fastlane/screenshots/ios/en-AU/1.png",
      "fastlane/metadata/android/en-US/full_description.txt",
      "packages/engine/src/score.ts",
      "packages/data-schema/src/index.ts",
      "data/dist/2025/dataset.json",
      "data/raw/anything.csv",
      "docs/research/standards-register.json",
      "docs/fdroid/au.how2vote.app.yml",
      "docs/legal/native-copy.json",
      "docs/legal/required-checks.json",
      ".github/workflows/android-release.yml",
      ".github/workflows/ios-release.yml",
      ".github/actions/build-web-channel/action.yml",
      ".github/actions/resolve-store-version/action.yml",
      "scripts/generate-store-metadata.mjs",
      "scripts/generate-app-version.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      ".nvmrc",
      ".npmrc",
      ".gitignore",
      "tsconfig.base.json",
      "a/new/top-level/thing.txt",
    ]) {
      expect(isAppPath(p), p).toBe(true);
    }
  });

  it("skips what never reaches the apps or their builds", () => {
    for (const p of [
      "README.md",
      "CONTRIBUTING.md",
      "THIRD-PARTY-NOTICES.md",
      "LICENSE",
      "CITATION.cff",
      "docs/store-distribution.md",
      "docs/adr/0019-native-document-projection.md",
      "docs/legal/control-register.json",
      "docs/privacy/claims.json",
      ".github/workflows/deploy.yml",
      ".github/workflows/mobile-ci.yml",
      ".github/dependabot.yml",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".githooks/pre-push",
      ".gitleaks.toml",
      ".prettierrc.json",
      "eslint.config.js",
      "vitest.scripts.config.js",
      "scripts/check-fdroid-ready.mjs",
      "scripts/next-version.mjs",
      "scripts/store-release-scope.mjs",
      "scripts/generate-store-metadata.test.mjs",
      "infra/providers/cloudflare/migration-registry.json",
      "tools/deploy/package.json",
      "packages/data-pipeline/src/bin/build-dataset.ts",
      "packages/engine/src/score.test.ts",
      "apps/web/src/lib/channel.test.ts",
      "apps/web/functions/api/forms.ts",
      "apps/web/migrations/0001_init.sql",
      "apps/web/wrangler.toml",
      "apps/web/e2e/quiz.spec.ts",
      "apps/web/features/x.feature",
      "apps/web/test-support/env-public.ts",
      "apps/web/playwright.config.ts",
      "apps/web/playwright.screenshots.config.ts",
      "apps/web/vitest.config.ts",
      "apps/web/lighthouserc.json",
      "apps/web/budgets.json",
    ]) {
      expect(isAppPath(p), p).toBe(false);
    }
  });

  it("ships every docs file the web bundle imports", () => {
    const imports = new Set();
    const walk = (dir) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|js|svelte)$/.test(name) && !/\.(test|spec)\./.test(name)) {
          for (const m of read(rel).matchAll(/["']\$docs\/([^"']+)["']/g)) imports.add(m[1]);
        }
      }
    };
    walk("apps/web/src");
    expect(imports.size).toBeGreaterThan(0);
    for (const rest of imports) expect(isAppPath(`docs/${rest}`), `docs/${rest}`).toBe(true);
  });

  it("ships every root script a store build runs, with its imports", () => {
    const sources = [
      ".github/workflows/android-release.yml",
      ".github/workflows/ios-release.yml",
      ...readdirSync(join(ROOT, ".github/actions")).map((a) => `.github/actions/${a}/action.yml`),
      "apps/mobile/fastlane/Fastfile",
      "docs/fdroid/au.how2vote.app.yml",
    ];
    const found = new Set();
    const visit = (rel) => {
      if (found.has(rel) || !existsSync(join(ROOT, rel))) return;
      found.add(rel);
      for (const m of read(rel).matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        visit(relative(ROOT, normalize(join(ROOT, dirname(rel), m[1]))).replaceAll("\\", "/"));
      }
    };
    for (const src of sources) {
      const code = read(src)
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      for (const m of code.matchAll(/(?<![\w./-])scripts\/[\w.-]+\.mjs/g)) visit(m[0]);
    }
    expect([...found].sort()).toEqual([...APP_SCRIPTS].sort());
  });
});

describe("decide", () => {
  it("ships when an app-affecting path changed", () => {
    const r = decide({ paths: ["README.md", "apps/web/src/app.css"] });
    expect(r.ship).toBe(true);
    expect(r.appPaths).toEqual(["apps/web/src/app.css"]);
  });

  it("skips a docs- and CI-only change", () => {
    const r = decide({ paths: ["docs/store-distribution.md", ".github/workflows/deploy.yml"] });
    expect(r).toEqual({ ship: false, reason: "no app-affecting change", appPaths: [] });
  });

  it("skips an empty diff", () => {
    expect(decide({ paths: [] }).ship).toBe(false);
  });

  it("ships with no shipped release to compare against", () => {
    expect(decide({ paths: null }).ship).toBe(true);
  });

  it("ships a non-app change carrying the marker", () => {
    for (const where of ["prText", "history"]) {
      const r = decide({
        paths: ["README.md"],
        [where]: `docs: x\n\nRelease the apps [Ship-Apps]`,
      });
      expect(r.ship, where).toBe(true);
      expect(r.reason).toContain(SHIP_MARKER);
    }
  });

  it("holds back an app-affecting change on a skip marker in the pull request", () => {
    const r = decide({ paths: ["apps/web/src/app.css"], prText: `fix: x\n\n${SKIP_MARKER}` });
    expect(r.ship).toBe(false);
    expect(r.appPaths).toEqual(["apps/web/src/app.css"]);
  });

  it("ignores a skip marker in commit history, which outlives its release", () => {
    expect(decide({ paths: ["apps/web/src/app.css"], history: SKIP_MARKER }).ship).toBe(true);
  });

  it("lets the ship marker win over the skip marker", () => {
    const paths = ["apps/web/src/app.css"];
    expect(decide({ paths, prText: `${SKIP_MARKER} ${SHIP_MARKER}` }).ship).toBe(true);
    expect(decide({ paths, prText: SKIP_MARKER, history: SHIP_MARKER }).ship).toBe(true);
  });

  it("ships when the pull request text could not be read", () => {
    expect(decide({ paths: ["README.md"], lookupFailed: true }).ship).toBe(true);
  });
});

describe("hasMarker", () => {
  it("matches a standalone marker, in any case", () => {
    expect(hasMarker("[SHIP-apps]", SHIP_MARKER)).toBe(true);
    expect(hasMarker("docs: x\n\nplease [ship-apps].", SHIP_MARKER)).toBe(true);
    expect(hasMarker("(see [ship-apps])", SHIP_MARKER)).toBe(true);
  });

  it("ignores a marker in backticks, joined to a word, or unbracketed", () => {
    expect(hasMarker("use `[ship-apps]` to force", SHIP_MARKER)).toBe(false);
    expect(hasMarker("x[ship-apps]", SHIP_MARKER)).toBe(false);
    expect(hasMarker("[ship-apps]x", SHIP_MARKER)).toBe(false);
    expect(hasMarker("ship-apps", SHIP_MARKER)).toBe(false);
    expect(hasMarker(undefined, SHIP_MARKER)).toBe(false);
  });
});

/** One for-each-ref record in TAG_FORMAT, as git prints it. */
const ref = (tag, type, object, peeled, contents) =>
  `${tag}\x1f${type}\x1f${object}\x1f${peeled}\x1f${contents}\x1e\n`;
const C = (n) => String(n).repeat(40);

const FIXTURE =
  // Lightweight: for-each-ref prints the COMMIT's message, which here happens to hold the trailer.
  ref("v1.4.5", "commit", C(1), "", `docs: mention\n\n${TRAILER}: skip\n`) +
  ref("v1.4.6", "tag", "a".repeat(40), C(2), `v1.4.6\n\n${TRAILER}: ship\n`) +
  ref("v1.4.7", "tag", "b".repeat(40), C(3), `v1.4.7\n\n${TRAILER}: skip\n`) +
  ref("v1.4.10", "tag", "c".repeat(40), C(4), `v1.4.10\n\n${TRAILER}: skip\n`) +
  ref("v1.5.0-rc", "tag", "d".repeat(40), C(5), "rc\n") +
  ref("latest", "commit", C(6), "", "x\n");

describe("parseTagRecords", () => {
  const records = parseTagRecords(FIXTURE);

  it("keeps release tags only, newest version first", () => {
    expect(records.map((r) => r.tag)).toEqual(["v1.4.10", "v1.4.7", "v1.4.6", "v1.4.5"]);
  });

  it("peels annotated tags to their commit and drops a lightweight tag's commit message", () => {
    expect(records.find((r) => r.tag === "v1.4.6")).toMatchObject({
      annotated: true,
      commit: C(2),
      message: `v1.4.6\n\n${TRAILER}: ship\n`,
    });
    expect(records.find((r) => r.tag === "v1.4.5")).toMatchObject({
      annotated: false,
      commit: C(1),
      message: "",
    });
  });

  it("is empty for no output", () => {
    expect(parseTagRecords("")).toEqual([]);
  });
});

describe("lastShipped", () => {
  it("skips annotated skip tags and stops at a ship tag", () => {
    expect(lastShipped(parseTagRecords(FIXTURE))).toEqual({ tag: "v1.4.6", version: "1.4.6" });
  });

  it("counts a lightweight tag as shipped whatever its commit message says", () => {
    const records = parseTagRecords(FIXTURE).filter((r) => r.tag === "v1.4.5");
    expect(lastShipped(records)?.tag).toBe("v1.4.5");
  });

  it("is null when nothing shipped", () => {
    expect(lastShipped([])).toBeNull();
    expect(lastShipped(parseTagRecords(FIXTURE).filter((r) => r.tag === "v1.4.7"))).toBeNull();
  });
});

describe("selectBase", () => {
  it("compares a preview with its base branch and a push with the last shipped release", () => {
    expect(selectBase("pull_request", { tag: "v1.4.6" })).toBe("HEAD^1");
    expect(selectBase("push", { tag: "v1.4.6" })).toBe("v1.4.6");
    expect(selectBase("push", null)).toBeNull();
    expect(selectBase("schedule", { tag: "v1.4.6" })).toBeUndefined();
    expect(selectBase("workflow_dispatch", null)).toBeUndefined();
  });
});

describe("lastPublished", () => {
  const records = parseTagRecords(FIXTURE);

  it("advertises the newest tag with an F-Droid record, whatever its trailer", async () => {
    const seen = [];
    const has = async (r) => (seen.push(r.tag), r.tag === "v1.4.7");
    expect(await lastPublished(records, has)).toEqual({ tag: "v1.4.7", version: "1.4.7" });
    expect(seen).toEqual(["v1.4.10", "v1.4.7"]);
  });

  it("never advertises an annotated tag without a record", async () => {
    expect(await lastPublished(records, async () => false)).toEqual({
      tag: "v1.4.5",
      version: "1.4.5",
    });
  });

  it("treats a lightweight tag as published without a lookup", async () => {
    const lightweight = records.filter((r) => !r.annotated);
    const has = async () => {
      throw new Error("looked up");
    };
    expect((await lastPublished(lightweight, has))?.tag).toBe("v1.4.5");
  });

  it("is null when no tag is published", async () => {
    expect(
      await lastPublished(
        records.filter((r) => r.annotated),
        async () => false,
      ),
    ).toBeNull();
  });

  it("refuses to look further than MAX_RECORD_LOOKUPS tags", async () => {
    const many = Array.from({ length: MAX_RECORD_LOOKUPS + 1 }, (_, i) => ({
      ...records[0],
      tag: `v2.0.${MAX_RECORD_LOOKUPS - i}`,
    }));
    await expect(lastPublished(many, async () => false)).rejects.toThrow(/no F-Droid record/);
  });

  it("propagates a failed lookup", async () => {
    const has = async () => {
      throw new Error("HTTP 502");
    };
    await expect(lastPublished(records, has)).rejects.toThrow("HTTP 502");
  });
});

describe("hasSuccessStatus", () => {
  it("needs a success status in this tag's context", () => {
    const ok = { context: fdroidContext("v1.4.7"), state: "success" };
    expect(hasSuccessStatus([ok], "v1.4.7")).toBe(true);
    expect(hasSuccessStatus([ok], "v1.4.8")).toBe(false);
    expect(hasSuccessStatus([{ ...ok, state: "pending" }], "v1.4.7")).toBe(false);
    expect(hasSuccessStatus([], "v1.4.7")).toBe(false);
  });
});

describe("isSkipped", () => {
  it("reads the trailer on its own line only", () => {
    expect(isSkipped(`v1.0.0\n\n${TRAILER}: skip`)).toBe(true);
    expect(isSkipped(`v1.0.0\n\n${TRAILER}: ship`)).toBe(false);
    expect(isSkipped(`mentions ${TRAILER}: skip inline`)).toBe(false);
  });
});

/** A workflow's text without comment lines, so a guard cannot pass on a comment. */
const code = (rel) =>
  read(rel)
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

describe("deploy.yml", () => {
  const deploy = code(".github/workflows/deploy.yml");
  const release = deploy.slice(deploy.indexOf("\n  release:"), deploy.indexOf("\n  cleanup:"));

  it("records the decision on an annotated tag in the form lastShipped reads", () => {
    expect(release).toContain(`TRAILER="${TRAILER}: ship"`);
    expect(release).toContain(`TRAILER="${TRAILER}: skip"`);
    expect(release).toMatch(/tag -a "\$V" -m "\$V" -m "\$TRAILER"/);
    expect(isSkipped(`v\n\n${TRAILER}: skip`)).toBe(true);
  });

  it("dispatches the stores only on a ship decision", () => {
    expect(release).toContain("SHIP_APPS: ${{ needs.deploy.outputs.ship-apps }}");
    expect(release).toMatch(
      /if \[ "\$\{SHIP_APPS:-\}" = "false" \]; then SHIP=false; else SHIP=true; fi/,
    );
    const skipExit = release.indexOf(
      'if [ "$SHIP" != true ]; then',
      release.indexOf("gh release create"),
    );
    expect(skipExit).toBeGreaterThan(0);
    expect(release.indexOf("dispatch android-release.yml", skipExit)).toBeGreaterThan(skipExit);
  });

  it("refuses an existing tag that is not this commit's ship tag", () => {
    expect(release).toMatch(/check_existing \|\| exit 1/);
    expect(release).toContain('[ "$commit" != "$GITHUB_SHA" ]');
  });

  it("builds the endpoint from the published version", () => {
    expect(deploy).toContain("STORE_APP_VERSION: ${{ steps.stores.outputs.store-version }}");
    expect(deploy).toContain("node scripts/store-release-scope.mjs");
    expect(deploy).toMatch(/statuses: read/);
  });
});

describe("android-release.yml", () => {
  const android = code(".github/workflows/android-release.yml");
  const publish = android.slice(
    android.indexOf("\n  fdroid-publish:"),
    android.indexOf("\n  promote:"),
  );

  it("records the published APK in the context deploy reads, then redeploys", () => {
    expect(fdroidContext("v$V")).toBe("fdroid-apk/v$V");
    expect(publish).toContain(`context="${fdroidContext("v$V")}"`);
    expect(publish).toContain('"repos/$REPO/statuses/$COMMIT"');
    expect(publish).toContain("gh workflow run deploy.yml");
    expect(publish).toMatch(/statuses: write/);
    expect(publish.indexOf("statuses/$COMMIT")).toBeGreaterThan(
      publish.indexOf("Verify the published URL serves the signed bytes"),
    );
  });
});

describe("mobile-ci.yml", () => {
  it("compiles the shells for every change this script ships", () => {
    expect(code(".github/workflows/mobile-ci.yml")).toContain(
      "node scripts/store-release-scope.mjs --classify",
    );
  });
});
