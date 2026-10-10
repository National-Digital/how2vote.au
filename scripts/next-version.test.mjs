import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { bumpType, highestBump, latestTag, nextVersion } from "./next-version.mjs";

const SCRIPT = fileURLToPath(new URL("./next-version.mjs", import.meta.url));

/** nextVersion over a fixed history: `since` maps a tag to the subjects after it. */
const run = ({ tags = [], since = {}, head = "chore: head", explicit } = {}) =>
  nextVersion({
    tags,
    subjectsSince: (tag) => [...(since[tag] ?? [])],
    headSubject: () => head,
    explicit,
  }).next.join(".");

describe("bumpType", () => {
  it("maps conventional subjects to their bump", () => {
    expect(bumpType("feat: add search")).toBe("minor");
    expect(bumpType("feat(web): add search (#12)")).toBe("minor");
    expect(bumpType("fix: typo")).toBe("patch");
    expect(bumpType("ci: cache the toolchain")).toBe("patch");
    expect(bumpType("feat!: drop v1 data")).toBe("major");
    expect(bumpType("fix(api)!: change shape")).toBe("major");
    expect(bumpType("chore: x BREAKING CHANGE y")).toBe("major");
  });

  it("treats non-conventional subjects as a patch", () => {
    for (const s of ["Merge pull request #12 from a/b", "Update README.md", "", "feat add x"]) {
      expect(bumpType(s)).toBe("patch");
    }
  });
});

describe("highestBump", () => {
  it("returns the strongest bump and the first subject that demands it", () => {
    expect(highestBump(["fix: a", "feat: b", "feat: c", "chore: d"])).toEqual({
      type: "minor",
      subject: "feat: b",
    });
    expect(highestBump(["fix: a", "feat!: b", "feat: c"]).type).toBe("major");
    expect(highestBump(["fix: a"]).type).toBe("patch");
  });
});

describe("latestTag", () => {
  it("picks the highest strict semver tag, numerically", () => {
    expect(latestTag(["v1.3.9", "v1.3.29", "v1.4.0-rc", "v1.2.100", "latest"])).toEqual({
      tag: "v1.3.29",
      version: [1, 3, 29],
    });
    expect(latestTag([])).toBeNull();
  });
});

describe("nextVersion", () => {
  it("takes a feat from the middle of the commits since the tag", () => {
    // A feat whose own release was skipped, with a fix landed on top of it.
    const since = { "v1.3.28": ["fix: later", "feat: the skipped one", "chore: earlier"] };
    expect(run({ tags: ["v1.3.28"], since })).toBe("1.4.0");
  });

  it("bumps the major once for a breaking marker anywhere since the tag", () => {
    const since = { "v1.4.5": ["fix: a", "feat!: b", "feat: c"] };
    expect(run({ tags: ["v1.4.5"], since })).toBe("2.0.0");
  });

  it("bumps a single field once however many commits qualify", () => {
    const since = { "v1.4.5": ["feat: a", "feat: b", "fix: c", "fix: d"] };
    expect(run({ tags: ["v1.4.5"], since })).toBe("1.5.0");
    expect(run({ tags: ["v1.4.5"], since: { "v1.4.5": ["fix: a", "fix: b"] } })).toBe("1.4.6");
  });

  it("bumps from an explicit subject alone, ignoring the commits since the tag", () => {
    const withFeat = { "v1.4.5": ["feat: on the base branch"] };
    expect(run({ tags: ["v1.4.5"], since: withFeat, explicit: "fix: PR title" })).toBe("1.4.6");
    expect(run({ tags: ["v1.4.5"], explicit: "feat: PR title" })).toBe("1.5.0");
  });

  it("keeps the tag's version when HEAD is already tagged", () => {
    const out = nextVersion({
      tags: ["v1.4.5"],
      subjectsSince: () => [],
      headSubject: () => "feat: the tagged commit",
    });
    expect(out.next).toEqual([1, 4, 5]);
    expect(out.count).toBe(0);
  });

  it("considers only the head subject when there is no prior tag, never the whole history", () => {
    let walked = false;
    const out = nextVersion({
      tags: [],
      subjectsSince: () => {
        walked = true;
        return ["feat!: ancient"];
      },
      headSubject: () => "fix: head",
    });
    expect(walked).toBe(false);
    expect(out.next).toEqual([1, 0, 1]);
    expect(run({ head: "feat: first" })).toBe("1.1.0");
  });

  it("treats non-conventional and merge subjects as patches", () => {
    const since = { "v1.4.5": ["Merge branch 'main' into x", "Update file"] };
    expect(run({ tags: ["v1.4.5"], since })).toBe("1.4.6");
  });
});

describe("CLI against a real repository", () => {
  /** @type {string[]} */
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // Drop every inherited GIT_* variable: under a git hook GIT_DIR points at the real repository,
  // and these commands must only ever touch the temporary one.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };

  function repo() {
    const dir = mkdtempSync(join(tmpdir(), "next-version-"));
    dirs.push(dir);
    const git = (...args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    const commit = (subject) => git("commit", "-q", "--allow-empty", "-m", subject);
    const cli = (...args) =>
      execFileSync("node", [SCRIPT, ...args], {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    return { git, commit, cli };
  }

  it("bumps the minor for a feat landed between the tag and HEAD", () => {
    const { git, commit, cli } = repo();
    commit("chore: init");
    git("tag", "v1.3.28");
    commit("feat(web): release that was skipped (#12)");
    commit("fix: follow-up");
    expect(cli()).toBe("1.4.0");
    expect(cli("fix: PR title")).toBe("1.3.29");
    expect(cli("--print-current")).toBe("1.3.28");
  });

  it("counts commits merged in through a merge commit", () => {
    const { git, commit, cli } = repo();
    commit("chore: init");
    git("tag", "v1.4.5");
    git("checkout", "-q", "-b", "topic");
    commit("feat: on the topic branch");
    git("checkout", "-q", "main");
    commit("fix: on main");
    git("merge", "-q", "--no-ff", "-m", "Merge branch 'topic'", "topic");
    expect(cli()).toBe("1.5.0");
  });

  it("keeps the version when HEAD is the tagged commit", () => {
    const { git, commit, cli } = repo();
    commit("feat: tagged release");
    git("tag", "v1.4.0");
    expect(cli()).toBe("1.4.0");
  });

  it("ignores higher tags that are not reachable from HEAD", () => {
    const { git, commit, cli } = repo();
    commit("chore: init");
    git("tag", "v1.0.4");
    git("checkout", "-q", "-b", "side");
    commit("fix: off main");
    git("tag", "v1.0.6");
    git("checkout", "-q", "main");
    commit("fix: on main");
    expect(cli()).toBe("1.0.5");
    expect(cli("--print-current")).toBe("1.0.4");
  });

  it("bumps from the major floor using only the head subject when no tag exists", () => {
    const { commit, cli } = repo();
    commit("feat!: breaking but untagged history");
    commit("fix: head");
    expect(cli()).toBe("1.0.1");
    expect(cli("--print-current")).toBe("1.0.0");
  });
});
