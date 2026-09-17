import { describe, expect, it } from "vitest";
import { liveVersionCode, productionVersion } from "./resolve-play-live-version.mjs";
import { decodeVersionCode, encodeVersionCode } from "./generate-app-version.mjs";

/** A release as the Play API returns one. */
const release = (status, ...versionCodes) => ({ status, versionCodes: versionCodes.map(String) });

/**
 * A fetch stand-in over a route table of [method, urlFragment, respond]. An unmatched request
 * throws rather than returning a default: a silently-satisfied call would let a wrong URL pass
 * as a working one.
 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push(`${method} ${url.replace(/^.*\/applications\//, "")}`);
    const route = routes.find(([m, fragment]) => m === method && url.includes(fragment));
    if (!route) throw new Error(`unrouted request: ${method} ${url}`);
    return route[2](init);
  };
  impl.calls = calls;
  return impl;
}

const ok = (body) => () => ({ ok: true, status: 200, json: async () => body });

/** Every call path opens then discards an edit, so both routes are always present. */
const editLifecycle = (id) => [
  ["POST", "/edits", ok({ id })],
  ["DELETE", `/edits/${id}`, ok({})],
];

describe("liveVersionCode", () => {
  it("takes the newest release that is actually serving", () => {
    expect(
      liveVersionCode({
        releases: [release("completed", 10321008), release("inProgress", 10323002)],
      }),
    ).toBe(10323002);
  });

  it("ignores releases no user is on", () => {
    // A draft or halted release is staged in the console but serving nobody — reporting one would
    // claim users have a build they cannot install.
    expect(
      liveVersionCode({
        releases: [
          release("completed", 10321008),
          release("draft", 10324000),
          release("halted", 10399000),
        ],
      }),
    ).toBe(10321008);
  });

  it("returns null for a track with nothing live", () => {
    expect(liveVersionCode({ releases: [release("draft", 10324000)] })).toBeNull();
    expect(liveVersionCode({ releases: [] })).toBeNull();
    expect(liveVersionCode({})).toBeNull();
    expect(liveVersionCode(undefined)).toBeNull();
  });

  it("discards codes that are not usable integers", () => {
    expect(liveVersionCode({ releases: [release("completed", "not-a-code")] })).toBeNull();
  });
});

describe("decodeVersionCode", () => {
  it("inverts the shared encoding, run-number digits and all", () => {
    // The store appends the workflow run number to the baseline, so both spellings of the same
    // release must decode alike.
    expect(decodeVersionCode(encodeVersionCode("1.3.21"))).toBe("1.3.21");
    expect(decodeVersionCode(encodeVersionCode("1.3.21") + 8)).toBe("1.3.21");
    expect(decodeVersionCode(encodeVersionCode("2.1.0") + 999)).toBe("2.1.0");
  });

  it("round-trips every field boundary the encoding allows", () => {
    for (const v of ["0.0.1", "1.0.0", "1.99.99", "12.3.4"]) {
      expect(decodeVersionCode(encodeVersionCode(v))).toBe(v);
    }
  });

  it("refuses input the encoder could not have produced", () => {
    for (const bad of [0, 999, -1, 1.5, "x", null, undefined]) {
      expect(decodeVersionCode(bad)).toBeNull();
    }
  });
});

describe("productionVersion", () => {
  it("opens an edit, reads the track, and always discards the edit", async () => {
    const fetchImpl = fakeFetch([
      ...editLifecycle("edit-1"),
      ["GET", "/tracks/production", ok({ releases: [release("completed", 10321008)] })],
    ]);
    await expect(productionVersion(fetchImpl, "token")).resolves.toBe("1.3.21");
    expect(fetchImpl.calls).toContain("DELETE au.how2vote.app/edits/edit-1");
  });

  it("discards the edit even when reading the track fails", async () => {
    // A leaked edit blocks every later one, so the cleanup must not depend on the happy path.
    const fetchImpl = fakeFetch([
      ...editLifecycle("edit-2"),
      ["GET", "/tracks/production", () => ({ ok: false, status: 403, json: async () => ({}) })],
    ]);
    await expect(productionVersion(fetchImpl, "token")).rejects.toThrow("403");
    expect(fetchImpl.calls).toContain("DELETE au.how2vote.app/edits/edit-2");
  });

  it("throws when the edit cannot be opened", async () => {
    const fetchImpl = fakeFetch([["POST", "/edits", ok({ error: { message: "no permission" } })]]);
    await expect(productionVersion(fetchImpl, "token")).rejects.toThrow("no permission");
  });

  it("reports null when the track holds no live release", async () => {
    const fetchImpl = fakeFetch([
      ...editLifecycle("edit-3"),
      ["GET", "/tracks/production", ok({ releases: [release("draft", 10324000)] })],
    ]);
    await expect(productionVersion(fetchImpl, "token")).resolves.toBeNull();
  });
});
