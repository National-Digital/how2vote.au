import { describe, expect, it } from "vitest";

import {
  CHANNELS,
  badge,
  buildBadges,
  currentDataVersion,
  dataVersionAtTag,
} from "./generate-store-badges.mjs";

const ELECTIONS = [
  { id: "next", current: true, dataVersion: "2026-06-23" },
  { id: "2025", current: false, dataVersion: "2025-03-28" },
];

describe("currentDataVersion", () => {
  it("reads the current election only, never a past one", () => {
    expect(currentDataVersion(ELECTIONS)).toBe("2026-06-23");
  });

  it("returns null when no election is current", () => {
    expect(currentDataVersion([{ id: "2025", current: false, dataVersion: "x" }])).toBeNull();
  });
});

describe("badge", () => {
  const base = { label: "iOS", current: "2026-06-23" };

  it("is grey and explicit when the channel is not published", () => {
    expect(badge({ ...base, version: null })).toMatchObject({
      message: "not published",
      color: "lightgrey",
    });
  });

  it("is green when the channel ships the current dataset", () => {
    expect(badge({ ...base, version: "1.0.4", dataVersion: "2026-06-23" })).toMatchObject({
      message: "1.0.4 · data 2026-06-23",
      color: "brightgreen",
    });
  });

  it("is yellow — not red, and never the word 'stale' — when the data trails", () => {
    const b = badge({ ...base, version: "1.0.1", dataVersion: "2025-03-28" });
    expect(b.color).toBe("yellow");
    expect(b.message).toBe("1.0.1 · data 2025-03-28");
    expect(b.message).not.toMatch(/stale/i);
  });

  it("falls back to the bare version when the data age is unresolvable", () => {
    expect(badge({ ...base, version: "1.0.4", dataVersion: null })).toMatchObject({
      message: "1.0.4",
      color: "blue",
    });
  });

  it("carries the shields endpoint schema version", () => {
    expect(badge({ ...base, version: "1.0.4" }).schemaVersion).toBe(1);
  });
});

describe("dataVersionAtTag", () => {
  it("refuses a non-semver version rather than interpolating it into a git ref", () => {
    let called = false;
    const exec = () => {
      called = true;
      return "";
    };
    for (const bad of ["v1.0.4", "1.0", "main", "1.0.4; rm -rf /", "", null]) {
      expect(dataVersionAtTag(bad, { exec })).toBeNull();
    }
    expect(called).toBe(false);
  });

  it("reads the dataset from that version's tag", () => {
    const exec = (cmd, args) => {
      expect(cmd).toBe("git");
      expect(args).toEqual(["show", "v1.0.4:data/dist/elections.json"]);
      return JSON.stringify(ELECTIONS);
    };
    expect(dataVersionAtTag("1.0.4", { exec })).toBe("2026-06-23");
  });

  it("returns null when the tag is absent (shallow clone) instead of throwing", () => {
    const exec = () => {
      throw new Error("fatal: invalid object name");
    };
    expect(dataVersionAtTag("1.0.4", { exec })).toBeNull();
  });
});

describe("buildBadges", () => {
  const resolve = (v) => (v === "1.0.4" ? "2026-06-23" : "2025-03-28");

  it("always emits web plus every channel, so the README renders before any store is live", () => {
    const files = buildBadges(ELECTIONS, {}, resolve);
    expect(Object.keys(files)).toEqual(["web.json", "ios.json", "android.json", "fdroid.json"]);
    for (const { id } of CHANNELS) {
      expect(files[`${id}.json`].message).toBe("not published");
    }
  });

  it("emits the working tree's data date for web", () => {
    expect(buildBadges(ELECTIONS, {}, resolve)["web.json"]).toMatchObject({
      message: "data 2026-06-23",
      color: "brightgreen",
    });
  });

  it("distinguishes a current channel from one that trails", () => {
    const files = buildBadges(
      ELECTIONS,
      { IOS_LIVE_VERSION: "1.0.4", ANDROID_LIVE_VERSION: "1.0.1" },
      resolve,
    );
    expect(files["ios.json"].color).toBe("brightgreen");
    expect(files["android.json"].color).toBe("yellow");
    expect(files["fdroid.json"].color).toBe("lightgrey");
  });

  it("treats a blank env var as unpublished", () => {
    expect(buildBadges(ELECTIONS, { IOS_LIVE_VERSION: "   " }, resolve)["ios.json"].message).toBe(
      "not published",
    );
  });
});
