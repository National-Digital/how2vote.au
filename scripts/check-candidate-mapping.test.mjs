import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict, canonicalHash, partiesCounts } from "./check-candidate-mapping.mjs";

const HASH = "a".repeat(64);
const COUNTS = { parties: 14, independents: 7, noRecordNames: 41 };

function rec(over = {}) {
  return {
    schemaVersion: 1,
    electionId: "2019",
    partiesSourceHash: HASH,
    coverage: { ...COUNTS },
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    ...over,
  };
}
const entry = (over = {}, partiesHash = HASH, counts = COUNTS) => ({
  electionId: "2019",
  mapping: rec(over),
  partiesHash,
  counts,
});
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed records", () => {
  it("all three elections' mapping records are well-formed and hash-current", () => {
    const root = new URL("../", import.meta.url);
    for (const id of ["2019", "2022", "2025"]) {
      const mapping = JSON.parse(
        readFileSync(new URL(`data/source/${id}/candidate-mapping.json`, root), "utf8"),
      );
      const parties = JSON.parse(
        readFileSync(new URL(`data/source/${id}/parties.json`, root), "utf8"),
      );
      const res = verdict([
        {
          electionId: id,
          mapping,
          partiesHash: canonicalHash(parties),
          counts: partiesCounts(parties),
        },
      ]);
      expect(res.errors, `${id}`).toEqual([]);
    }
  });
});

describe("verdict — structure + stale detection", () => {
  it("passes a well-formed pending record", () => {
    expect(verdict([entry()]).ok).toBe(true);
  });

  it("fails when partiesSourceHash does not match parties.json (stale mapping)", () => {
    expect(hasError(verdict([entry({}, "b".repeat(64))]), "stale")).toBe(true);
  });

  it("fails a non-sha256 hash / bad status", () => {
    expect(hasError(verdict([entry({ partiesSourceHash: "x" })]), "sha256")).toBe(true);
    expect(hasError(verdict([entry({ status: "done" })]), "status must be one of")).toBe(true);
  });

  it("fails when declared coverage disagrees with parties.json counts", () => {
    const res = verdict([entry({ coverage: { parties: 99, independents: 7, noRecordNames: 41 } })]);
    expect(hasError(res, "coverage.parties (99) != parties.json (14)")).toBe(true);
  });
});

describe("verdict — accountable-owner control on approved records", () => {
  it("requires a reviewer + reviewedAt when approved (fails closed if unapproved-but-claimed)", () => {
    const missing = verdict([entry({ status: "approved" })]);
    expect(missing.ok).toBe(false);
    expect(hasError(missing, "needs a reviewer")).toBe(true);
    expect(hasError(missing, "needs a valid reviewedAt")).toBe(true);

    const ok = verdict([entry({ status: "approved", reviewer: "Ada", reviewedAt: "2026-07-16" })]);
    expect(ok.ok).toBe(true);
  });
});
