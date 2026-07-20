import { describe, expect, it } from "vitest";
import { evaluateIntegrityAlert } from "./integrity.js";

describe("evaluateIntegrityAlert — fail-closed stat-regen suspension", () => {
  it("permits regeneration only for an explicit active:false", () => {
    expect(evaluateIntegrityAlert({ schemaVersion: 1, active: false })).toEqual({
      suspended: false,
      reason: "no active integrity alert",
    });
  });

  it("suspends when an alert is active, echoing scope + reason", () => {
    const verdict = evaluateIntegrityAlert({
      schemaVersion: 1,
      active: true,
      scope: "2025",
      reason: "counter poisoning suspected",
    });
    expect(verdict.suspended).toBe(true);
    expect(verdict.reason).toContain("ACTIVE");
    expect(verdict.reason).toContain("2025");
    expect(verdict.reason).toContain("counter poisoning suspected");
  });

  it("fails closed on an unreadable / malformed alert", () => {
    expect(evaluateIntegrityAlert(null).suspended).toBe(true);
    expect(evaluateIntegrityAlert("nope").suspended).toBe(true);
    expect(evaluateIntegrityAlert([]).suspended).toBe(true);
    expect(evaluateIntegrityAlert(42).suspended).toBe(true);
  });

  it("fails closed when `active` is missing or not a boolean", () => {
    expect(evaluateIntegrityAlert({ schemaVersion: 1 }).suspended).toBe(true);
    expect(evaluateIntegrityAlert({ active: "false" }).suspended).toBe(true);
  });
});
