import { describe, expect, it } from "vitest";
import { liveVersion, publishedVersion } from "./resolve-fdroid-live-version.mjs";
import { encodeVersionCode } from "./generate-app-version.mjs";

/** A package entry as the F-Droid index API returns one. */
const pkg = (versionName) => ({ versionName, versionCode: encodeVersionCode(versionName) });

/** The payload shape of https://f-droid.org/api/v1/packages/<appId>. */
const index = (suggested, ...versionNames) => ({
  packageName: "au.how2vote.app",
  suggestedVersionCode: suggested === null ? undefined : encodeVersionCode(suggested),
  packages: versionNames.map(pkg),
});

const respond = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("liveVersion", () => {
  it("reports the version the index suggests installing", () => {
    expect(liveVersion(index("1.3.23", "1.3.23", "1.3.21"))).toBe("1.3.23");
  });

  it("prefers the suggestion over the highest code", () => {
    // `packages` lists superseded builds too, and while a suggestion is changing the newest entry
    // is not necessarily the one being offered — reporting it would claim users have a build the
    // index is not yet handing out.
    expect(liveVersion(index("1.3.21", "1.3.23", "1.3.21"))).toBe("1.3.21");
  });

  it("falls back to the highest code when the suggestion names nothing present", () => {
    expect(liveVersion(index("9.9.9", "1.3.21", "1.3.23"))).toBe("1.3.23");
    expect(liveVersion(index(null, "1.3.21", "1.3.23"))).toBe("1.3.23");
  });

  it("ignores entries the badge could not use", () => {
    // The badge interpolates the version into a git ref to read that release's dataset, so a
    // non-semver versionName is dropped rather than passed along (same fail-closed rule as
    // generate-store-badges).
    const payload = {
      suggestedVersionCode: 10323000,
      packages: [
        { versionName: "1.3.23-rc.1", versionCode: 10323000 },
        { versionName: "1.3.21", versionCode: 10321000 },
        { versionName: "1.3.22", versionCode: null },
      ],
    };
    expect(liveVersion(payload)).toBe("1.3.21");
  });

  it("returns null when nothing is published", () => {
    expect(liveVersion({ packages: [] })).toBeNull();
    expect(liveVersion({})).toBeNull();
    expect(liveVersion(null)).toBeNull();
  });
});

describe("publishedVersion", () => {
  it("reads the version out of the index", async () => {
    await expect(publishedVersion(respond(200, index("1.3.23", "1.3.23")))).resolves.toBe("1.3.23");
  });

  it("requests the app's own index entry", async () => {
    let seen = "";
    await publishedVersion(async (url) => {
      seen = url;
      return { ok: true, status: 200, json: async () => index("1.3.23", "1.3.23") };
    });
    expect(seen).toBe("https://f-droid.org/api/v1/packages/au.how2vote.app");
  });

  it("treats a 404 as not-yet-published, not an error", async () => {
    // The index 404s until the app is in it. That is the honest state of a pending listing, and
    // the badge should show grey rather than the run printing a warning about it.
    await expect(publishedVersion(respond(404, {}))).resolves.toBeNull();
  });

  it("throws on an index it could not read, so the caller warns and fails open", async () => {
    await expect(publishedVersion(respond(500, {}))).rejects.toThrow("index unreadable: 500");
  });
});
