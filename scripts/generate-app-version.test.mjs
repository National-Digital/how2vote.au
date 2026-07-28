import { describe, expect, it } from "vitest";

import { encodeVersionCode, payload } from "./generate-app-version.mjs";

/** resolve-store-version's encoding, as a store upload computes it. */
const storeCode = (major, minor, patch, runNumber) =>
  (major * 10000 + minor * 100 + patch) * 1000 + runNumber;

describe("encodeVersionCode", () => {
  it("encodes semver exactly as resolve-store-version, with run digits 000", () => {
    expect(encodeVersionCode("2.1.0")).toBe(20100000);
    expect(encodeVersionCode("0.0.1")).toBe(1000);
    expect(encodeVersionCode("10.42.7")).toBe(104207000);
  });

  it("is strictly monotonic across release ordering", () => {
    const ordered = ["1.0.0", "1.0.1", "1.1.0", "1.9.9", "2.0.0"];
    const codes = ordered.map(encodeVersionCode);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });

  it("always ranks below the same release's store versionCode (run number >= 1)", () => {
    expect(encodeVersionCode("2.1.0")).toBeLessThan(storeCode(2, 1, 0, 1));
  });

  it("ranks every store upload of a release below the next release's baseline", () => {
    // The run digits must never carry into the semver field: the highest run number this scheme
    // admits still has to lose to the next patch.
    expect(storeCode(2, 1, 0, 999)).toBeLessThan(encodeVersionCode("2.1.1"));
    expect(storeCode(2, 1, 99, 999)).toBeLessThan(encodeVersionCode("2.2.0"));
    expect(storeCode(2, 99, 99, 999)).toBeLessThan(encodeVersionCode("3.0.0"));
  });

  it("outranks the superseded run-attempt encoding for the same version", () => {
    // Releases already published used (semver)*100 + run_attempt. Every code the current scheme
    // emits must still be higher, or a store would reject the next upload.
    const supersededMax = (2 * 10000 + 1 * 100 + 0) * 100 + 99;
    expect(encodeVersionCode("2.1.0")).toBeGreaterThan(supersededMax);
  });

  it("fails closed on anything that is not strict semver", () => {
    for (const bad of ["1.2.3-pr7", "0.0.0-dev", "v2.1.0", "2.1", "", undefined, "1.2.3.4"]) {
      expect(encodeVersionCode(bad)).toBeNull();
    }
  });

  it("rejects leading zeros, which bash arithmetic would read as octal", () => {
    for (const bad of ["1.01.0", "01.0.0", "1.0.09"]) {
      expect(encodeVersionCode(bad)).toBeNull();
    }
  });

  it("refuses a minor or patch that would carry into the next field", () => {
    expect(encodeVersionCode("1.100.0")).toBeNull();
    expect(encodeVersionCode("1.0.100")).toBeNull();
    expect(encodeVersionCode("1.99.99")).not.toBeNull();
  });

  it("stays under the Android versionCode ceiling for any plausible version", () => {
    expect(storeCode(99, 99, 99, 999)).toBeLessThan(2100000000);
  });
});

describe("payload", () => {
  it("publishes the pair for a release version", () => {
    expect(payload("2.1.0")).toEqual({ versionName: "2.1.0", versionCode: 20100000 });
  });

  it("emits an explicit null payload for previews, dev builds and unset env", () => {
    for (const notRelease of ["1.2.3-pr7", "0.0.0-dev", undefined]) {
      expect(payload(notRelease)).toEqual({ versionName: null, versionCode: null });
    }
  });
});
