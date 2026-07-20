import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-candidate-minimisation.mjs";

const house = (over = {}) => ({
  state: "ACT",
  candidate: "DOE, Jane",
  party: "The Greens",
  position: 1,
  division: "Bean",
  ...over,
});
const senate = (over = {}) => ({
  state: "ACT",
  candidate: "DOE, Jane",
  party: "The Greens",
  position: 1,
  group: "A",
  ...over,
});
const ballots = (over = {}) => ({ house: [house()], senate: [senate()], ...over });
const entry = (over = {}) => [{ electionId: "2025", ballots: ballots(over) }];
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed ballots", () => {
  it("every election's ballots.json is minimised (no personal-data fields)", () => {
    const root = new URL("../", import.meta.url);
    for (const id of ["2019", "2022", "2025"]) {
      const b = JSON.parse(readFileSync(new URL(`data/source/${id}/ballots.json`, root), "utf8"));
      const res = verdict([{ electionId: id, ballots: b }]);
      expect(res.errors, `${id}`).toEqual([]);
    }
  });
});

describe("verdict — allowlist + minimisation", () => {
  it("passes a clean minimised record", () => {
    expect(verdict(entry()).ok).toBe(true);
  });

  it("fails a home address field", () => {
    expect(hasError(verdict(entry({ house: [house({ address: "1 Main St" })] })), "address")).toBe(
      true,
    );
  });

  it("fails a date-of-birth field", () => {
    expect(hasError(verdict(entry({ house: [house({ dob: "1980-01-01" })] })), "dob")).toBe(true);
    expect(hasError(verdict(entry({ senate: [senate({ dateOfBirth: "1980" })] })), "birth")).toBe(
      true,
    );
  });

  it("fails personal contact fields", () => {
    expect(hasError(verdict(entry({ house: [house({ phone: "0400000000" })] })), "phone")).toBe(
      true,
    );
    expect(hasError(verdict(entry({ house: [house({ email: "a@b.co" })] })), "email")).toBe(true);
  });

  it("fails any field outside the strict allowlist", () => {
    expect(
      hasError(verdict(entry({ house: [house({ notes: "anything" })] })), "not on allowlist"),
    ).toBe(true);
  });

  it("fails an email or phone-shaped VALUE even in an allowed field", () => {
    expect(
      hasError(verdict(entry({ house: [house({ candidate: "a@b.com" })] })), "email address"),
    ).toBe(true);
    expect(
      hasError(verdict(entry({ house: [house({ party: "call 0400 000 000" })] })), "phone number"),
    ).toBe(true);
  });

  it("keeps House/Senate key sets distinct (group on House, division on Senate both fail)", () => {
    expect(hasError(verdict(entry({ house: [house({ group: "A" })] })), "not on allowlist")).toBe(
      true,
    );
    expect(
      hasError(verdict(entry({ senate: [senate({ division: "Bean" })] })), "not on allowlist"),
    ).toBe(true);
  });
});
