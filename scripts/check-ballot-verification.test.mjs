import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict, canonicalHash } from "./check-ballot-verification.mjs";

const HASH = "a".repeat(64);

/** A well-formed pending record. */
function rec(over = {}) {
  return {
    schemaVersion: 1,
    electionId: "2025",
    ballotsSourceHash: HASH,
    coverage: { houseElectorates: 150, senateJurisdictions: 8 },
    status: "pending",
    reviewers: { primary: null, primaryAt: null, second: null, secondAt: null },
    discrepancyRef: null,
    ...over,
  };
}

const entry = (
  over = {},
  ballotsHash = HASH,
  ballotsCounts = { houseElectorates: 150, senateJurisdictions: 8 },
) => ({
  electionId: "2025",
  verification: rec(over),
  ballotsHash,
  ballotsCounts,
});
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed records", () => {
  it("all three elections' records are well-formed and hash-current", () => {
    const root = new URL("../", import.meta.url);
    for (const id of ["2019", "2022", "2025"]) {
      const verification = JSON.parse(
        readFileSync(new URL(`data/source/${id}/ballot-verification.json`, root), "utf8"),
      );
      const ballots = JSON.parse(
        readFileSync(new URL(`data/source/${id}/ballots.json`, root), "utf8"),
      );
      const res = verdict([{ electionId: id, verification, ballotsHash: canonicalHash(ballots) }]);
      expect(res.errors, `${id}`).toEqual([]);
    }
  });
});

describe("verdict — structure + stale detection", () => {
  it("passes a well-formed pending record", () => {
    expect(verdict([entry()]).ok).toBe(true);
  });

  it("fails when ballotsSourceHash does not match ballots.json (stale)", () => {
    expect(hasError(verdict([entry({}, "b".repeat(64))]), "stale")).toBe(true);
  });

  it("fails a non-sha256 hash / bad coverage / bad status", () => {
    expect(hasError(verdict([entry({ ballotsSourceHash: "x" })]), "sha256")).toBe(true);
    expect(
      hasError(
        verdict([entry({ coverage: { houseElectorates: 0, senateJurisdictions: 8 } })]),
        "houseElectorates",
      ),
    ).toBe(true);
    expect(hasError(verdict([entry({ status: "done" })]), "status must be one of")).toBe(true);
  });

  it("fails when declared coverage disagrees with the actual ballots.json counts", () => {
    // Well-formed record + matching hash, but the recorded counts are wrong vs the ballots.
    const res = verdict([
      entry({ coverage: { houseElectorates: 151, senateJurisdictions: 8 } }, HASH, {
        houseElectorates: 150,
        senateJurisdictions: 8,
      }),
    ]);
    expect(hasError(res, "coverage.houseElectorates (151) != ballots.json (150)")).toBe(true);

    const senate = verdict([
      entry({ coverage: { houseElectorates: 150, senateJurisdictions: 6 } }, HASH, {
        houseElectorates: 150,
        senateJurisdictions: 8,
      }),
    ]);
    expect(hasError(senate, "coverage.senateJurisdictions (6) != ballots.json (8)")).toBe(true);
  });
});

describe("verdict — two-person control on released records", () => {
  it("requires two distinct reviewers with timestamps when released", () => {
    const missing = verdict([entry({ status: "released" })]);
    expect(missing.ok).toBe(false);
    expect(hasError(missing, "primary reviewer")).toBe(true);

    const sameReviewer = verdict([
      entry({
        status: "released",
        reviewers: {
          primary: "Ada",
          primaryAt: "2026-07-15",
          second: "Ada",
          secondAt: "2026-07-16",
        },
      }),
    ]);
    expect(hasError(sameReviewer, "different people")).toBe(true);

    const ok = verdict([
      entry({
        status: "released",
        reviewers: {
          primary: "Ada",
          primaryAt: "2026-07-15",
          second: "Grace",
          secondAt: "2026-07-16",
        },
      }),
    ]);
    expect(ok.ok).toBe(true);
  });
});
