import { describe, expect, it } from "vitest";
import {
  indexControlRegister,
  renderRegistry,
  resolveClaim,
  serialise,
} from "./generate-privacy-claims.mjs";

const NOW = Date.parse("2026-07-16");
const FUTURE = "2027-07-16";
const PAST = "2020-01-01";

const controlRegister = {
  controls: [
    {
      id: "control-21",
      tests: [
        { id: "t-pass", status: "passing" },
        { id: "t-planned", status: "planned" },
      ],
      evidence: [
        { id: "EV-OK", status: "pending" },
        { id: "EV-DEAD", status: "expired" },
      ],
    },
  ],
};

const backedClaim = {
  id: "PC-OK",
  substantiatedWording: "Strong claim.",
  fallbackWording: "Hedged claim.",
  tests: ["t-pass"],
  evidence: ["EV-OK"],
  approver: "Someone",
  approvedAt: "2026-07-16",
  expiresAt: FUTURE,
};

describe("resolveClaim (fail-closed to fallback)", () => {
  const ctx = () => {
    const { testStatus, evidenceStatus } = indexControlRegister(controlRegister);
    return { now: NOW, testStatus, evidenceStatus };
  };

  it("uses the substantiated wording when backed and current", () => {
    const r = resolveClaim(backedClaim, ctx());
    expect(r.backed).toBe(true);
    expect(r.wording).toBe("Strong claim.");
  });

  it("falls back when the approval is expired", () => {
    const r = resolveClaim({ ...backedClaim, expiresAt: PAST }, ctx());
    expect(r.backed).toBe(false);
    expect(r.wording).toBe("Hedged claim.");
  });

  it("falls back when a referenced test is not passing", () => {
    const r = resolveClaim({ ...backedClaim, tests: ["t-planned"] }, ctx());
    expect(r.backed).toBe(false);
    expect(r.wording).toBe("Hedged claim.");
  });

  it("falls back when a referenced test is unknown (orphan)", () => {
    const r = resolveClaim({ ...backedClaim, tests: ["t-nope"] }, ctx());
    expect(r.backed).toBe(false);
  });

  it("falls back when referenced evidence is expired (pending is fine)", () => {
    expect(resolveClaim({ ...backedClaim, evidence: ["EV-DEAD"] }, ctx()).backed).toBe(false);
    expect(resolveClaim({ ...backedClaim, evidence: ["EV-OK"] }, ctx()).backed).toBe(true);
  });
});

describe("renderRegistry", () => {
  it("sorts claims by id and reports backing", () => {
    const register = {
      schemaVersion: 1,
      claims: [
        { ...backedClaim, id: "PC-Z" },
        { ...backedClaim, id: "PC-A", expiresAt: PAST },
      ],
    };
    const out = renderRegistry(register, controlRegister, { now: NOW });
    expect(out.claims.map((c) => c.id)).toEqual(["PC-A", "PC-Z"]);
    expect(out.claims[0].backed).toBe(false); // PC-A expired
    expect(out.claims[1].backed).toBe(true);
    expect(serialise(out).endsWith("\n")).toBe(true);
  });
});
