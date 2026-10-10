import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  decodeVersionCode,
  encodeVersionCode,
  legacyVersionCode,
  MAX_VERSION_CODE,
  PREVIEW_CODE_FLOOR,
  payload,
} from "./generate-app-version.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** resolve-store-version's encoding, as a store upload computes it. */
const storeCode = (major, minor, patch, runNumber) =>
  major * 100000000 + minor * 1000000 + patch * 1000 + runNumber;

/** The legacy encoding every release up to 1.4.6 was uploaded with. */
const legacyStoreCode = (major, minor, patch, runNumber) =>
  (major * 10000 + minor * 100 + patch) * 1000 + runNumber;

/**
 * Runs the action's own bash step for a tag, so the parity below is against the shipped script
 * rather than a restatement of it.
 * @returns {{ ok: boolean, build?: number }}
 */
function runAction(tag, runNumber) {
  const yml = readFileSync(join(ROOT, ".github/actions/resolve-store-version/action.yml"), "utf8");
  const lines = yml.split("\n");
  const at = lines.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  const indent = lines[at + 1].match(/^ */)[0].length;
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() !== "" && l.match(/^ */)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  const dir = mkdtempSync(join(tmpdir(), "resolve-store-version-"));
  const out = join(dir, "out");
  try {
    execFileSync("bash", ["-c", body.join("\n")], {
      cwd: ROOT,
      env: { ...process.env, TAG: tag, RUN_NUMBER: String(runNumber), GITHUB_OUTPUT: out },
      stdio: "ignore",
    });
    const build = readFileSync(out, "utf8").match(/^build=(\d+)$/m)?.[1];
    return { ok: true, build: Number(build) };
  } catch {
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("encodeVersionCode", () => {
  it("encodes semver exactly as resolve-store-version, with run digits 000", () => {
    expect(encodeVersionCode("2.1.0")).toBe(201000000);
    expect(encodeVersionCode("1.4.6")).toBe(104006000);
    expect(encodeVersionCode("9.42.7")).toBe(942007000);
  });

  it("is strictly monotonic across release ordering", () => {
    const ordered = [
      "1.0.0",
      "1.0.1",
      "1.0.999",
      "1.1.0",
      "1.9.9",
      "1.99.999",
      "2.0.0",
      "9.99.999",
    ];
    const codes = ordered.map(encodeVersionCode);
    expect(codes.every((c, i) => i === 0 || c > codes[i - 1])).toBe(true);
  });

  it("always ranks below the same release's store versionCode (run number >= 1)", () => {
    expect(encodeVersionCode("2.1.0")).toBeLessThan(storeCode(2, 1, 0, 1));
  });

  it("ranks every store upload of a release below the next release's baseline", () => {
    // The run digits must never carry into the semver field: the highest run number this scheme
    // admits still has to lose to the next patch.
    expect(storeCode(2, 1, 0, 999)).toBeLessThan(encodeVersionCode("2.1.1"));
    expect(storeCode(2, 1, 999, 999)).toBeLessThan(encodeVersionCode("2.2.0"));
    expect(storeCode(2, 99, 999, 999)).toBeLessThan(encodeVersionCode("3.0.0"));
  });

  it("outranks every code the legacy encoding issued or could issue", () => {
    // Releases up to 1.4.6 shipped with (semver)*1000 + run digits. Every code the current scheme
    // emits must be higher, or a store would reject the next upload.
    const legacyMax = legacyStoreCode(9, 99, 99, 999);
    expect(encodeVersionCode("1.0.0")).toBeGreaterThan(legacyMax);
    expect(encodeVersionCode("1.4.7")).toBeGreaterThan(legacyStoreCode(1, 4, 6, 999));
  });

  it("outranks the superseded run-attempt encoding for the same version", () => {
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

  it("refuses a field that would carry, and a major outside 1-9", () => {
    expect(encodeVersionCode("1.100.0")).toBeNull();
    expect(encodeVersionCode("1.0.1000")).toBeNull();
    expect(encodeVersionCode("0.9.9")).toBeNull();
    expect(encodeVersionCode("10.0.0")).toBeNull();
    expect(encodeVersionCode("9.99.999")).toBe(999999000);
    expect(encodeVersionCode("1.99.999")).not.toBeNull();
    expect(encodeVersionCode("1.0.100")).toBe(100100000);
  });

  it("stays below the preview range and the Play ceiling for every encodable version", () => {
    expect(storeCode(9, 99, 999, 999)).toBeLessThan(PREVIEW_CODE_FLOOR);
    expect(PREVIEW_CODE_FLOOR).toBeLessThan(MAX_VERSION_CODE);
    expect(MAX_VERSION_CODE).toBe(2100000000);
  });
});

describe("legacyVersionCode", () => {
  it("reproduces the codes issued under the legacy encoding", () => {
    expect(legacyVersionCode("1.3.16")).toBe(10316000);
    expect(legacyVersionCode("1.4.5")).toBe(10405000);
    expect(legacyVersionCode("1.4.6")).toBe(10406000);
  });

  it("applies only to releases up to the legacy cutover", () => {
    for (const v of ["1.4.7", "1.5.0", "2.0.0", "0.9.9", "1.4.100", "1.4.5-rc"]) {
      expect(legacyVersionCode(v)).toBeNull();
    }
  });
});

describe("decodeVersionCode across both encodings", () => {
  it("decodes a legacy store code to its release", () => {
    expect(decodeVersionCode(legacyStoreCode(1, 4, 5, 36))).toBe("1.4.5");
    expect(decodeVersionCode(10316000)).toBe("1.3.16");
  });

  it("decodes a current store code to its release", () => {
    expect(decodeVersionCode(storeCode(1, 4, 6, 37))).toBe("1.4.6");
    expect(decodeVersionCode(storeCode(9, 99, 999, 999))).toBe("9.99.999");
  });
});

describe("resolve-store-version action", () => {
  it("emits exactly the JS encoding plus the run digits", () => {
    for (const [v, runNumber] of [
      ["1.4.6", 37],
      ["1.4.100", 1],
      ["1.99.999", 999],
      ["2.0.0", 1234],
      ["9.99.999", 999],
    ]) {
      const { ok, build } = runAction(`v${v}`, runNumber);
      expect(ok, v).toBe(true);
      expect(build, v).toBe(encodeVersionCode(v) + (runNumber % 1000));
    }
  });

  it("issues a code above every legacy code already uploaded", () => {
    // Even run 999 of the last legacy release loses to run 0 of the next one.
    const { build } = runAction("v1.4.7", 1000);
    expect(build).toBeGreaterThan(legacyStoreCode(1, 4, 6, 999));
  });

  it("fails closed on exactly the versions the JS encoder refuses", () => {
    for (const v of [
      "1.100.0",
      "1.0.1000",
      "0.9.9",
      "10.0.0",
      "1.01.0",
      "1.0.99999999999999999999",
    ]) {
      expect(encodeVersionCode(v), v).toBeNull();
      expect(runAction(`v${v}`, 1).ok, v).toBe(false);
    }
  });
});

describe("payload", () => {
  it("publishes the pair for a release version", () => {
    expect(payload("2.1.0")).toEqual({ versionName: "2.1.0", versionCode: 201000000 });
  });

  it("emits an explicit null payload for previews, dev builds and unset env", () => {
    for (const notRelease of ["1.2.3-pr7", "0.0.0-dev", undefined]) {
      expect(payload(notRelease)).toEqual({ versionName: null, versionCode: null });
    }
  });
});
