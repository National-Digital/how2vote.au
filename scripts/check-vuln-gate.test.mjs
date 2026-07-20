import { describe, expect, it } from "vitest";
import { verdict, toAdvisories } from "./check-vuln-gate.mjs";

const NOW = Date.parse("2026-07-15T00:00:00Z");
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — no blocking vulnerabilities", () => {
  it("passes with an empty advisory list", () => {
    expect(verdict({ advisories: [], riskAcceptances: [], now: NOW }).ok).toBe(true);
  });

  it("ignores low/moderate advisories", () => {
    const advisories = [
      { ghsa: "GHSA-a", severity: "low", module: "x" },
      { ghsa: "GHSA-b", severity: "moderate", module: "y" },
    ];
    expect(verdict({ advisories, riskAcceptances: [], now: NOW }).ok).toBe(true);
  });
});

describe("verdict — blocks high/critical without acceptance (fail-closed)", () => {
  it("blocks a high advisory with no acceptance", () => {
    const advisories = [{ ghsa: "GHSA-h", severity: "high", module: "pkg" }];
    const res = verdict({ advisories, riskAcceptances: [], now: NOW });
    expect(res.ok).toBe(false);
    expect(hasError(res, "no signed risk acceptance")).toBe(true);
  });

  it("blocks a critical advisory with no acceptance", () => {
    const advisories = [{ ghsa: "GHSA-c", severity: "critical", module: "pkg" }];
    expect(verdict({ advisories, riskAcceptances: [], now: NOW }).ok).toBe(false);
  });

  it("fails closed on a malformed advisories input", () => {
    expect(verdict({ riskAcceptances: [], now: NOW }).ok).toBe(false);
  });
});

describe("verdict — signed, time-limited acceptance", () => {
  const advisory = { ghsa: "GHSA-h", severity: "high", module: "pkg" };
  const acceptance = {
    advisory: "GHSA-h",
    acceptedBy: "Test Reviewer",
    justification: "not reachable in a static build; upstream fix pending",
    acceptedAt: "2026-07-10",
    expiresAt: "2026-10-10",
  };

  it("allows a high advisory covered by a current acceptance", () => {
    expect(verdict({ advisories: [advisory], riskAcceptances: [acceptance], now: NOW }).ok).toBe(
      true,
    );
  });

  it("blocks when the acceptance has expired", () => {
    const expired = { ...acceptance, expiresAt: "2026-01-01" };
    const res = verdict({ advisories: [advisory], riskAcceptances: [expired], now: NOW });
    expect(res.ok).toBe(false);
    expect(hasError(res, "expired at 2026-01-01")).toBe(true);
  });

  it("blocks when the acceptance is unsigned", () => {
    const unsigned = { ...acceptance, acceptedBy: "" };
    expect(
      hasError(
        verdict({ advisories: [advisory], riskAcceptances: [unsigned], now: NOW }),
        "unsigned",
      ),
    ).toBe(true);
  });

  it("blocks when the acceptance covers a different advisory", () => {
    const other = { ...acceptance, advisory: "GHSA-other" };
    expect(verdict({ advisories: [advisory], riskAcceptances: [other], now: NOW }).ok).toBe(false);
  });

  it("matches an acceptance by module name", () => {
    const byModule = { ...acceptance, advisory: "pkg" };
    expect(verdict({ advisories: [advisory], riskAcceptances: [byModule], now: NOW }).ok).toBe(
      true,
    );
  });
});

describe("toAdvisories — fail closed on format drift", () => {
  it("returns [] for a clean audit (empty advisories map)", () => {
    expect(
      toAdvisories({ advisories: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } }),
    ).toEqual([]);
  });
  it("maps advisories from the recognised shape", () => {
    const out = toAdvisories({
      advisories: {
        1: { id: 1, github_advisory_id: "GHSA-x", module_name: "m", severity: "high", title: "t" },
      },
    });
    expect(out).toEqual([{ id: 1, ghsa: "GHSA-x", module: "m", severity: "high", title: "t" }]);
  });
  it("THROWS on an unrecognised shape (no advisories, no summary)", () => {
    expect(() => toAdvisories({ something: "else" })).toThrow(/unrecognised format/);
  });
  it("THROWS when the summary counts vulnerabilities but no advisories are enumerable", () => {
    expect(() => toAdvisories({ metadata: { vulnerabilities: { high: 2 } } })).toThrow(
      /fail closed/,
    );
  });
});
