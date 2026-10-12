import { describe, expect, it } from "vitest";
import { MAX_AGE_DAYS, verdict } from "./check-postcode-staleness.mjs";

const record = (checkedAt) => ({
  boundaryElection: "2025",
  elections: [{ electionId: "2025" }, { electionId: "next", checkedAt }],
});
const day = (iso, plus = 0) => Date.parse(iso) + plus * 24 * 60 * 60 * 1000;

describe("postcode staleness", () => {
  it("passes within the limit", () => {
    expect(verdict(record("2026-10-12"), day("2026-10-12", MAX_AGE_DAYS)).ok).toBe(true);
  });

  it("fails once checkedAt is older than the limit", () => {
    const result = verdict(record("2026-10-12"), day("2026-10-12", MAX_AGE_DAYS + 1));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Re-check https://www.aec.gov.au/redistributions/");
  });

  it("fails on a missing or future date", () => {
    expect(verdict(record(undefined), day("2026-10-12")).ok).toBe(false);
    expect(verdict(record("2026-12-01"), day("2026-10-12")).ok).toBe(false);
  });

  it("does not need a date for the election fought on the correspondence's boundaries", () => {
    expect(verdict({ boundaryElection: "2025", elections: [{ electionId: "2025" }] }, 0).ok).toBe(
      true,
    );
  });
});
