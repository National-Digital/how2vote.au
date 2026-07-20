import { describe, expect, it } from "vitest";
import {
  verdict,
  verifyAlert,
  verifyConsentCentralisation,
  verifyRegistry,
  verifyStatsWiring,
} from "./check-research-integrity.mjs";
import { buildRegistryFile } from "./generate-research-registry.mjs";

const goodRegistry = buildRegistryFile([{ id: "2025" }], {
  2025: { parties: { parties: [{ key: "a" }] }, questions: { questions: [{ id: 5 }] } },
});

describe("verifyRegistry — signed registry structure + tamper-evidence", () => {
  it("accepts a well-formed registry whose digest matches its body", () => {
    expect(verifyRegistry(goodRegistry)).toEqual([]);
  });

  it("flags a tampered body (digest no longer matches)", () => {
    const tampered = {
      ...goodRegistry,
      elections: { 2025: { parties: ["a", "INJECTED"], propositionIds: [5] } },
    };
    const errors = verifyRegistry(tampered);
    expect(errors.some((e) => e.includes("integrity digest does not match"))).toBe(true);
  });

  it("flags a bad integrity tag and malformed entries", () => {
    expect(verifyRegistry({ version: 1, integrity: "nope", elections: {} }).length).toBeGreaterThan(
      0,
    );
    expect(
      verifyRegistry({
        version: 1,
        integrity: "sha256-" + "a".repeat(64),
        elections: { 2025: { parties: [1], propositionIds: ["x"] } },
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("verifyAlert — integrity-alert schema", () => {
  it("accepts an inactive alert", () => {
    expect(verifyAlert({ schemaVersion: 1, active: false })).toEqual([]);
  });

  it("requires attribution when active", () => {
    const errors = verifyAlert({ schemaVersion: 1, active: true });
    expect(errors.some((e) => e.includes("reason"))).toBe(true);
    expect(errors.some((e) => e.includes("declaredBy"))).toBe(true);
    expect(errors.some((e) => e.includes("declaredAt"))).toBe(true);
  });

  it("accepts a fully-attributed active alert", () => {
    expect(
      verifyAlert({
        schemaVersion: 1,
        active: true,
        reason: "poisoning",
        declaredBy: "privacy-eng",
        declaredAt: "2026-07-16",
      }),
    ).toEqual([]);
  });

  it("rejects a wrong schema version / non-boolean active", () => {
    expect(verifyAlert({ schemaVersion: 2, active: false }).length).toBeGreaterThan(0);
    expect(verifyAlert({ schemaVersion: 1, active: "no" }).length).toBeGreaterThan(0);
  });
});

describe("verifyStatsWiring — fail-closed gate cannot be silently removed", () => {
  it("passes when the generator reads + evaluates the alert and exits", () => {
    const src = `readJson("docs/research/integrity-alert.json"); evaluateIntegrityAlert(raw); process.exit(1)`;
    expect(verifyStatsWiring(src)).toEqual([]);
  });

  it("fails when any part of the wiring is missing", () => {
    expect(verifyStatsWiring("nothing here").length).toBe(3);
    expect(verifyStatsWiring("").length).toBeGreaterThan(0);
  });
});

describe("verifyConsentCentralisation — single definition site", () => {
  const expected = "apps/web/src/lib/research/consent.ts";
  it("accepts exactly the one canonical definer", () => {
    expect(verifyConsentCentralisation([expected])).toEqual([]);
  });
  it("rejects zero or duplicate definers", () => {
    expect(verifyConsentCentralisation([]).length).toBe(1);
    expect(verifyConsentCentralisation([expected, "apps/web/src/lib/survey.ts"]).length).toBe(1);
  });
});

describe("verdict — combined", () => {
  it("is ok for a fully-valid input set", () => {
    const result = verdict({
      registry: goodRegistry,
      alert: { schemaVersion: 1, active: false },
      statsSource: `integrity-alert.json evaluateIntegrityAlert process.exit(1)`,
      consentDefiners: ["apps/web/src/lib/research/consent.ts"],
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });
});
