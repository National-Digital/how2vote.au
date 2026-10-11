import { describe, expect, it } from "vitest";
import {
  bumpCounter,
  findIssue,
  issueTitle,
  LABEL,
  olderIssues,
  openIssues,
  outcomeOf,
  parseResults,
  plan,
  QUIET_MS,
  recentlyAlerted,
  report,
} from "./store-release-alert.mjs";

const RUN = "https://github.com/o/r/actions/runs/1/attempts/1";
const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const LIST = `/issues?state=open&labels=${LABEL}&per_page=100&page=1`;

/** A fake GitHub API recording every call. */
function fakeApi({ issues = [], comments = [], labelStatus = 201 } = {}) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path.startsWith("/issues?"))
      return path.endsWith("page=1") ? issues : [];
    if (method === "GET") return comments;
    if (path === "/labels" && labelStatus !== 201) {
      const error = new Error(`label ${labelStatus}`);
      error.status = labelStatus;
      throw error;
    }
    return {};
  };
  return { api, calls };
}

const base = { terminal: "submit", resolves: true, runUrl: RUN, now: NOW };

describe("issueTitle", () => {
  it("names the release when the tag is valid", () => {
    expect(issueTitle({ name: "Android release", tag: "v1.5.0" })).toBe(
      "Android release v1.5.0 failed",
    );
    expect(issueTitle({ name: "  iOS   release ", tag: " v1.5.0\n" })).toBe(
      "iOS release v1.5.0 failed",
    );
  });

  it("falls back to the untagged name for a missing or malformed tag", () => {
    for (const tag of ["", "v1.5", "1.5.0", "v1.5.0-rc1", "v01.5.0", "v1.5.0 x", "$(id)"]) {
      expect(
        issueTitle({ name: "iOS release", tag, untaggedName: "iOS submission catch-up" }),
        tag,
      ).toBe("iOS submission catch-up failed");
      expect(issueTitle({ name: "Android release", tag }), tag).toBe("Android release failed");
    }
  });

  it("refuses an empty name", () => {
    expect(() => issueTitle({ name: "  " })).toThrow(/NAME/);
  });
});

describe("parseResults", () => {
  it("reads toJSON(needs) and plain maps", () => {
    const needs = JSON.stringify({
      build: { result: "success", outputs: { commit: "abc" } },
      promote: { result: "failure", outputs: {} },
    });
    expect(parseResults(needs)).toEqual({ build: "success", promote: "failure" });
    expect(parseResults('{"release":"failure"}')).toEqual({ release: "failure" });
  });

  it("fails closed on anything else", () => {
    expect(() => parseResults("")).toThrow(/not JSON/);
    expect(() => parseResults("[]")).toThrow(/object/);
    expect(() => parseResults("null")).toThrow(/object/);
    expect(() => parseResults("{}")).toThrow(/names no job/);
    expect(() => parseResults('{"build":{}}')).toThrow(/no result for build/);
  });
});

describe("outcomeOf", () => {
  it("is a failure when any job failed, never for a cancelled job", () => {
    expect(
      outcomeOf({
        results: { build: "success", fdroid: "failure", promote: "cancelled" },
        terminal: "promote",
        resolves: true,
      }),
    ).toEqual({ outcome: "failure", failed: [{ job: "fdroid", result: "failure" }] });
  });

  it("resolves only when the terminal job succeeded", () => {
    const run = (results, resolves = true) =>
      outcomeOf({ results, terminal: "promote", resolves }).outcome;
    expect(run({ build: "success", promote: "success" })).toBe("success");
    expect(run({ build: "success", promote: "success" }, false)).toBe("none");
    expect(run({ build: "success", promote: "cancelled" })).toBe("none");
    expect(run({ build: "skipped", promote: "skipped" })).toBe("none");
    expect(run({ build: "success" })).toBe("none");
    expect(outcomeOf({ results: { a: "success" }, terminal: "", resolves: true }).outcome).toBe(
      "none",
    );
  });
});

describe("findIssue and olderIssues", () => {
  const issues = [
    { number: 1, title: "Android release v1.5.0 failed", pull_request: {} },
    { number: 2, title: "Android release v1.5.00 failed" },
    { number: 3, title: "Android release v1.5.0 failed" },
    { number: 4, title: "Android release v1.4.9 failed" },
    { number: 5, title: "Android release v1.10.0 failed" },
    { number: 6, title: "iOS release v1.4.0 failed" },
    { number: 7, title: "Android release failed" },
  ];

  it("matches the exact title and never a pull request", () => {
    expect(findIssue(issues, "Android release v1.5.0 failed")?.number).toBe(3);
    expect(findIssue(issues, "iOS release v1.5.0 failed")).toBeNull();
  });

  it("finds older releases of the same name, compared numerically", () => {
    expect(olderIssues(issues, "Android release", "v1.5.0").map((i) => i.number)).toEqual([4]);
    expect(olderIssues(issues, "Android release", "v1.10.1").map((i) => i.number)).toEqual([
      3, 4, 5,
    ]);
    expect(olderIssues(issues, "Android release", "")).toEqual([]);
  });
});

describe("bumpCounter and recentlyAlerted", () => {
  it("adds, then increments, one counter line", () => {
    const once = bumpCounter("Run: a", "https://r/2");
    expect(once).toBe("Run: a\n\nRepeat failures: 1, latest https://r/2");
    expect(bumpCounter(once, "https://r/3")).toBe(
      "Run: a\n\nRepeat failures: 2, latest https://r/3",
    );
    expect(bumpCounter(null, "u")).toContain("Repeat failures: 1, latest u");
  });

  it("is recent when the issue or the last repeat comment is inside the window", () => {
    const old = { number: 1, title: "t", created_at: ago(2 * QUIET_MS) };
    expect(recentlyAlerted({ ...old, created_at: ago(1000) }, [], NOW)).toBe(true);
    expect(recentlyAlerted(old, [], NOW)).toBe(false);
    expect(
      recentlyAlerted(old, [{ body: "Failed again.\n\nRun", created_at: ago(1000) }], NOW),
    ).toBe(true);
    expect(recentlyAlerted(old, [{ body: "a person's note", created_at: ago(1000) }], NOW)).toBe(
      false,
    );
    expect(
      recentlyAlerted(old, [{ body: "Failed again.", created_at: ago(QUIET_MS + 1) }], NOW),
    ).toBe(false);
  });
});

describe("plan", () => {
  const failed = [{ job: "promote", result: "failure" }];
  const title = "Android release v1.5.0 failed";
  const existing = { number: 7, title, body: "Run: x" };

  it("opens an issue on a first failure, naming the run and the jobs", () => {
    const [action, ...rest] = plan({
      outcome: "failure",
      title,
      existing: null,
      runUrl: RUN,
      failed,
    });
    expect(rest).toEqual([]);
    expect(action).toMatchObject({ type: "create", title });
    expect(action.body).toContain(RUN);
    expect(action.body).toContain("- `promote`: failure");
  });

  it("comments on a repeat failure, or counts it inside the quiet window", () => {
    expect(plan({ outcome: "failure", title, existing, runUrl: RUN, failed })).toEqual([
      { type: "comment", number: 7, body: expect.stringContaining(RUN) },
    ]);
    expect(
      plan({ outcome: "failure", title, existing, recent: true, runUrl: RUN, failed }),
    ).toEqual([{ type: "edit", number: 7, body: `Run: x\n\nRepeat failures: 1, latest ${RUN}` }]);
  });

  it("closes the issue and the older releases' issues on success", () => {
    const older = [{ number: 4, title: "Android release v1.4.9 failed" }];
    expect(plan({ outcome: "success", title, existing, older, runUrl: RUN, failed: [] })).toEqual([
      { type: "close", number: 7, body: expect.stringContaining(RUN) },
      { type: "close", number: 4, body: expect.stringContaining("Superseded") },
    ]);
    expect(plan({ outcome: "success", title, existing: null, runUrl: RUN, failed: [] })).toEqual(
      [],
    );
  });

  it("clears the untagged issue unless this failure is that issue", () => {
    const untagged = { number: 9, title: "iOS submission catch-up failed" };
    expect(
      plan({ outcome: "none", title, existing: null, untagged, runUrl: RUN, failed: [] }),
    ).toEqual([{ type: "close", number: 9, body: expect.any(String) }]);
    const own = plan({
      outcome: "failure",
      title: untagged.title,
      existing: untagged,
      untagged,
      runUrl: RUN,
      failed,
    });
    expect(own.map((a) => a.type)).toEqual(["comment"]);
  });

  it("does nothing for none", () => {
    expect(plan({ outcome: "none", title, existing, runUrl: RUN, failed: [] })).toEqual([]);
  });
});

describe("openIssues", () => {
  it("reads every page", async () => {
    const page = (n, count) =>
      Array.from({ length: count }, (_, i) => ({ number: n * 1000 + i, title: `t${n}-${i}` }));
    const paths = [];
    const api = async (_m, path) => {
      paths.push(path);
      const n = Number(/&page=(\d+)/.exec(path)[1]);
      return n < 3 ? page(n, 100) : page(n, 7);
    };
    expect(await openIssues(api)).toHaveLength(207);
    expect(paths).toHaveLength(3);
  });
});

describe("report", () => {
  const ios = { ...base, name: "iOS release", tag: "v1.5.0" };

  it("creates the label and the issue on a first failure", async () => {
    const { api, calls } = fakeApi();
    const r = await report({ ...ios, api, results: { submit: "failure" } });
    expect(r.outcome).toBe("failure");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${LIST}`,
      "POST /labels",
      "POST /issues",
    ]);
    expect(calls[2].body).toMatchObject({ title: "iOS release v1.5.0 failed", labels: [LABEL] });
  });

  it("tolerates a label that already exists, and nothing else", async () => {
    const ok = fakeApi({ labelStatus: 422 });
    await report({ ...ios, api: ok.api, results: { submit: "failure" } });
    expect(ok.calls.at(-1).path).toBe("/issues");
    const denied = fakeApi({ labelStatus: 403 });
    await expect(
      report({ ...ios, api: denied.api, results: { submit: "failure" } }),
    ).rejects.toThrow(/label 403/);
    expect(denied.calls.some((c) => c.path === "/issues")).toBe(false);
  });

  it("comments on a repeat failure a day on, and counts one inside the day", async () => {
    const issue = { number: 9, title: "iOS release v1.5.0 failed", created_at: ago(2 * QUIET_MS) };
    const later = fakeApi({ issues: [issue] });
    await report({ ...ios, api: later.api, results: { build: "failure" } });
    expect(later.calls.slice(2).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /issues/9/comments",
    ]);
    expect(later.calls[1].path).toMatch(/^\/issues\/9\/comments\?since=/);

    const soon = fakeApi({
      issues: [issue],
      comments: [{ body: "Failed again.\n\nRun: y", created_at: ago(60_000) }],
    });
    await report({ ...ios, api: soon.api, results: { build: "failure" } });
    expect(soon.calls.at(-1)).toMatchObject({ method: "PATCH", path: "/issues/9" });
    expect(soon.calls.at(-1).body.body).toContain("Repeat failures: 1");
  });

  it("closes the issue and older releases' issues on a later success", async () => {
    const { api, calls } = fakeApi({
      issues: [
        { number: 9, title: "iOS release v1.5.0 failed" },
        { number: 8, title: "iOS release v1.4.9 failed" },
        { number: 7, title: "iOS release v1.5.1 failed" },
        { number: 6, title: "Android release v1.4.0 failed" },
      ],
    });
    const r = await report({ ...ios, api, results: { build: "success", submit: "success" } });
    expect(r.outcome).toBe("success");
    expect(calls.slice(1).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /issues/9/comments",
      "PATCH /issues/9",
      "POST /issues/8/comments",
      "PATCH /issues/8",
    ]);
  });

  it("makes no call for a cancelled or skipped terminal job", async () => {
    for (const submit of ["cancelled", "skipped"]) {
      const { api, calls } = fakeApi({
        issues: [{ number: 9, title: "iOS release v1.5.0 failed" }],
      });
      const r = await report({ ...ios, api, results: { build: "success", submit } });
      expect(r, submit).toEqual({ outcome: "none", actions: [] });
      expect(calls, submit).toEqual([]);
    }
  });

  it("never closes on a run that does not resolve", async () => {
    const { api, calls } = fakeApi({
      issues: [{ number: 9, title: "Store dispatch v1.5.0 failed" }],
    });
    await report({
      ...base,
      api,
      name: "Store dispatch",
      tag: "v1.5.0",
      terminal: "release",
      resolves: false,
      results: { release: "success" },
    });
    expect(calls).toEqual([]);
  });

  it("clears the untagged catch-up issue on a run that got past it", async () => {
    const { api, calls } = fakeApi({
      issues: [{ number: 5, title: "iOS submission catch-up failed" }],
    });
    await report({
      ...base,
      api,
      name: "iOS release",
      tag: "",
      untaggedName: "iOS submission catch-up",
      clearUntagged: true,
      results: { find: "success", check: "success", submit: "skipped" },
    });
    expect(calls.slice(1).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /issues/5/comments",
      "PATCH /issues/5",
    ]);
  });
});
