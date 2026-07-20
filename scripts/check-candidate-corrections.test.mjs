import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-candidate-corrections.mjs";

const KEYS = { 2025: ["australian_greens", "australian_labor_party"], 2022: ["liberal_party"] };
const entry = (over = {}) => ({
  electionId: "2025",
  partyKey: "australian_greens",
  reason: "Party disputes the mapping pending review.",
  flaggedAt: "2026-07-16",
  ...over,
});
const run = (list, keys = KEYS) =>
  verdict({ suspensions: { schemaVersion: 1, suspensions: list }, partyKeysByElection: keys });
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed suspension list", () => {
  it("the committed suspensions.json is well-formed against the real registries", () => {
    const root = new URL("../", import.meta.url);
    const suspensions = JSON.parse(
      readFileSync(new URL("data/corrections/suspensions.json", root), "utf8"),
    );
    const partyKeysByElection = {};
    for (const id of ["2019", "2022", "2025"]) {
      const parties = JSON.parse(
        readFileSync(new URL(`data/source/${id}/parties.json`, root), "utf8"),
      );
      partyKeysByElection[id] = parties.parties.map((p) => p.key);
    }
    expect(verdict({ suspensions, partyKeysByElection }).errors).toEqual([]);
  });
});

describe("verdict — structure + referential integrity", () => {
  it("an empty list is valid (nothing flagged)", () => {
    expect(run([]).ok).toBe(true);
  });

  it("passes a well-formed suspension pointing at a real party", () => {
    expect(run([entry()]).ok).toBe(true);
  });

  it("fails a suspension for a party that does not exist (would silently do nothing)", () => {
    expect(hasError(run([entry({ partyKey: "not_a_real_party" })]), "does not exist")).toBe(true);
  });

  it("fails an unknown election", () => {
    expect(hasError(run([entry({ electionId: "1999" })]), "unknown electionId")).toBe(true);
  });

  it("fails a missing reason or flag date", () => {
    expect(hasError(run([entry({ reason: "" })]), "missing reason")).toBe(true);
    expect(hasError(run([entry({ flaggedAt: "nope" })]), "flaggedAt must be an ISO date")).toBe(
      true,
    );
  });

  it("fails a non-object schema", () => {
    expect(verdict({ suspensions: null, partyKeysByElection: KEYS }).ok).toBe(false);
    expect(
      hasError(
        verdict({ suspensions: { schemaVersion: 1 }, partyKeysByElection: KEYS }),
        "must be an array",
      ),
    ).toBe(true);
  });
});
