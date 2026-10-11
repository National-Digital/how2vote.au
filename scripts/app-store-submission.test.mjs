import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  ascToken,
  compareVersions,
  createClient,
  decide,
  checkCatchUp,
  isPermanent,
  itemKinds,
  latestBuild,
  owed,
  parseCandidates,
  parseReleases,
  pickCandidate,
  prepare,
  readState,
  SETTLE_READS,
  versionState,
} from "./app-store-submission.mjs";

const target = { version: "1.5.1", build: "105001007" };
const v = (version, state, build = null, id = `v-${version}`) => ({ id, version, state, build });
const s = (state, versionId, items = 1, id = `s-${state}`) => ({
  id,
  state,
  versionId,
  itemIds: Array.from({ length: items }, (_, i) => `item-${i}`),
});
const live = v("1.4.9", "READY_FOR_DISTRIBUTION", "104009001", "live");
const run = (versions, submissions = []) => decide({ target, versions, submissions });

describe("compareVersions", () => {
  it("orders by major, minor, then patch numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.4.10", "1.4.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.999")).toBeGreaterThan(0);
    expect(compareVersions("1.4.1", "1.4.1")).toBe(0);
    expect(compareVersions("1.4.1", "1.5.0")).toBeLessThan(0);
  });
});

describe("decide", () => {
  it("submits when nothing is open", () => {
    expect(run([]).action).toBe("submit");
    expect(run([live]).action).toBe("submit");
  });

  it("submits into an editable version, whatever its version string", () => {
    for (const state of [
      "PREPARE_FOR_SUBMISSION",
      "DEVELOPER_REJECTED",
      "REJECTED",
      "METADATA_REJECTED",
      "INVALID_BINARY",
    ]) {
      expect(run([live, v("1.5.0", state, "105000009")]).action, state).toBe("submit");
      expect(run([live, v("1.5.1", state, "105001002")]).action, state).toBe("submit");
    }
  });

  it("ignores versions replaced by a newer one", () => {
    expect(run([v("1.4.0", "REPLACED_WITH_NEW_VERSION", "104000001"), live]).action).toBe("submit");
  });

  it("ignores an empty draft submission, which deliver reuses", () => {
    expect(run([live], [s("READY_FOR_REVIEW", null, 0)]).action).toBe("submit");
  });

  it("cancels an older version waiting for review", () => {
    const old = v("1.5.0", "WAITING_FOR_REVIEW", "105000004");
    const d = run(
      [v("1.4.9", "READY_FOR_DISTRIBUTION", "104009001"), old],
      [s("WAITING_FOR_REVIEW", old.id, 1, "sub-1")],
    );
    expect(d).toMatchObject({ action: "cancel", submissionId: "sub-1" });
    expect(d.reason).toContain("1.5.0 (105000004) is waiting for review");
  });

  it("empties an unsent draft submission holding items, rather than cancelling it", () => {
    const old = v("1.5.0", "READY_FOR_REVIEW", "105000004");
    expect(run([live, old], [s("READY_FOR_REVIEW", old.id, 2, "draft")])).toMatchObject({
      action: "clear",
      submissionId: "draft",
      itemIds: ["item-0", "item-1"],
    });
  });

  it("skips when a processed build of a newer release exists", () => {
    const d = decide({
      target,
      versions: [live],
      submissions: [],
      releases: new Set(["1.5.1", "1.5.2", "1.6.0"]),
      builds: [
        { version: "1.5.1", build: target.build },
        { version: "1.5.2", build: "105002001" },
        { version: "1.6.0", build: "106000002" },
      ],
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("1.6.0 (106000002)");
  });

  it("warns about, and ignores, a newer build whose version is not a release", () => {
    const d = decide({
      target,
      versions: [live],
      submissions: [],
      releases: new Set(["1.5.1"]),
      builds: [
        { version: "9.9.9", build: "999000001" },
        { version: "9.9.9", build: "999000001" },
      ],
    });
    expect(d.action).toBe("submit");
    expect(d.warnings).toEqual([
      "build 999000001 of 9.9.9 is processed but 9.9.9 is not a release",
    ]);
    expect(
      decide({
        target,
        versions: [live],
        submissions: [],
        builds: [{ version: "1.6.0", build: "1" }],
      }).action,
    ).toBe("submit");
  });

  it("skips when a later build of the same version is processed, compared numerically", () => {
    const d = decide({
      target: { version: "1.5.1", build: "99" },
      versions: [live],
      submissions: [],
      builds: [
        { version: "1.5.1", build: "100" },
        { version: "1.5.1", build: "98" },
      ],
    });
    expect(d.action).toBe("skip");
    expect(d.reason).toContain("a later build of 1.5.1 is processed: 1.5.1 (100)");
    expect(
      decide({
        target: { version: "1.5.1", build: "100" },
        versions: [live],
        submissions: [],
        builds: [{ version: "1.5.1", build: "99" }],
      }).action,
    ).toBe("submit");
  });

  it("ignores processed builds of this version or older ones", () => {
    const builds = [
      { version: "1.5.1", build: "105001001" },
      { version: "1.4.9", build: "104009001" },
    ];
    expect(decide({ target, versions: [live], submissions: [], builds }).action).toBe("submit");
  });

  it("replaces a waiting build of the same version with this one", () => {
    const old = v("1.5.1", "WAITING_FOR_REVIEW", "105001002");
    expect(run([live, old], [s("WAITING_FOR_REVIEW", old.id)]).action).toBe("cancel");
  });

  it("waits while a cancellation settles", () => {
    const old = v("1.5.0", "WAITING_FOR_REVIEW", "105000004");
    expect(run([live, old], [s("CANCELING", old.id)]).action).toBe("wait");
  });

  it("waits when a version is queued but its submission is not yet visible", () => {
    expect(run([live, v("1.5.0", "WAITING_FOR_REVIEW", "105000004")]).action).toBe("wait");
  });

  it("defers, never cancels, while an older version is in review", () => {
    const old = v("1.5.0", "IN_REVIEW", "105000004");
    const d = run([v("1.4.9", "READY_FOR_DISTRIBUTION"), old], [s("IN_REVIEW", old.id)]);
    expect(d.action).toBe("defer");
    expect(d.reason).toBe("1.5.0 (105000004) is in review");
    expect(run([live, v("1.5.1", "IN_REVIEW", "105001002")]).action).toBe("defer");
  });

  it("defers while an older version is approved and not yet released", () => {
    for (const state of [
      "PENDING_DEVELOPER_RELEASE",
      "PENDING_APPLE_RELEASE",
      "PROCESSING_FOR_DISTRIBUTION",
      "ACCEPTED",
    ]) {
      const d = run([v("1.4.9", "READY_FOR_DISTRIBUTION"), v("1.5.0", state, "105000004")]);
      expect(d.action, state).toBe("defer");
      expect(d.reason, state).toContain("approved and not yet released");
    }
  });

  it("fails on a rejection, before anything else is considered", () => {
    const old = v("1.5.0", "REJECTED", "105000004");
    const d = run([live, old], [s("UNRESOLVED_ISSUES", old.id)]);
    expect(d.action).toBe("fail");
    expect(d.reason).toContain("1.5.0 (105000004)");
    expect(d.reason).toContain("unresolved issues");
    expect(run([live], [s("UNRESOLVED_ISSUES", null)]).reason).toContain("an unidentified version");
  });

  it("fails closed on a state it does not know", () => {
    expect(run([live, v("1.5.0", "WAITING_FOR_EXPORT_COMPLIANCE", "1")]).action).toBe("fail");
    expect(run([live, v("1.5.0", "SOMETHING_NEW", "1")]).reason).toContain("SOMETHING_NEW");
  });

  it("skips a build that is already submitted, in any state past submission", () => {
    for (const state of [
      "WAITING_FOR_REVIEW",
      "IN_REVIEW",
      "ACCEPTED",
      "PENDING_DEVELOPER_RELEASE",
      "PENDING_APPLE_RELEASE",
      "PROCESSING_FOR_DISTRIBUTION",
      "READY_FOR_DISTRIBUTION",
    ]) {
      const mine = v("1.5.1", state, target.build);
      const d = run([live, mine], [s("WAITING_FOR_REVIEW", mine.id)]);
      expect(d.action, state).toBe("skip");
      expect(d.reason, state).toContain("already submitted");
    }
  });

  it("skips when a newer version exists, in any state", () => {
    for (const state of [
      "PREPARE_FOR_SUBMISSION",
      "WAITING_FOR_REVIEW",
      "READY_FOR_DISTRIBUTION",
    ]) {
      const d = run([live, v("1.6.0", state, "106000001")]);
      expect(d.action, state).toBe("skip");
      expect(d.reason, state).toContain("1.6.0 (106000001)");
    }
  });

  it("names the newest of several newer versions", () => {
    expect(
      run([v("1.5.2", "DEVELOPER_REJECTED"), v("1.10.0", "PREPARE_FOR_SUBMISSION")]).reason,
    ).toContain("1.10.0");
  });

  it("skips a version already approved under another build", () => {
    for (const state of ["PENDING_DEVELOPER_RELEASE", "READY_FOR_DISTRIBUTION"]) {
      const d = run([v("1.5.1", state, "105001002")]);
      expect(d.action, state).toBe("skip");
      expect(d.reason, state).toContain("a new build needs a new version");
    }
  });

  it("ranks a rejection above an older version still in review", () => {
    const d = run(
      [live, v("1.5.0", "IN_REVIEW", "1")],
      [s("UNRESOLVED_ISSUES", "v-1.5.0"), s("IN_REVIEW", "v-1.5.0")],
    );
    expect(d.action).toBe("fail");
  });

  it("ranks review and pending release above a queued submission", () => {
    const queued = s("WAITING_FOR_REVIEW", "v-1.5.0");
    expect(
      run([live, v("1.5.0", "IN_REVIEW", "1")], [queued, s("IN_REVIEW", "v-1.5.0")]).action,
    ).toBe("defer");
    expect(run([v("1.5.0", "PENDING_DEVELOPER_RELEASE", "1")], [queued]).action).toBe("defer");
  });
});

/** A fake App Store Connect: handlers by "METHOD path"; builds default to none. */
function fakeApi(pages) {
  const calls = [];
  const sleeps = [];
  const handlers = { "GET /v1/builds": () => [200, { data: [] }], ...pages };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", url: u, body: init.body && JSON.parse(init.body) });
    const handler =
      handlers[`${init.method ?? "GET"} ${u.pathname}`] ??
      (/^\/v1\/reviewSubmissions\/[^/]+\/items$/.test(u.pathname) ? versionItems : undefined);
    const [status, body] = handler ? handler(u, calls) : [404, { errors: [{ detail: "nope" }] }];
    const text = typeof body === "string" ? body : body ? JSON.stringify(body) : "";
    return { ok: status < 300, status, text: async () => text };
  };
  const api = createClient({ fetchImpl, token: () => "t", sleep: async (ms) => sleeps.push(ms) });
  return { calls, sleeps, api };
}

const versionsPayload = (...list) => ({
  data: list.map(([id, versionString, appVersionState, buildId]) => ({
    type: "appStoreVersions",
    id,
    attributes: { versionString, appVersionState },
    relationships: { build: { data: buildId ? { type: "builds", id: buildId } : null } },
  })),
  included: list
    .filter(([, , , buildId]) => buildId)
    .map(([, , , buildId, number]) => ({
      type: "builds",
      id: buildId,
      attributes: { version: number },
    })),
});
const submission = (id, state, versionId, items = 1) => ({
  type: "reviewSubmissions",
  id,
  attributes: { state },
  relationships: {
    appStoreVersionForReview: {
      data: versionId ? { type: "appStoreVersions", id: versionId } : null,
    },
    items: {
      data: Array.from({ length: items }, (_, i) => ({
        type: "reviewSubmissionItems",
        id: `i${i}`,
      })),
    },
  },
});
const submissionsPayload = (...list) => ({ data: list.map((args) => submission(...args)) });
const single = (id, state) => () => [200, { data: submission(id, state, null) }];
function versionItems() {
  return [
    200,
    {
      data: [
        {
          type: "reviewSubmissionItems",
          id: "i0",
          relationships: { appStoreVersion: { data: { id: "old" } } },
        },
      ],
    },
  ];
}

describe("versionState", () => {
  it("prefers appVersionState", () => {
    expect(
      versionState({ appVersionState: "IN_REVIEW", appStoreState: "WAITING_FOR_REVIEW" }),
    ).toBe("IN_REVIEW");
  });

  it("maps the deprecated appStoreState names", () => {
    expect(versionState({ appStoreState: "READY_FOR_SALE" })).toBe("READY_FOR_DISTRIBUTION");
    expect(versionState({ appStoreState: "PROCESSING_FOR_APP_STORE" })).toBe(
      "PROCESSING_FOR_DISTRIBUTION",
    );
    expect(versionState({ appStoreState: "WAITING_FOR_REVIEW" })).toBe("WAITING_FOR_REVIEW");
  });

  it("is null when neither field is present", () => {
    expect(versionState({})).toBeNull();
    expect(versionState(undefined)).toBeNull();
  });

  it("treats a version removed from sale as settled", () => {
    expect(
      run([v("1.4.0", "DEVELOPER_REMOVED_FROM_SALE"), v("1.4.1", "REMOVED_FROM_SALE")]).action,
    ).toBe("submit");
  });
});

describe("readState", () => {
  it("normalises versions, open submissions and processed builds", async () => {
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(
          ["a", "1.5.0", "WAITING_FOR_REVIEW", "b1", "105000004"],
          ["c", "1.4.9", "READY_FOR_DISTRIBUTION"],
        ),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["s1", "WAITING_FOR_REVIEW", "a", 2]),
      ],
      "GET /v1/builds": () => [
        200,
        {
          data: [
            {
              attributes: { version: "105001003" },
              relationships: { preReleaseVersion: { data: { id: "p1" } } },
            },
            {
              attributes: { version: "junk" },
              relationships: { preReleaseVersion: { data: { id: "p1" } } },
            },
          ],
          included: [{ type: "preReleaseVersions", id: "p1", attributes: { version: "1.5.1" } }],
        },
      ],
    });
    await expect(readState(api, "app1")).resolves.toEqual({
      versions: [
        { id: "a", version: "1.5.0", state: "WAITING_FOR_REVIEW", build: "105000004" },
        { id: "c", version: "1.4.9", state: "READY_FOR_DISTRIBUTION", build: null },
      ],
      submissions: [
        { id: "s1", state: "WAITING_FOR_REVIEW", versionId: "a", itemIds: ["i0", "i1"] },
      ],
      builds: [{ version: "1.5.1", build: "105001003" }],
    });
    const subs = calls.find((c) => c.url.pathname.endsWith("/reviewSubmissions")).url;
    expect(subs.searchParams.get("filter[state]")).toBe(
      "READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,CANCELING",
    );
    expect(subs.searchParams.get("filter[platform]")).toBe("IOS");
    expect(subs.searchParams.get("include")).toBe("items,appStoreVersionForReview");
  });

  it("leaves out a version with no state, and reads the deprecated field", async () => {
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        {
          data: [
            { id: "a", attributes: { versionString: "1.5.0" } },
            { id: "b", attributes: { versionString: "1.4.9", appStoreState: "READY_FOR_SALE" } },
          ],
        },
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [200, { data: [] }],
    });
    expect((await readState(api, "app1")).versions).toEqual([
      { id: "b", version: "1.4.9", state: "READY_FOR_DISTRIBUTION", build: null },
    ]);
  });

  it("follows pagination", async () => {
    let page = 0;
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () =>
        page++ === 0
          ? [
              200,
              {
                ...versionsPayload(["a", "1.5.0", "PREPARE_FOR_SUBMISSION"]),
                links: {
                  next: "https://api.appstoreconnect.apple.com/v1/apps/app1/appStoreVersions?cursor=2",
                },
              },
            ]
          : [200, versionsPayload(["b", "1.4.0", "REPLACED_WITH_NEW_VERSION"])],
      "GET /v1/apps/app1/reviewSubmissions": () => [200, { data: [] }],
    });
    expect((await readState(api, "app1")).versions.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("raises an ApiError carrying the HTTP status, without retrying a 4xx", async () => {
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [403, { errors: [{ detail: "role" }] }],
      "GET /v1/apps/app1/reviewSubmissions": () => [200, { data: [] }],
    });
    const error = await readState(api, "app1").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(calls.filter((c) => c.url.pathname.endsWith("/appStoreVersions"))).toHaveLength(1);
  });
});

describe("createClient", () => {
  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    let n = 0;
    const { api, sleeps } = fakeApi({
      "GET /v1/apps": () => [[429, 503][n++] ?? 200, n > 2 ? { data: [{ id: "x" }] } : "busy"],
    });
    await expect(api.get("/v1/apps")).resolves.toEqual({ data: [{ id: "x" }], included: [] });
    expect(sleeps).toEqual([2000, 4000]);
  });

  it("gives up after the last attempt", async () => {
    const { api, calls } = fakeApi({ "GET /v1/apps": () => [502, "<html>bad gateway</html>"] });
    const error = await api.get("/v1/apps").catch((e) => e);
    expect(error.status).toBe(502);
    expect(error.message).toContain("<html>bad gateway</html>");
    expect(calls).toHaveLength(4);
  });

  it("retries a network error", async () => {
    let n = 0;
    const sleeps = [];
    const api = createClient({
      token: () => "t",
      sleep: async (ms) => sleeps.push(ms),
      fetchImpl: async () => {
        if (n++ === 0) throw new Error("socket hang up");
        return { ok: true, status: 200, text: async () => '{"data":[]}' };
      },
    });
    await expect(api.get("/v1/apps")).resolves.toEqual({ data: [], included: [] });
    expect(sleeps).toHaveLength(1);
  });

  it("tolerates an empty or non-JSON success body", async () => {
    const { api } = fakeApi({ "DELETE /v1/reviewSubmissionItems/i0": () => [204, ""] });
    await expect(api.del("/v1/reviewSubmissionItems/i0")).resolves.toEqual({});
    const { api: other } = fakeApi({ "GET /v1/apps": () => [200, "not json"] });
    await expect(other.get("/v1/apps")).resolves.toEqual({ data: [], included: [] });
  });
});

describe("latestBuild", () => {
  it("returns the highest processed build number of the version", async () => {
    const { api, calls } = fakeApi({
      "GET /v1/builds": () => [
        200,
        {
          data: [
            { attributes: { version: "105000002" } },
            { attributes: { version: "105000011" } },
          ],
        },
      ],
    });
    await expect(latestBuild(api, "app1", "1.5.0")).resolves.toBe("105000011");
    expect(calls[0].url.searchParams.get("filter[processingState]")).toBe("VALID");
    expect(calls[0].url.searchParams.get("filter[preReleaseVersion.version]")).toBe("1.5.0");
    expect(calls[0].url.searchParams.get("filter[expired]")).toBe("false");
  });

  it("returns null when there is none", async () => {
    const { api } = fakeApi({});
    await expect(latestBuild(api, "app1", "1.5.0")).resolves.toBeNull();
  });
});

describe("prepare", () => {
  const noSleep = async () => {};

  it("cancels the queued submission, waits for it to clear, then submits", async () => {
    let phase = 0;
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload([
          "old",
          "1.5.0",
          phase < 2 ? "WAITING_FOR_REVIEW" : "DEVELOPER_REJECTED",
          "b",
          "105000004",
        ]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => {
        const state = [
          submissionsPayload(["sub", "WAITING_FOR_REVIEW", "old"]),
          submissionsPayload(["sub", "CANCELING", "old"]),
          { data: [] },
        ][phase];
        phase = Math.min(phase + 1, 2);
        return [200, state];
      },
      "GET /v1/reviewSubmissions/sub": single("sub", "WAITING_FOR_REVIEW"),
      "PATCH /v1/reviewSubmissions/sub": () => [200, { data: {} }],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep });
    expect(d.action).toBe("submit");
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({
      data: { type: "reviewSubmissions", id: "sub", attributes: { canceled: true } },
    });
  });

  it("re-reads the submission before cancelling, and leaves one that entered review", async () => {
    let reads = 0;
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload([
          "old",
          "1.5.0",
          reads === 0 ? "WAITING_FOR_REVIEW" : "IN_REVIEW",
          "b",
          "1",
        ]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["sub", reads++ === 0 ? "WAITING_FOR_REVIEW" : "IN_REVIEW", "old"]),
      ],
      "GET /v1/reviewSubmissions/sub": single("sub", "IN_REVIEW"),
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep });
    expect(d.action).toBe("defer");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("reads again after a refused cancellation", async () => {
    let reads = 0;
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload([
          "old",
          "1.5.0",
          reads === 0 ? "WAITING_FOR_REVIEW" : "IN_REVIEW",
          "b",
          "1",
        ]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["sub", reads++ === 0 ? "WAITING_FOR_REVIEW" : "IN_REVIEW", "old"]),
      ],
      "GET /v1/reviewSubmissions/sub": single("sub", "WAITING_FOR_REVIEW"),
      "PATCH /v1/reviewSubmissions/sub": () => [409, { errors: [{ detail: "state" }] }],
    });
    await expect(prepare({ api, appId: "app1", target, sleep: noSleep })).resolves.toMatchObject({
      action: "defer",
    });
  });

  it("re-reads for a while, then defers, when a cancelled submission is still waiting", async () => {
    const sleeps = [];
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["old", "1.5.0", "WAITING_FOR_REVIEW", "b", "1"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["sub", "WAITING_FOR_REVIEW", "old"]),
      ],
      "GET /v1/reviewSubmissions/sub": single("sub", "WAITING_FOR_REVIEW"),
      "PATCH /v1/reviewSubmissions/sub": () => [200, { data: {} }],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: async (ms) => sleeps.push(ms) });
    expect(d.action).toBe("defer");
    expect(d.reason).toContain("still listed as waiting for review");
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(sleeps).toEqual(Array(SETTLE_READS).fill(15000));
  });

  it("empties an unsent draft by deleting its items, then submits into it", async () => {
    let cleared = false;
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload([
          "old",
          "1.5.0",
          cleared ? "PREPARE_FOR_SUBMISSION" : "READY_FOR_REVIEW",
          "b",
          "1",
        ]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["draft", "READY_FOR_REVIEW", "old", cleared ? 0 : 2]),
      ],
      "DELETE /v1/reviewSubmissionItems/i0": () => [204, ""],
      "DELETE /v1/reviewSubmissionItems/i1": () => {
        cleared = true;
        return [204, ""];
      },
    });
    await expect(prepare({ api, appId: "app1", target, sleep: noSleep })).resolves.toMatchObject({
      action: "submit",
    });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url.pathname)).toEqual([
      "/v1/reviewSubmissionItems/i0",
      "/v1/reviewSubmissionItems/i1",
    ]);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("fails with instructions when the items cannot be removed", async () => {
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["old", "1.5.0", "READY_FOR_REVIEW", "b", "1"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["draft", "READY_FOR_REVIEW", "old"]),
      ],
      "DELETE /v1/reviewSubmissionItems/i0": () => [403, { errors: [{ detail: "forbidden" }] }],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep });
    expect(d.action).toBe("fail");
    expect(d.reason).toContain("remove them in App Store Connect");
  });

  it("re-reads for a while, then defers, when a draft still lists items after they were removed", async () => {
    const sleeps = [];
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["old", "1.5.0", "READY_FOR_REVIEW", "b", "1"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["draft", "READY_FOR_REVIEW", "old"]),
      ],
      "DELETE /v1/reviewSubmissionItems/i0": () => [204, ""],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: async (ms) => sleeps.push(ms) });
    expect(d.action).toBe("defer");
    expect(d.reason).toContain("still lists items");
    expect(sleeps).toEqual(Array(SETTLE_READS).fill(15000));
  });

  it("gives up waiting after the poll limit", async () => {
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["old", "1.5.0", "WAITING_FOR_REVIEW", "b", "1"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["sub", "CANCELING", "old"]),
      ],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep, maxPolls: 4 });
    expect(d).toEqual({
      action: "defer",
      reason: "the previous submission did not clear within 1 minutes; the catch-up tries again",
    });
  });

  it("propagates any other cancellation error", async () => {
    const { api } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["old", "1.5.0", "WAITING_FOR_REVIEW", "b", "1"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["sub", "WAITING_FOR_REVIEW", "old"]),
      ],
      "GET /v1/reviewSubmissions/sub": single("sub", "WAITING_FOR_REVIEW"),
      "PATCH /v1/reviewSubmissions/sub": () => [403, { errors: [{ detail: "role" }] }],
    });
    await expect(prepare({ api, appId: "app1", target, sleep: noSleep })).rejects.toThrow(
      "HTTP 403",
    );
  });

  it("returns a final outcome without acting", async () => {
    const { api, calls } = fakeApi({
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["old", "1.5.0", "REJECTED", "b", "1"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [
        200,
        submissionsPayload(["sub", "UNRESOLVED_ISSUES", "old"]),
      ],
    });
    await expect(prepare({ api, appId: "app1", target, sleep: noSleep })).resolves.toMatchObject({
      action: "fail",
    });
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });
});

describe("prepare — submission items", () => {
  const noSleep = async () => {};
  const base = (submissionState, versionState) => ({
    "GET /v1/apps/app1/appStoreVersions": () => [
      200,
      versionsPayload(["old", "1.5.0", versionState, "b", "1"]),
    ],
    "GET /v1/apps/app1/reviewSubmissions": () => [
      200,
      submissionsPayload(["sub", submissionState, "old"]),
    ],
    "GET /v1/reviewSubmissions/sub": single("sub", submissionState),
  });

  it("refuses to cancel a submission holding anything but an App Store version", async () => {
    const { api, calls } = fakeApi({
      ...base("WAITING_FOR_REVIEW", "WAITING_FOR_REVIEW"),
      "GET /v1/reviewSubmissions/sub/items": () => [
        200,
        {
          data: [
            { relationships: { appStoreVersion: { data: { id: "old" } } } },
            { relationships: { appEvent: { data: { id: "e1" } } } },
            { relationships: {} },
          ],
        },
      ],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep });
    expect(d.action).toBe("fail");
    expect(d.reason).toContain("holds items other than an App Store version (appEvent, unknown)");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("refuses to empty a draft holding anything but an App Store version", async () => {
    const { api, calls } = fakeApi({
      ...base("READY_FOR_REVIEW", "READY_FOR_REVIEW"),
      "GET /v1/reviewSubmissions/sub/items": () => [
        200,
        { data: [{ relationships: { appCustomProductPageVersion: { data: { id: "p" } } } }] },
      ],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep });
    expect(d.reason).toContain("(appCustomProductPageVersion)");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("falls back to the appStoreVersion include when the item includes are refused", async () => {
    let first = true;
    const { api } = fakeApi({
      ...base("READY_FOR_REVIEW", "READY_FOR_REVIEW"),
      "GET /v1/reviewSubmissions/sub/items": (u) => {
        if (first) {
          first = false;
          return [400, { errors: [{ detail: "bad include" }] }];
        }
        expect(u.searchParams.get("include")).toBe("appStoreVersion");
        return versionItems();
      },
      "DELETE /v1/reviewSubmissionItems/i0": () => [404, { errors: [{ detail: "gone" }] }],
    });
    const d = await prepare({ api, appId: "app1", target, sleep: noSleep });
    // The 404 counts as removed; the fake still lists the item, so it fails only after re-reads.
    expect(d.reason).toContain("still lists items after this job removed them");
  });
});

describe("isPermanent", () => {
  it("treats a 4xx other than 409 and 429 as permanent", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isPermanent(new ApiError(status, "x")), String(status)).toBe(true);
    }
  });

  it("treats 409, 429, 5xx and non-API errors as transient", () => {
    for (const status of [409, 429, 500, 503]) {
      expect(isPermanent(new ApiError(status, "x")), String(status)).toBe(false);
    }
    expect(isPermanent(new Error("socket hang up"))).toBe(false);
  });
});

describe("itemKinds", () => {
  it("names what each item points at", () => {
    expect(
      itemKinds([
        { relationships: { appStoreVersion: { data: { id: "v" } }, appEvent: { data: null } } },
        { relationships: { appStoreVersionExperiment: { data: { id: "x" } } } },
        { relationships: { appEvent: { links: {} } } },
        {},
      ]),
    ).toEqual(["appStoreVersion", "appStoreVersionExperiment", "unknown", "unknown"]);
  });
});

describe("owed", () => {
  const base = { tag: "v1.5.1", requested: "", inFlight: [] };
  it("owes a release whose record is pending or absent", () => {
    expect(owed({ ...base, state: "pending" }).owed).toBe(true);
    expect(owed({ ...base, state: null })).toEqual({
      owed: true,
      reason: "app-store/v1.5.1 is absent",
    });
  });

  it("owes nothing once the record is closed", () => {
    for (const state of ["success", "failure", "error"]) {
      expect(owed({ ...base, state }).owed, state).toBe(false);
    }
  });

  it("owes nothing while a run for it or a newer release is in flight", () => {
    expect(owed({ ...base, state: null, inFlight: ["v1.5.1"] }).reason).toContain(
      "v1.5.1 is in flight",
    );
    expect(owed({ ...base, state: "pending", inFlight: ["v1.6.0"] }).owed).toBe(false);
    expect(owed({ ...base, state: "pending", inFlight: ["v1.5.0"] }).owed).toBe(true);
  });

  it("always owes a requested release", () => {
    expect(
      owed({ ...base, requested: "v1.5.1", state: "failure", inFlight: ["v1.6.0"] }).owed,
    ).toBe(true);
  });
});

describe("parseReleases", () => {
  it("reads versions, with or without the v", () => {
    expect(parseReleases("1.5.0 v1.5.1  junk 1.5")).toEqual(new Set(["1.5.0", "1.5.1"]));
    expect(parseReleases("")).toEqual(new Set());
    expect(parseReleases(undefined)).toBeNull();
  });
});

describe("checkCatchUp", () => {
  const sha = (c) => c.repeat(40);
  const candidates = [
    { tag: "v1.5.2", commit: sha("c"), year: "2026" },
    { tag: "v1.5.1", commit: sha("b"), year: "2026" },
  ];
  const apps = {
    "GET /v1/apps": () => [
      200,
      { data: [{ id: "app1", attributes: { bundleId: "au.how2vote.app" } }] },
    ],
  };
  const buildsOf = (map) => (u) => {
    const v = u.searchParams.get("filter[preReleaseVersion.version]");
    return [200, { data: (map[v] ?? []).map((n) => ({ attributes: { version: n } })) }];
  };
  const run = (pages, { states = {}, requested = "", inFlight = [] } = {}) =>
    checkCatchUp({
      api: fakeApi({ ...apps, ...pages }).api,
      candidates,
      releases: new Set(["1.5.1", "1.5.2"]),
      requested,
      inFlight,
      stateOf: async (tag) => states[tag] ?? null,
    });

  it("treats the newest release with a build and no record as owed", async () => {
    const { values } = await run({
      "GET /v1/builds": buildsOf({ "1.5.1": ["105001003"] }),
      "GET /v1/apps/app1/appStoreVersions": () => [
        200,
        versionsPayload(["l", "1.4.9", "READY_FOR_DISTRIBUTION"]),
      ],
      "GET /v1/apps/app1/reviewSubmissions": () => [200, { data: [] }],
    });
    expect(values).toMatchObject({
      outcome: "submit",
      tag: "v1.5.1",
      build: "105001003",
      version: "1.5.1",
    });
  });

  it("owes nothing when that release's run is in flight or its record is closed", async () => {
    const pages = {
      "GET /v1/builds": buildsOf({ "1.5.1": ["105001003"] }),
      "GET /v1/apps/app1/appStoreVersions": () => [200, { data: [] }],
      "GET /v1/apps/app1/reviewSubmissions": () => [200, { data: [] }],
    };
    expect((await run(pages, { inFlight: ["v1.5.1"] })).values.outcome).toBe("none");
    expect((await run(pages, { states: { "v1.5.1": "success" } })).values.outcome).toBe("none");
  });

  it("reports none when no candidate has a build", async () => {
    expect((await run({})).values).toEqual({
      outcome: "none",
      reason: "no shipped release has a processed build",
    });
  });

  it("reports unreadable for the release already chosen, not the newest candidate", async () => {
    const { values, warnings } = await run({
      "GET /v1/builds": buildsOf({ "1.5.1": ["105001003"] }),
      "GET /v1/apps/app1/appStoreVersions": () => [403, { errors: [{ detail: "role" }] }],
      "GET /v1/apps/app1/reviewSubmissions": () => [200, { data: [] }],
    });
    expect(values).toMatchObject({ outcome: "unreadable", tag: "v1.5.1", build: "105001003" });
    expect(warnings[0]).toContain("cannot read the review state");
  });

  it("reports none, never a release without a build, when nothing was chosen yet", async () => {
    const { values, warnings } = await run({
      "GET /v1/apps": () => [401, { errors: [{ detail: "auth" }] }],
    });
    expect(values).toEqual({
      outcome: "none",
      reason: "this key cannot read which release has a processed build",
    });
    expect(warnings[0]).toContain("cannot read the review state");
  });
});

describe("parseCandidates", () => {
  const sha = "a".repeat(40);
  it("reads tag=commit=year entries in order", () => {
    expect(parseCandidates(`v1.5.1=${sha}=2026  v1.5.0=${"b".repeat(40)}=2025\n`)).toEqual([
      { tag: "v1.5.1", commit: sha, year: "2026" },
      { tag: "v1.5.0", commit: "b".repeat(40), year: "2025" },
    ]);
  });

  it("drops malformed entries", () => {
    expect(
      parseCandidates(`1.5.1=${sha}=2026 v1.5=${sha}=2026 v1.5.1=abc=2026 v1.5.1=${sha}=26 v1.5.1`),
    ).toEqual([]);
    expect(parseCandidates(undefined)).toEqual([]);
  });
});

describe("pickCandidate", () => {
  const c = (tag) => ({ tag, commit: "c", year: "2026" });
  it("takes the newest candidate with a processed build", async () => {
    const builds = { "1.5.0": "105000003" };
    await expect(
      pickCandidate([c("v1.5.2"), c("v1.5.1"), c("v1.5.0")], async (v) => builds[v] ?? null),
    ).resolves.toEqual({ ...c("v1.5.0"), version: "1.5.0", build: "105000003" });
  });

  it("is null when no candidate has a build", async () => {
    await expect(pickCandidate([c("v1.5.2")], async () => null)).resolves.toBeNull();
  });
});

describe("ascToken", () => {
  it("signs an ES256 token App Store Connect accepts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const token = ascToken({
      keyId: "KEY",
      issuerId: "ISS",
      privateKey: pem,
      now: 1_700_000_000_000,
    });
    const [h, p, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url"))).toEqual({
      alg: "ES256",
      kid: "KEY",
      typ: "JWT",
    });
    const payload = JSON.parse(Buffer.from(p, "base64url"));
    expect(payload).toEqual({
      iss: "ISS",
      iat: 1_700_000_000,
      exp: 1_700_000_900,
      aud: "appstoreconnect-v1",
    });
    expect(Buffer.from(sig, "base64url")).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      ),
    ).toBe(true);
  });
});
