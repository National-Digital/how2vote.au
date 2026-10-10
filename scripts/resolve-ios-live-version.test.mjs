import { describe, expect, it } from "vitest";
import { liveVersion, publishedVersion } from "./resolve-ios-live-version.mjs";

/** The payload shape of https://itunes.apple.com/lookup?bundleId=<appId>. */
const lookup = (...results) => ({ resultCount: results.length, results });
const listing = (version, bundleId = "au.how2vote.app") => ({ bundleId, version });

const respond = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("liveVersion", () => {
  it("reports the listed version", () => {
    expect(liveVersion(lookup(listing("1.4.1")))).toBe("1.4.1");
  });

  it("ignores listings for other bundle ids", () => {
    expect(liveVersion(lookup(listing("9.9.9", "au.example.other")))).toBeNull();
  });

  it("drops a version the badge could not use", () => {
    // The badge interpolates the version into a git ref, so a non-semver value is never passed on.
    expect(liveVersion(lookup(listing("1.4")))).toBeNull();
    expect(liveVersion(lookup(listing("1.4.1-beta")))).toBeNull();
  });

  it("returns null when nothing is published", () => {
    expect(liveVersion(lookup())).toBeNull();
    expect(liveVersion({})).toBeNull();
    expect(liveVersion(null)).toBeNull();
  });
});

describe("publishedVersion", () => {
  it("reads the version out of the lookup", async () => {
    await expect(publishedVersion(respond(200, lookup(listing("1.4.1"))))).resolves.toBe("1.4.1");
  });

  it("requests the app's AU listing by bundle id", async () => {
    let seen = "";
    await publishedVersion(async (url) => {
      seen = url;
      return { ok: true, status: 200, json: async () => lookup(listing("1.4.1")) };
    });
    expect(seen).toBe("https://itunes.apple.com/lookup?bundleId=au.how2vote.app&country=au");
  });

  it("throws on a lookup it could not read, so the caller warns and fails open", async () => {
    await expect(publishedVersion(respond(503, {}))).rejects.toThrow("lookup unreadable: 503");
  });
});
