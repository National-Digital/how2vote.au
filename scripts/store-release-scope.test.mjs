import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { encodeVersionCode, legacyVersionCode } from "./generate-app-version.mjs";
import {
  APP_SCRIPTS,
  decide,
  fdroidContext,
  hasMarker,
  isAppPath,
  isPublishRun,
  isSkipped,
  lastPublished,
  lastShipped,
  MAX_RECORD_LOOKUPS,
  parseTagRecords,
  PUBLISH_JOB,
  PUBLISH_STEP,
  recordRunId,
  selectBase,
  servedVersion,
  SHIP_MARKER,
  SKIP_MARKER,
  TRAILER,
  trustedRecords,
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
      ".github/workflows/ios-submit.yml",
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
      ".github/workflows/ios-submit.yml",
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

describe("trustedRecords", () => {
  const records = parseTagRecords(FIXTURE);
  // C(1) (v1.4.5) is an ancestor of C(2) (v1.4.6, the oldest annotated release tag).
  const ancestry = new Set([`${C(1)}>${C(2)}`]);
  const isAncestor = (a, d) => a === d || ancestry.has(`${a}>${d}`);

  it("trusts every tag while no annotated release tag exists", () => {
    const legacy = parseTagRecords(
      ref("v1.4.4", "commit", C(7), "", "x\n") + ref("v1.4.5", "commit", C(1), "", "y\n"),
    );
    const never = () => {
      throw new Error("no ancestry check expected");
    };
    expect(trustedRecords(legacy, never).map((r) => r.tag)).toEqual(["v1.4.5", "v1.4.4"]);
  });

  it("trusts a lightweight tag only below the oldest annotated release tag", () => {
    const late = parseTagRecords(ref("v1.4.11", "commit", C(8), "", "made in the UI\n"));
    const all = [...late, ...records];
    expect(trustedRecords(all, isAncestor).map((r) => r.tag)).toEqual([
      "v1.4.10",
      "v1.4.7",
      "v1.4.6",
      "v1.4.5",
    ]);
  });

  it("never makes a late lightweight tag the diff base or the advertised version", async () => {
    const late = parseTagRecords(ref("v1.4.11", "commit", C(8), "", "made in the UI\n"));
    const trusted = trustedRecords([...late, ...records], isAncestor);
    expect(lastShipped(trusted)?.tag).toBe("v1.4.6");
    expect((await lastPublished(trusted, async () => false)).published?.tag).toBe("v1.4.5");
  });
});

describe("lastPublished", () => {
  const records = parseTagRecords(FIXTURE);

  it("advertises the newest ship tag with a record, never looking up a skip tag", async () => {
    const seen = [];
    const has = async (r) => (seen.push(r.tag), true);
    expect(await lastPublished(records, has)).toEqual({
      complete: true,
      published: { tag: "v1.4.6", version: "1.4.6" },
    });
    expect(seen).toEqual(["v1.4.6"]);
  });

  it("falls through a ship tag without a record to the legacy tag", async () => {
    expect(await lastPublished(records, async () => false)).toEqual({
      complete: true,
      published: { tag: "v1.4.5", version: "1.4.5" },
    });
  });

  it("is complete with nothing published when no tag qualifies", async () => {
    const annotated = records.filter((r) => r.annotated);
    expect(await lastPublished(annotated, async () => false)).toEqual({
      complete: true,
      published: null,
    });
  });

  it("does not count skip tags against the cap", async () => {
    const skips = Array.from({ length: MAX_RECORD_LOOKUPS * 3 }, (_, i) => ({
      ...records.find((r) => r.tag === "v1.4.7"),
      tag: `v2.0.${1000 - i}`,
    }));
    const result = await lastPublished([...skips, ...records], async () => true);
    expect(result.published?.tag).toBe("v1.4.6");
  });

  it("reports an unknown answer at the cap instead of throwing", async () => {
    const ships = Array.from({ length: MAX_RECORD_LOOKUPS + 1 }, (_, i) => ({
      ...records.find((r) => r.tag === "v1.4.6"),
      tag: `v2.0.${1000 - i}`,
    }));
    const result = await lastPublished([...ships, ...records], async () => false);
    expect(result.complete).toBe(false);
    expect(result.reason).toMatch(/no F-Droid record/);
  });

  it("reports an unknown answer when a lookup fails", async () => {
    const result = await lastPublished(records, async () => {
      throw new Error("HTTP 502");
    });
    expect(result).toMatchObject({ complete: false, reason: "HTTP 502" });
  });
});

describe("recordRunId", () => {
  const repo = "National-Digital/how2vote.au";
  const url = `https://github.com/${repo}/actions/runs/123`;
  const combined = (status) => ({ state: "success", statuses: [status] });

  it("reads the run from this tag's latest success status", () => {
    const ok = { context: "fdroid-apk/v1.4.7", state: "success", target_url: url };
    expect(recordRunId(combined(ok), "v1.4.7", repo)).toBe("123");
  });

  it("refuses another tag's context, a non-success state, and a run in another repository", () => {
    const ok = { context: "fdroid-apk/v1.4.7", state: "success", target_url: url };
    expect(recordRunId(combined(ok), "v1.4.8", repo)).toBeNull();
    expect(recordRunId(combined({ ...ok, state: "failure" }), "v1.4.7", repo)).toBeNull();
    const elsewhere = { ...ok, target_url: "https://github.com/x/y/actions/runs/123" };
    expect(recordRunId(combined(elsewhere), "v1.4.7", repo)).toBeNull();
    expect(
      recordRunId(combined({ ...ok, target_url: `${url}/jobs/1` }), "v1.4.7", repo),
    ).toBeNull();
    expect(recordRunId({}, "v1.4.7", repo)).toBeNull();
  });
});

describe("isPublishRun", () => {
  const repo = "National-Digital/how2vote.au";
  const run = {
    path: ".github/workflows/android-release.yml",
    head_branch: "main",
    event: "workflow_dispatch",
    repository: { full_name: repo },
  };
  const jobs = {
    jobs: [{ name: PUBLISH_JOB, steps: [{ name: PUBLISH_STEP, conclusion: "success" }] }],
  };

  it("accepts an android-release dispatch on main whose publish job verified the APK", () => {
    expect(isPublishRun(run, jobs, repo)).toBe(true);
  });

  it("refuses any other workflow, branch, event, repository or step outcome", () => {
    expect(isPublishRun({ ...run, path: ".github/workflows/ci.yml" }, jobs, repo)).toBe(false);
    expect(isPublishRun({ ...run, head_branch: "feature" }, jobs, repo)).toBe(false);
    expect(isPublishRun({ ...run, event: "push" }, jobs, repo)).toBe(false);
    expect(isPublishRun({ ...run, repository: { full_name: "x/y" } }, jobs, repo)).toBe(false);
    const failed = {
      jobs: [{ name: PUBLISH_JOB, steps: [{ name: PUBLISH_STEP, conclusion: "failure" }] }],
    };
    expect(isPublishRun(run, failed, repo)).toBe(false);
    expect(isPublishRun(run, { jobs: [] }, repo)).toBe(false);
  });

  it("names the job and step android-release.yml actually has", () => {
    const android = read(".github/workflows/android-release.yml");
    expect(android).toContain(`name: ${PUBLISH_JOB}\n`);
    expect(android).toContain(`- name: ${PUBLISH_STEP}\n`);
  });
});

describe("servedVersion", () => {
  const records = parseTagRecords(FIXTURE);
  const codes = (v) => [encodeVersionCode(v), legacyVersionCode(v)].filter((c) => c !== null);

  it("keeps a served version that is a trusted, non-skipped release with a matching code", () => {
    const v = { versionName: "1.4.6", versionCode: encodeVersionCode("1.4.6") };
    expect(servedVersion(v, records, codes)).toBe("1.4.6");
    const legacy = { versionName: "1.4.5", versionCode: legacyVersionCode("1.4.5") };
    expect(servedVersion(legacy, records, codes)).toBe("1.4.5");
  });

  it("refuses a malformed, mismatched, unknown or skipped version", () => {
    expect(servedVersion({ versionName: null, versionCode: null }, records, codes)).toBeNull();
    expect(servedVersion({ versionName: "1.4.6", versionCode: 1 }, records, codes)).toBeNull();
    const unknown = { versionName: "1.9.0", versionCode: encodeVersionCode("1.9.0") };
    expect(servedVersion(unknown, records, codes)).toBeNull();
    const skipped = { versionName: "1.4.7", versionCode: encodeVersionCode("1.4.7") };
    expect(servedVersion(skipped, records, codes)).toBeNull();
    expect(servedVersion(null, records, codes)).toBeNull();
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

/** One job of a workflow: from its header to the next job's. */
const job = (text, id) => {
  const start = text.indexOf(`\n  ${id}:\n`);
  expect(start, id).toBeGreaterThan(-1);
  const next = text.slice(start + 1).search(/\n {2}[\w-]+:\n/);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
};

describe("deploy.yml", () => {
  const deploy = code(".github/workflows/deploy.yml");
  const release = job(deploy, "release");
  const build = job(deploy, "deploy");

  it("records the decision on an annotated tag in the form lastShipped reads", () => {
    expect(release).toContain(`TRAILER="${TRAILER}: ship"`);
    expect(release).toContain(`TRAILER="${TRAILER}: skip"`);
    expect(release).toMatch(/tag -a "\$V" -m "\$V" -m "\$TRAILER"/);
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

  it("decides in the build job, which can read the records, and builds the endpoint from it", () => {
    expect(build).toContain("node scripts/store-release-scope.mjs");
    expect(build).toContain("STORE_APP_VERSION: ${{ steps.stores.outputs.store-version }}");
    expect(build).toMatch(/\n {6}statuses: read/);
    expect(build).toMatch(/\n {6}actions: read/);
    expect(build).toContain("merge_commit_sha == env.SHA");
  });
});

describe("android-release.yml", () => {
  const publish = job(code(".github/workflows/android-release.yml"), "fdroid-publish");

  it("records the published APK after verifying it, then redeploys", () => {
    expect(publish).toContain(`context="${fdroidContext("v$V")}"`);
    expect(publish).toContain('-f target_url="$RUN_URL"');
    expect(publish).toContain('"repos/$REPO/statuses/$COMMIT"');
    expect(publish).toContain("gh workflow run deploy.yml");
    expect(publish).toMatch(/\n {6}statuses: write/);
    expect(publish).toMatch(/\n {6}actions: write/);
    expect(publish.indexOf("statuses/$COMMIT")).toBeGreaterThan(
      publish.indexOf(`name: ${PUBLISH_STEP}`),
    );
  });
});

describe("mobile-ci.yml", () => {
  it("compiles the shells for every change this script ships, failing if it errors", () => {
    const scope = job(code(".github/workflows/mobile-ci.yml"), "scope");
    expect(scope).toContain(
      'SHIPS="$(printf \'%s\\n\' "$FILES" | node scripts/store-release-scope.mjs --classify)"',
    );
    expect(scope).toContain('elif [ "$SHIPS" = true ]; then');
  });
});
