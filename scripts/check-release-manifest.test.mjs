import { describe, expect, it } from "vitest";
import { verdict } from "./check-release-manifest.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/** A well-formed manifest with a configurable pending set. */
function makeManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-15T00:00:00.000Z",
    gitCommit: "0123456789abcdef",
    appVersion: "1.2.3",
    dataVersions: { 2019: "2019-01-01", 2022: "2022-01-01", 2025: "2025-03-28" },
    consentVersion: "2026-07.2",
    legalReviewVersion: "how2vote_legal_review_revised_2026-07-15",
    legalReviewHash: HASH_A,
    operatorHash: HASH_A,
    controlRegisterHash: HASH_A,
    controlPlaneHash: HASH_A,
    rightsManifestHash: HASH_A,
    productBoundaryHash: HASH_A,
    ballotVerificationHash: HASH_A,
    infrastructureHash: HASH_A,
    publicStatsHash: HASH_A,
    controlRegisterVersion: "2026-07-16",
    controls: [
      { id: "control-1", status: "implemented" },
      { id: "control-2", status: "verified" },
    ],
    pending: {},
    ...overrides,
  };
}

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — well-formed manifest", () => {
  it("passes in draft and production when nothing is pending", () => {
    expect(verdict(makeManifest(), { mode: "draft" }).ok).toBe(true);
    expect(verdict(makeManifest(), { mode: "production" }).ok).toBe(true);
  });
});

describe("verdict — required fields", () => {
  it("rejects a missing gitCommit", () => {
    expect(hasError(verdict(makeManifest({ gitCommit: "" })), "missing gitCommit")).toBe(true);
  });

  it("rejects a non-sha256 hash", () => {
    expect(
      hasError(verdict(makeManifest({ operatorHash: "nope" })), "operatorHash must be a sha256"),
    ).toBe(true);
  });

  it("rejects empty dataVersions", () => {
    expect(
      hasError(verdict(makeManifest({ dataVersions: {} })), "dataVersions must be a non-empty"),
    ).toBe(true);
  });
});

describe("verdict — staleness", () => {
  const allActual = (over = {}) => ({
    legalReviewHash: HASH_A,
    operatorHash: HASH_A,
    controlRegisterHash: HASH_A,
    controlPlaneHash: HASH_A,
    rightsManifestHash: HASH_A,
    productBoundaryHash: HASH_A,
    ballotVerificationHash: HASH_A,
    infrastructureHash: HASH_A,
    publicStatsHash: HASH_A,
    ...over,
  });

  it("rejects a manifest whose hashes do not match disk", () => {
    const res = verdict(makeManifest(), { actualHashes: allActual({ legalReviewHash: HASH_B }) });
    expect(hasError(res, "legalReviewHash is stale")).toBe(true);
  });

  it("rejects a stale rights-manifest hash", () => {
    const res = verdict(makeManifest(), {
      actualHashes: allActual({ rightsManifestHash: HASH_B }),
    });
    expect(hasError(res, "rightsManifestHash is stale")).toBe(true);
  });

  it("passes when hashes match disk", () => {
    const res = verdict(makeManifest(), { actualHashes: allActual() });
    expect(res.ok).toBe(true);
  });

  it("fails closed when a recorded hash cannot be verified (artefact missing)", () => {
    const res = verdict(makeManifest(), { actualHashes: allActual({ legalReviewHash: null }) });
    expect(res.ok).toBe(false);
    expect(hasError(res, "legalReviewHash cannot be verified")).toBe(true);
  });
});

describe("verdict — pending / production gate", () => {
  const withPending = makeManifest({
    pending: { publicStatsRelease: "TBD", ciAttestation: "CI" },
  });

  it("allows pending fields in draft mode", () => {
    expect(verdict(withPending, { mode: "draft" }).ok).toBe(true);
  });

  it("blocks a production release while fields are pending", () => {
    const res = verdict(withPending, { mode: "production" });
    expect(res.ok).toBe(false);
    expect(hasError(res, "production release blocked")).toBe(true);
    expect(hasError(res, "publicStatsRelease")).toBe(true);
  });

  it("requires infrastructureHash to be a sha256 digest", () => {
    expect(
      hasError(
        verdict(makeManifest({ infrastructureHash: "nope" })),
        "infrastructureHash must be a sha256",
      ),
    ).toBe(true);
  });
});

describe("verdict — control enumeration", () => {
  it("requires a controlRegisterVersion", () => {
    expect(
      hasError(
        verdict(makeManifest({ controlRegisterVersion: "" })),
        "missing controlRegisterVersion",
      ),
    ).toBe(true);
  });

  it("requires a non-empty controls list", () => {
    expect(hasError(verdict(makeManifest({ controls: [] })), "controls must be a non-empty")).toBe(
      true,
    );
  });

  it("rejects an invalid control status", () => {
    const res = verdict(makeManifest({ controls: [{ id: "control-1", status: "nope" }] }));
    expect(hasError(res, "invalid status")).toBe(true);
  });

  it("blocks a production release while any control is not implemented/verified", () => {
    const res = verdict(
      makeManifest({
        controls: [
          { id: "control-1", status: "implemented" },
          { id: "control-9", status: "partial" },
        ],
      }),
      { mode: "production" },
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "production release blocked")).toBe(true);
    expect(hasError(res, "control-9")).toBe(true);
  });

  it("allows a partial control in draft mode", () => {
    const res = verdict(
      makeManifest({
        controls: [
          { id: "control-1", status: "implemented" },
          { id: "control-9", status: "partial" },
        ],
      }),
      { mode: "draft" },
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a stale controls enumeration against the register on disk", () => {
    const res = verdict(makeManifest(), {
      actualControls: [
        { id: "control-1", status: "implemented" },
        { id: "control-2", status: "partial" }, // register says verified in the fixture
      ],
    });
    expect(hasError(res, "controls enumeration is stale")).toBe(true);
  });
});

describe("verdict — release profile (requiredControls overlay)", () => {
  const controls = [
    { id: "control-1", status: "implemented" },
    { id: "control-2", status: "partial" },
  ];

  it("blocks when a required control is not implemented/verified, in any mode", () => {
    const res = verdict(makeManifest({ controls }), {
      mode: "draft",
      requiredControls: ["control-2"],
      profile: "historical-demo",
    });
    expect(res.ok).toBe(false);
    expect(hasError(res, 'required control control-2 is "partial"')).toBe(true);
  });

  it("blocks when a required control is absent from the manifest", () => {
    const res = verdict(makeManifest({ controls }), {
      requiredControls: ["control-99"],
      profile: "historical-demo",
    });
    expect(hasError(res, "requires control control-99, which is absent")).toBe(true);
  });

  it("passes when every required control is complete (other controls may stay partial)", () => {
    const res = verdict(makeManifest({ controls }), {
      requiredControls: ["control-1"],
      profile: "historical-demo",
    });
    expect(res.ok).toBe(true);
  });

  it("no requiredControls behaves like plain draft", () => {
    expect(verdict(makeManifest({ controls }), { mode: "draft" }).ok).toBe(true);
  });
});
