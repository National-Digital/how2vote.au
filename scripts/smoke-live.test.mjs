import { describe, expect, it } from "vitest";
import {
  verifyManifestResponse,
  verifyGovernanceState,
  verifyResearchProbe,
} from "./smoke-live.mjs";

const manifest = (over = {}) => ({
  schemaVersion: 1,
  gitCommit: "0123456789abcdef",
  appVersion: "1.2.3",
  ...over,
});

const hasError = (errors, needle) => errors.some((e) => e.includes(needle));

describe("verifyManifestResponse", () => {
  it("passes on a well-formed 200 manifest", () => {
    expect(verifyManifestResponse({ status: 200, body: manifest() })).toEqual([]);
  });

  it("FAILS closed on a non-200 status", () => {
    expect(hasError(verifyManifestResponse({ status: 404, body: null }), "expected HTTP 200")).toBe(
      true,
    );
  });

  it("FAILS when the deployed commit does not match expected (stale deploy)", () => {
    const errs = verifyManifestResponse(
      { status: 200, body: manifest() },
      { expectedCommit: "ffffffffffffffff" },
    );
    expect(hasError(errs, "stale deploy")).toBe(true);
  });

  it("passes when the deployed commit matches expected", () => {
    const errs = verifyManifestResponse(
      { status: 200, body: manifest() },
      { expectedCommit: "0123456789abcdef" },
    );
    expect(errs).toEqual([]);
  });

  it("FAILS on a missing gitCommit", () => {
    expect(
      hasError(
        verifyManifestResponse({ status: 200, body: manifest({ gitCommit: "" }) }),
        "missing gitCommit",
      ),
    ).toBe(true);
  });
});

describe("verifyGovernanceState (from the live manifest)", () => {
  const INTEGRITY = `sha256-${"a".repeat(64)}`;
  const withGov = (over = {}) =>
    manifest({ governance: { controlPlaneIntegrity: INTEGRITY, activeSuspensions: 0, ...over } });

  it("passes when the deployed manifest carries a valid governance block", () => {
    expect(verifyGovernanceState(withGov())).toEqual([]);
  });
  it("FAILS closed when the manifest has no governance block", () => {
    expect(hasError(verifyGovernanceState(manifest()), "no governance block")).toBe(true);
  });
  it("FAILS on a malformed control-plane integrity digest", () => {
    expect(
      hasError(
        verifyGovernanceState(withGov({ controlPlaneIntegrity: "nope" })),
        "integrity digest",
      ),
    ).toBe(true);
  });
  it("FAILS on an invalid active-suspension count", () => {
    expect(
      hasError(verifyGovernanceState(withGov({ activeSuspensions: -1 })), "suspension count"),
    ).toBe(true);
  });
  it("FAILS on a drifted control plane when an expected digest is supplied", () => {
    expect(
      hasError(
        verifyGovernanceState(withGov(), {
          expectedControlPlaneIntegrity: `sha256-${"b".repeat(64)}`,
        }),
        "stale/drifted control plane",
      ),
    ).toBe(true);
  });
});

describe("verifyResearchProbe", () => {
  it("passes on 204 with no body", () => {
    expect(verifyResearchProbe({ status: 204, bodyText: "" })).toEqual([]);
  });
  it("FAILS on a non-204 status", () => {
    expect(hasError(verifyResearchProbe({ status: 500, bodyText: "" }), "expected HTTP 204")).toBe(
      true,
    );
  });
  it("FAILS when the response carries a body (possible leak)", () => {
    expect(
      hasError(verifyResearchProbe({ status: 204, bodyText: "oops" }), "must reply uniformly"),
    ).toBe(true);
  });
});
