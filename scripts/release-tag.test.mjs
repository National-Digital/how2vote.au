import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  claimTag,
  gitRepo,
  inProgress,
  MAX_ATTEMPTS,
  POLL_MS,
  standing,
  tagMessage,
  waitForAncestors,
} from "./release-tag.mjs";
import { isSkipped, parseTagRecords, TAG_FORMAT, TRAILER } from "./store-release-scope.mjs";

const C = (n) => String(n).repeat(40);
const record = (tag, commit, message = `${tag}\n\n${TRAILER}: ship\n`) => ({
  tag,
  annotated: true,
  commit,
  message,
  version: tag.slice(1),
  parts: tag.slice(1).split(".").map(Number),
});

describe("tagMessage", () => {
  it("carries the trailer isSkipped reads", () => {
    expect(isSkipped(tagMessage("v1.4.12", false))).toBe(true);
    expect(isSkipped(tagMessage("v1.4.12", true))).toBe(false);
    expect(tagMessage("v1.4.12", true)).toBe(`v1.4.12\n\n${TRAILER}: ship\n`);
  });
});

describe("standing", () => {
  it("finds a tag on the commit, then one on a descendant", () => {
    expect(standing(C(1), [record("v1.4.13", C(2)), record("v1.4.12", C(1))])).toMatchObject({
      state: "tagged",
      record: { tag: "v1.4.12" },
    });
    expect(standing(C(1), [record("v1.4.12", C(2))]).state).toBe("superseded");
    const handMade = { ...record("v1.4.12", C(2)), annotated: false, message: "" };
    expect(standing(C(1), [handMade]).state).toBe("untagged");
    expect(standing(C(1), []).state).toBe("untagged");
  });
});

describe("inProgress", () => {
  it("is true for any run that has not completed", () => {
    expect(inProgress({ workflow_runs: [{ status: "in_progress" }] })).toBe(true);
    expect(inProgress({ workflow_runs: [{ status: "completed" }, { status: "queued" }] })).toBe(
      true,
    );
    expect(inProgress({ workflow_runs: [{ status: "completed" }] })).toBe(false);
    expect(inProgress({})).toBe(false);
  });
});

describe("against real repositories", () => {
  /** @type {string[]} */
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // Drop every inherited GIT_* variable: under a git hook GIT_DIR points at the real repository,
  // and these commands must only ever touch the temporary ones.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };

  /** A bare origin holding main at an annotated ship tag v1.4.11, and a clone to merge in. */
  function setup() {
    const root = mkdtempSync(join(tmpdir(), "release-tag-"));
    dirs.push(root);
    const run = (cwd, ...args) =>
      execFileSync("git", args, {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const origin = join(root, "origin.git");
    run(root, "init", "-q", "--bare", "-b", "main", origin);
    const work = join(root, "work");
    run(root, "clone", "-q", origin, work);
    const git = (...args) => run(work, ...args);
    /** Merges a commit touching `path` and pushes main; returns its sha. */
    const merge = (subject, path = "apps/web/src/x.ts") => {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), `${subject}\n`);
      git("add", "-A");
      git("commit", "-q", "-m", subject);
      git("push", "-q", "origin", "HEAD:main");
      return git("rev-parse", "HEAD");
    };
    merge("chore: init");
    git("tag", "-a", "v1.4.11", "-m", "v1.4.11", "-m", `${TRAILER}: ship`);
    git("push", "-q", "origin", "v1.4.11");
    /** A fresh runner checkout of `sha`, as the release job has. */
    const runner = (sha) => {
      const dir = mkdtempSync(join(root, "runner-"));
      run(root, "clone", "-q", origin, dir);
      run(dir, "checkout", "-q", "--detach", sha);
      return gitRepo({ cwd: dir, env, sha });
    };
    const tags = () =>
      Object.fromEntries(
        parseTagRecords(run(origin, "for-each-ref", `--format=${TAG_FORMAT}`, "refs/tags/v*")).map(
          (r) => [r.tag, { commit: r.commit, ship: !isSkipped(r.message) }],
        ),
      );
    return { root, origin, git, merge, runner, tags };
  }

  it("tags two merges in order with their own versions and decisions", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix(metadata): canonical URL (#79)", "docs/notes.md");
    const b = merge("chore(web): remove tools (#68)");
    expect(claimTag(runner(a), { sha: a })).toMatchObject({
      action: "created",
      tag: "v1.4.12",
      ship: false,
      base: "v1.4.11",
    });
    expect(claimTag(runner(b), { sha: b })).toMatchObject({
      action: "created",
      tag: "v1.4.13",
      ship: true,
      base: "v1.4.11", // v1.4.12 skipped, so the base stays at the last release that shipped
    });
    expect(tags()).toEqual({
      "v1.4.11": expect.anything(),
      "v1.4.12": { commit: a, ship: false },
      "v1.4.13": { commit: b, ship: true },
    });
  });

  it("compares against an earlier merge's ship tag, not the one the deploy job saw", () => {
    const { merge, runner } = setup();
    const a = merge("fix: app change (#1)", "apps/web/src/a.ts");
    const b = merge("docs: readme (#2)", "README.md");
    expect(claimTag(runner(a), { sha: a })).toMatchObject({ tag: "v1.4.12", ship: true });
    expect(claimTag(runner(b), { sha: b })).toMatchObject({
      tag: "v1.4.13",
      ship: false,
      base: "v1.4.12",
    });
  });

  it("retries with the next version when a concurrent run takes the version first", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix: first (#1)");
    const b = merge("fix: second (#2)");
    const repo = runner(b);
    // B read the tags before A pushed v1.4.12; A's push lands between B's read and B's push.
    let raced = false;
    const racing = {
      ...repo,
      pushTag: (tag, message) => {
        if (!raced) {
          raced = true;
          expect(tag).toBe("v1.4.12");
          expect(claimTag(runner(a), { sha: a }).tag).toBe("v1.4.12");
        }
        return repo.pushTag(tag, message);
      },
    };
    const lines = [];
    expect(claimTag(racing, { sha: b, log: (l) => lines.push(l) })).toMatchObject({
      action: "created",
      tag: "v1.4.13",
    });
    expect(lines.join("\n")).toContain("v1.4.12 was taken by a concurrent release");
    expect(tags()["v1.4.12"].commit).toBe(a);
    expect(tags()["v1.4.13"].commit).toBe(b);
  });

  it("gives three racing merges three versions in merge order", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    const b = merge("feat: two (#2)");
    const c = merge("fix: three (#3)");
    /** Lets `first` push before `repo` pushes, once. */
    const behind = (repo, first) => {
      let done = false;
      return {
        ...repo,
        pushTag: (tag, message) => {
          if (!done) {
            done = true;
            first();
          }
          return repo.pushTag(tag, message);
        },
      };
    };
    const claimA = () => claimTag(runner(a), { sha: a });
    const claimB = () => claimTag(behind(runner(b), claimA), { sha: b });
    expect(claimTag(behind(runner(c), claimB), { sha: c }).tag).toBe("v1.5.1");
    expect(tags()).toMatchObject({
      "v1.4.12": { commit: a },
      "v1.5.0": { commit: b },
      "v1.5.1": { commit: c },
    });
  });

  it("keeps the tag a re-run finds on its commit and mints no second one", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    expect(claimTag(runner(a), { sha: a }).action).toBe("created");
    expect(claimTag(runner(a), { sha: a })).toEqual({
      action: "existing",
      tag: "v1.4.12",
      ship: true,
    });
    expect(Object.keys(tags())).toEqual(["v1.4.12", "v1.4.11"]);
  });

  it("tags nothing for a commit a later release already contains", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    const b = merge("fix: two (#2)");
    expect(claimTag(runner(b), { sha: b })).toMatchObject({ tag: "v1.4.12", ship: true });
    expect(claimTag(runner(a), { sha: a })).toEqual({ action: "superseded", tag: "v1.4.12" });
    expect(Object.keys(tags())).toEqual(["v1.4.12", "v1.4.11"]);
  });

  it("dispatches no store build for a tag pushed after a later ship release", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    const b = merge("feat: two (#2)");
    const repo = runner(a);
    // A read v1.4.11 and chose v1.4.12; B tags v1.5.0 before A's push, which does not clash.
    let raced = false;
    const racing = {
      ...repo,
      pushTag: (tag, message) => {
        if (!raced) {
          raced = true;
          expect(claimTag(runner(b), { sha: b }).tag).toBe("v1.5.0");
        }
        return repo.pushTag(tag, message);
      },
    };
    expect(claimTag(racing, { sha: a })).toMatchObject({
      action: "created",
      tag: "v1.4.12",
      shippedBy: "v1.5.0",
    });
    expect(tags()["v1.4.12"].commit).toBe(a);
  });

  it("treats a push reported as failed that landed as its own tag", () => {
    const { merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    const repo = runner(a);
    // The tag reaches the remote but the client sees an error: here a second copy of the push.
    const flaky = {
      ...repo,
      pushTag: (tag, message) => {
        expect(runner(a).pushTag(tag, message)).toBe(true);
        return repo.pushTag(tag, message);
      },
    };
    expect(claimTag(flaky, { sha: a })).toMatchObject({ action: "created", tag: "v1.4.12" });
    expect(tags()["v1.4.12"].commit).toBe(a);
  });

  it("is not superseded by a hand-made lightweight tag, and refuses its version", () => {
    const { git, merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    const b = merge("fix: two (#2)");
    git("tag", "v1.4.12", b);
    git("push", "-q", "origin", "v1.4.12");
    expect(() => claimTag(runner(a), { sha: a })).toThrow(/deleted or renamed/);
    expect(tags()["v1.4.12"].commit).toBe(b);
  });

  it("fails when a later skip release holds back this commit's app changes", () => {
    const { merge, runner } = setup();
    const a = merge("fix: app change (#1)");
    const b = merge("docs: two (#2)", "docs/x.md");
    expect(claimTag(runner(b), { sha: b, prText: "docs: two\n\n[skip-apps]" })).toMatchObject({
      tag: "v1.4.12",
      ship: false,
    });
    expect(() => claimTag(runner(a), { sha: a })).toThrow(
      /merge a follow-up carrying \[ship-apps\]/,
    );
  });

  it("refuses a version already tagged off main and never moves that tag", () => {
    const { git, merge, runner, tags } = setup();
    git("commit", "-q", "--allow-empty", "-m", "fix: off main");
    const side = git("rev-parse", "HEAD");
    git("tag", "v1.4.12", side);
    git("push", "-q", "origin", "v1.4.12");
    git("reset", "-q", "--hard", "v1.4.11");
    const a = merge("fix: on main (#1)");
    expect(() => claimTag(runner(a), { sha: a })).toThrow(/v1\.4\.12 already exists at/);
    expect(tags()["v1.4.12"].commit).toBe(side);
  });

  it("rethrows a push that fails for any reason but a taken tag", () => {
    const { origin, merge, runner, tags } = setup();
    const a = merge("fix: one (#1)");
    const hook = join(origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    expect(() => claimTag(runner(a), { sha: a })).toThrow();
    expect(tags()["v1.4.12"]).toBeUndefined();
  });

  it("gives up after a bounded number of lost races", () => {
    const { merge, runner } = setup();
    const a = merge("fix: one (#1)");
    const repo = runner(a);
    let pushes = 0;
    const losing = { ...repo, pushTag: () => (pushes++, false) };
    expect(() => claimTag(losing, { sha: a })).toThrow(/in 5 attempts/);
    expect(pushes).toBe(MAX_ATTEMPTS);
  });

  describe("waitForAncestors", () => {
    const io = (running, start = 0) => {
      let t = start;
      const log = [];
      return {
        log,
        slept: () => t,
        io: {
          running,
          sleep: async (ms) => {
            t += ms;
          },
          now: () => t,
          log: (l) => log.push(l),
        },
      };
    };

    it("waits while an untagged ancestor deploys, until that ancestor tags", async () => {
      const { merge, runner } = setup();
      const a = merge("fix: one (#1)");
      const b = merge("fix: two (#2)");
      let polls = 0;
      const { io: opts, slept } = io(async (sha) => {
        expect(sha).toBe(a);
        if (++polls === 2) claimTag(runner(a), { sha: a });
        return true;
      });
      expect(await waitForAncestors(runner(b), { sha: b, ...opts })).toBe(true);
      expect(slept()).toBe(2 * POLL_MS);
      expect(claimTag(runner(b), { sha: b }).tag).toBe("v1.4.13");
    });

    it("does not wait when no earlier deploy is running", async () => {
      const { merge, runner } = setup();
      merge("fix: one (#1)");
      const b = merge("fix: two (#2)");
      const { io: opts, slept } = io(async () => false);
      expect(await waitForAncestors(runner(b), { sha: b, ...opts })).toBe(false);
      expect(slept()).toBe(0);
    });

    it("stops at the limit, and treats an unreadable run as finished", async () => {
      const { merge, runner } = setup();
      merge("fix: one (#1)");
      const b = merge("fix: two (#2)");
      const { io: forever, slept, log } = io(async () => true);
      const limitMs = 3 * POLL_MS;
      expect(await waitForAncestors(runner(b), { sha: b, ...forever, limitMs })).toBe(true);
      expect(slept()).toBe(limitMs);
      expect(log.at(-1)).toMatch(/stopped waiting/);
      const { io: broken, log: log2 } = io(async () => {
        throw new Error("HTTP 502");
      });
      // Not knowing counts as having waited, so the release job redeploys main.
      expect(await waitForAncestors(runner(b), { sha: b, ...broken })).toBe(true);
      expect(log2[0]).toMatch(/HTTP 502/);
    });

    it("returns at once when the commit is already tagged", async () => {
      const { merge, runner } = setup();
      const a = merge("fix: one (#1)");
      const b = merge("fix: two (#2)");
      claimTag(runner(b), { sha: b });
      const { io: opts } = io(async () => {
        throw new Error("no lookup expected");
      });
      expect(await waitForAncestors(runner(a), { sha: a, ...opts })).toBe(false);
    });
  });
});
