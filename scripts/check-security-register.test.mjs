import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-security-register.mjs";

const REAL = JSON.parse(
  readFileSync(new URL("../docs/legal/security-register.json", import.meta.url), "utf8"),
);
const clone = () => JSON.parse(JSON.stringify(REAL));
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));
// Far-future / far-past for deterministic expiry tests.
const NOW = Date.parse("2026-07-15T00:00:00Z");

describe("verdict — the real committed register", () => {
  it("passes", () => {
    const res = verdict(REAL, { now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("verdict — structural failures", () => {
  it("rejects a non-object", () => {
    expect(verdict(null).ok).toBe(false);
    expect(verdict([]).ok).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    const r = clone();
    r.schemaVersion = 2;
    expect(hasError(verdict(r, { now: NOW }), "schemaVersion")).toBe(true);
  });

  it("requires the vuln policy to block both high and critical", () => {
    const r = clone();
    r.vulnerabilityPolicy.blockSeverities = ["high"];
    expect(hasError(verdict(r, { now: NOW }), "high and critical")).toBe(true);
  });

  it("requires a signed risk acceptance policy", () => {
    const r = clone();
    r.vulnerabilityPolicy.requiresSignedRiskAcceptance = false;
    expect(hasError(verdict(r, { now: NOW }), "requiresSignedRiskAcceptance")).toBe(true);
  });

  it("rejects an empty forbidden-log-field list", () => {
    const r = clone();
    r.forbiddenLogFields = [];
    expect(hasError(verdict(r, { now: NOW }), "forbiddenLogFields")).toBe(true);
  });

  it("rejects an empty required-response-header list", () => {
    const r = clone();
    r.requiredResponseHeaders = [];
    expect(hasError(verdict(r, { now: NOW }), "requiredResponseHeaders")).toBe(true);
  });

  it("flags a duplicate control id", () => {
    const r = clone();
    r.controls.push(JSON.parse(JSON.stringify(r.controls[0])));
    expect(hasError(verdict(r, { now: NOW }), "declared 2 times")).toBe(true);
  });
});

describe("verdict — evidence fail-closed", () => {
  it("fails on expired evidence status", () => {
    const r = clone();
    r.controls[0].evidence.status = "expired";
    expect(hasError(verdict(r, { now: NOW }), "expired")).toBe(true);
  });

  it("requires reviewer + dates for current evidence", () => {
    const r = clone();
    r.controls[0].evidence = { id: "EV-X", description: "d", status: "current" };
    const res = verdict(r, { now: NOW });
    expect(hasError(res, "needs a reviewer")).toBe(true);
    expect(hasError(res, "valid approvedAt")).toBe(true);
    expect(hasError(res, "valid expiresAt")).toBe(true);
  });

  it("fails current evidence whose expiry is in the past", () => {
    const r = clone();
    r.controls[0].evidence = {
      id: "EV-X",
      description: "d",
      status: "current",
      reviewer: "R",
      approvedAt: "2025-01-01",
      expiresAt: "2025-06-01",
    };
    expect(hasError(verdict(r, { now: NOW }), "expired at 2025-06-01")).toBe(true);
  });

  it("accepts current evidence with a future expiry", () => {
    const r = clone();
    r.controls[0].evidence = {
      id: "EV-X",
      description: "d",
      status: "current",
      reviewer: "R",
      approvedAt: "2026-07-01",
      expiresAt: "2027-07-01",
    };
    expect(verdict(r, { now: NOW }).ok).toBe(true);
  });
});

describe("verdict — implemented ratchet", () => {
  it("blocks an implemented control that has no enforcer and only pending evidence", () => {
    const r = clone();
    const c = r.controls.find((x) => x.id === "SEC-MFA"); // MFA has no code enforcer
    c.status = "implemented";
    // Only pending external evidence — the ratchet must refuse to let it claim "implemented".
    c.evidence = { id: "EV-MFA-ENFORCEMENT", description: "d", status: "pending" };
    expect(hasError(verdict(r, { now: NOW }), "not pending external evidence alone")).toBe(true);
  });
});

describe("verdict — risk acceptances", () => {
  it("requires each acceptance to be well-formed", () => {
    const r = clone();
    r.riskAcceptances = [{ id: "RA-1" }];
    const res = verdict(r, { now: NOW });
    expect(hasError(res, "missing advisory")).toBe(true);
    expect(hasError(res, "missing acceptedBy")).toBe(true);
    expect(hasError(res, "acceptedAt")).toBe(true);
    expect(hasError(res, "expiresAt")).toBe(true);
  });

  it("accepts a well-formed acceptance", () => {
    const r = clone();
    r.riskAcceptances = [
      {
        id: "RA-1",
        advisory: "GHSA-xxxx",
        acceptedBy: "Test Reviewer",
        justification: "no exploit path in a static build",
        acceptedAt: "2026-07-15",
        expiresAt: "2026-10-15",
      },
    ];
    expect(verdict(r, { now: NOW }).ok).toBe(true);
  });
});
