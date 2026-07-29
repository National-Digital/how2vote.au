import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_REQUEST_READS,
  RESEARCH_ENDPOINTS,
  RESEARCH_TRANSPORT_POLICY,
  TRANSMITTABLE_FIELDS,
  projectAllowlisted,
  researchEndpointUrl,
  transportInit,
  verifyTransportInit,
} from "./transport-policy";

describe("researchEndpointUrl (per-channel target)", () => {
  const SITE = "https://how2vote.au";
  it("web PWA: relative same-origin paths (connect-src 'self')", () => {
    expect(researchEndpointUrl("research")).toBe("/api/research");
    expect(researchEndpointUrl("geography", "")).toBe("/api/research/geography");
    expect(researchEndpointUrl("token", "")).toBe("/api/research/token");
  });
  it("native shells: absolute canonical origin (WebView origin is not how2vote.au)", () => {
    expect(researchEndpointUrl("research", SITE)).toBe("https://how2vote.au/api/research");
    expect(researchEndpointUrl("geography", SITE)).toBe(
      "https://how2vote.au/api/research/geography",
    );
    expect(researchEndpointUrl("token", SITE)).toBe("https://how2vote.au/api/research/token");
  });
  it("the same relative literal underlies both, so infra route matching still holds", () => {
    const names = ["research", "geography", "token"] as const;
    for (const key of names) {
      expect(researchEndpointUrl(key, SITE)).toBe(`${SITE}${RESEARCH_ENDPOINTS[key]}`);
    }
  });
});

describe("research transport policy", () => {
  it("declares the fail-closed invariants", () => {
    expect(RESEARCH_TRANSPORT_POLICY.tlsOnly).toBe(true);
    expect(RESEARCH_TRANSPORT_POLICY.cache).toBe("no-store");
    expect(RESEARCH_TRANSPORT_POLICY.credentials).toBe("omit");
    expect(FORBIDDEN_REQUEST_READS).toContain("CF-Connecting-IP");
    expect(FORBIDDEN_REQUEST_READS).toContain("User-Agent");
  });

  it("projects the detailed record to allowlisted fields only", () => {
    const projected = projectAllowlisted("research", {
      schemaVersion: 1,
      electionId: "2025",
      match: "australian_labor_party",
      propositions: [{ id: 1, stance: "agree" }],
      demographics: { age: "25–34" },
      consentVersion: "2026-07.2",
      dataVersion: "d",
      appVersion: "a",
      // Everything below must be stripped — the raw vector / weights / electorate / identifiers.
      answers: { 1: 5 },
      points: [5, 4, 3],
      important: [true, false],
      electorate: "Bean",
      ip: "203.0.113.9",
    });
    expect(projected).not.toHaveProperty("answers");
    expect(projected).not.toHaveProperty("points");
    expect(projected).not.toHaveProperty("important");
    expect(projected).not.toHaveProperty("electorate");
    expect(projected).not.toHaveProperty("ip");
    // The device-derived match + stances DO travel (accurate wording: derived stances, not raw labels).
    expect(projected.match).toBe("australian_labor_party");
    expect(projected.propositions).toEqual([{ id: 1, stance: "agree" }]);
  });

  it("strips a raw label/weight smuggled onto a proposition entry", () => {
    const projected = projectAllowlisted("research", {
      schemaVersion: 1,
      propositions: [
        { id: 7, stance: "disagree", label: "Strongly disagree", points: 1, weight: 10 },
      ],
    });
    expect(projected.propositions).toEqual([{ id: 7, stance: "disagree" }]);
  });

  it("projects the geography ping to election + electorate + token only", () => {
    const projected = projectAllowlisted("geography", {
      schemaVersion: 1,
      electionId: "2025",
      electorate: "Bean",
      token: "t",
      match: "x",
      demographics: { age: "25–34" },
    });
    expect(Object.keys(projected).sort()).toEqual([
      "electionId",
      "electorate",
      "schemaVersion",
      "token",
    ]);
    expect(projected).not.toHaveProperty("match");
    expect(projected).not.toHaveProperty("demographics");
  });

  it("drops undefined values (an omitted optional token is not serialised)", () => {
    const projected = projectAllowlisted("research", {
      schemaVersion: 1,
      electionId: "2025",
      token: undefined,
    });
    expect(projected).not.toHaveProperty("token");
  });

  it("every allowlist is a non-empty set of unique keys per endpoint", () => {
    for (const name of Object.keys(RESEARCH_ENDPOINTS) as (keyof typeof RESEARCH_ENDPOINTS)[]) {
      const fields = TRANSMITTABLE_FIELDS[name];
      expect(fields.length).toBeGreaterThan(0);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it("transportInit enforces no-store, no credentials and an allowlisted body", () => {
    const init = transportInit("research", {
      schemaVersion: 1,
      electionId: "2025",
      answers: { 1: 5 },
    });
    expect(verifyTransportInit(init).ok).toBe(true);
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty("answers");
    expect(body.electionId).toBe("2025");
  });

  it("verifyTransportInit fails a cached or credentialed init", () => {
    expect(verifyTransportInit(undefined).ok).toBe(false);
    expect(verifyTransportInit({ method: "POST", cache: "default", credentials: "omit" }).ok).toBe(
      false,
    );
    expect(
      verifyTransportInit({ method: "POST", cache: "no-store", credentials: "include" }).ok,
    ).toBe(false);
  });
});
