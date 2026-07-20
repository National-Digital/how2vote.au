import { describe, expect, it } from "vitest";
import {
  checkAgainstRegistry,
  isElectionOpen,
  registryEntry,
  researchIntakeOpen,
  verifyRegistryIntegrity,
  type RegistryCheckInput,
} from "./registry";
import { RESEARCH_CONSENT_VERSION, RESEARCH_SCHEMA_VERSION } from "./consent";

// The allowlist/schema/consent LOGIC is exercised with the kill switch forced open, so these tests
// are independent of the live suspension state. Under the constrained product boundary (docs/adr/0010)
// the global `research` scope is currently suspended, which closes intake at runtime — that fail-closed
// behaviour is asserted separately in the "live control-plane kill switch" block below.
const OPEN = { intakeOpen: true } as const;
const entry = registryEntry("2025", OPEN)!;
const realParty = [...entry.parties][0];
const realProp = [...entry.propositionIds][0];

/** A contribution whose values are all in the 2025 registry. */
function valid(overrides: Partial<RegistryCheckInput> = {}): RegistryCheckInput {
  return {
    electionId: "2025",
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    consentVersion: RESEARCH_CONSENT_VERSION,
    match: realParty,
    propositionIds: [realProp],
    ...overrides,
  };
}

describe("registryEntry / isElectionOpen", () => {
  it("resolves a valid election with real allowlists", () => {
    expect(entry.id).toBe("2025");
    expect(entry.open).toBe(true);
    expect(entry.parties.size).toBeGreaterThan(0);
    expect(entry.propositionIds.size).toBeGreaterThan(0);
    expect(entry.schemaVersion).toBe(RESEARCH_SCHEMA_VERSION);
  });

  it("returns null for an unknown election", () => {
    expect(registryEntry("1901", OPEN)).toBeNull();
    expect(registryEntry("", OPEN)).toBeNull();
    expect(registryEntry(42, OPEN)).toBeNull();
    expect(registryEntry(null, OPEN)).toBeNull();
  });

  it("isElectionOpen tracks validity + openness", () => {
    expect(isElectionOpen("2025", OPEN)).toBe(true);
    expect(isElectionOpen("1901", OPEN)).toBe(false);
  });
});

describe("checkAgainstRegistry — out-of-registry rejection", () => {
  it("accepts an all-in-registry contribution", () => {
    expect(checkAgainstRegistry(valid(), OPEN)).toEqual({ ok: true });
  });

  it("accepts a null match (unscored contribution)", () => {
    expect(checkAgainstRegistry(valid({ match: null }), OPEN)).toEqual({ ok: true });
  });

  it("rejects an unknown election", () => {
    expect(checkAgainstRegistry(valid({ electionId: "1901" }), OPEN)).toEqual({
      ok: false,
      reason: "unknown-election",
    });
  });

  it("rejects a schema mismatch", () => {
    expect(checkAgainstRegistry(valid({ schemaVersion: 999 }), OPEN)).toEqual({
      ok: false,
      reason: "schema-mismatch",
    });
  });

  it("rejects a stale/unknown/future consent version", () => {
    expect(checkAgainstRegistry(valid({ consentVersion: "2026-07" }), OPEN).ok).toBe(false); // stale
    expect(checkAgainstRegistry(valid({ consentVersion: "2099-01" }), OPEN)).toEqual({
      ok: false,
      reason: "consent-not-accepted",
    });
  });

  it("rejects an out-of-registry party match", () => {
    expect(checkAgainstRegistry(valid({ match: "not_a_real_party_slug" }), OPEN)).toEqual({
      ok: false,
      reason: "party-not-in-registry",
    });
  });

  it("rejects an out-of-registry proposition id (single bad id fails the whole submission)", () => {
    expect(checkAgainstRegistry(valid({ propositionIds: [realProp, 99999999] }), OPEN)).toEqual({
      ok: false,
      reason: "proposition-not-in-registry",
    });
  });
});

describe("research intake kill switch (live control plane)", () => {
  it("is OPEN now the global research suspension has been lifted (2026-07-19 sign-off)", () => {
    // The research suspension was lifted with an audited RESTORE record after the two-person
    // Privacy-Act determination (docs/adr/0010), so intake is live again for a valid election.
    expect(researchIntakeOpen("2025")).toBe(true);
    expect(isElectionOpen("2025")).toBe(true);
    expect(registryEntry("2025")!.open).toBe(true);
  });

  it("closes fail-closed when the kill switch reports intake shut (mechanism, via override)", () => {
    // The mechanism is independent of the current live state: when the control plane reports intake
    // closed (a global `research` or per-election suspension, or a tampered plane), an otherwise-valid
    // contribution is rejected as `closed-election`.
    expect(isElectionOpen("2025", { intakeOpen: false })).toBe(false);
    expect(checkAgainstRegistry(valid(), { intakeOpen: false })).toEqual({
      ok: false,
      reason: "closed-election",
    });
  });
});

describe("verifyRegistryIntegrity — signed registry tamper-evidence", () => {
  it("confirms the committed registry's content digest", async () => {
    expect(await verifyRegistryIntegrity()).toBe(true);
  });
});
