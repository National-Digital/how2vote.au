import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict, canonicalHash } from "./check-aec-provenance.mjs";

const HASH = "a".repeat(64);
const RIGHTS = ["tvfy-odbl", "aec-candidate-data", "aec-boundary-spatial", "how2vote-aggregates"];

/** A well-formed source record. */
function source(over = {}) {
  return {
    id: "house-nominations",
    title: "House candidates",
    publisher: "Australian Electoral Commission",
    url: "https://www.aec.gov.au/election/candidates.htm",
    publishedAt: "2025-04-11",
    retrievedAt: null,
    sourceSha256: null,
    rawPath: "data/raw/aec/2025/house-nominations.csv",
    rawRetained: false,
    parserVersion: "aec.ts v1",
    status: "pending",
    reviewer: null,
    reviewedAt: null,
    ...over,
  };
}

function record(over = {}) {
  return {
    schemaVersion: 1,
    electionId: "2025",
    rightsClass: "aec-candidate-data",
    recordedAt: "2026-07-15",
    outputHash: HASH,
    coverage: {
      houseCandidates: 10,
      senateCandidates: 5,
      houseElectorates: 3,
      senateJurisdictions: 8,
      electorates: 3,
    },
    sources: [
      source({ id: "house-nominations" }),
      source({ id: "senate-nominations", title: "Senate" }),
      source({ id: "electorates", title: "Electorates" }),
    ],
    ...over,
  };
}

const entry = (over = {}, extra = {}) => ({
  electionId: "2025",
  record: record(over),
  ballotsHash: HASH,
  rightsClassIds: RIGHTS,
  ...extra,
});
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed records", () => {
  it("all three elections' AEC provenance records are well-formed and hash-current", () => {
    const root = new URL("../", import.meta.url);
    const rights = JSON.parse(
      readFileSync(new URL("data/rights/rights-classes.json", root), "utf8"),
    );
    const rightsClassIds = rights.rightsClasses.map((c) => c.id);
    const elections = JSON.parse(readFileSync(new URL("data/dist/elections.json", root), "utf8"));
    const closeById = Object.fromEntries(
      elections.map((e) => [e.id, String(e.timetable?.closeOfNominations ?? "").slice(0, 10)]),
    );
    for (const id of ["2019", "2022", "2025"]) {
      const rec = JSON.parse(
        readFileSync(new URL(`data/source/${id}/aec-sources.json`, root), "utf8"),
      );
      const ballots = JSON.parse(
        readFileSync(new URL(`data/source/${id}/ballots.json`, root), "utf8"),
      );
      const ballotsCoverage = {
        houseCandidates: ballots.house.length,
        senateCandidates: ballots.senate.length,
        houseElectorates: new Set(ballots.house.map((r) => r.division)).size,
        senateJurisdictions: new Set(ballots.senate.map((r) => r.state)).size,
        electorates: ballots.electorates.length,
      };
      const res = verdict([
        {
          electionId: id,
          record: rec,
          ballotsHash: canonicalHash(ballots),
          ballotsCoverage,
          rightsClassIds,
          minPublishedAt: closeById[id],
        },
      ]);
      expect(res.errors, `${id}`).toEqual([]);
    }
  });
});

describe("verdict — structure", () => {
  it("passes a well-formed pending record", () => {
    expect(verdict([entry()]).ok).toBe(true);
  });

  it("fails a rightsClass not in the rights register", () => {
    expect(hasError(verdict([entry({ rightsClass: "ghost" })]), "is not defined")).toBe(true);
  });

  it("fails a stale outputHash", () => {
    expect(hasError(verdict([entry({}, { ballotsHash: "b".repeat(64) })]), "stale")).toBe(true);
  });

  it("fails a coverage mismatch against ballots.json", () => {
    const res = verdict([
      entry(
        {},
        {
          ballotsCoverage: {
            houseCandidates: 999,
            senateCandidates: 5,
            houseElectorates: 3,
            senateJurisdictions: 8,
            electorates: 3,
          },
        },
      ),
    ]);
    expect(hasError(res, "coverage.houseCandidates (10) != ballots.json (999)")).toBe(true);
  });

  it("fails a missing required source", () => {
    const r = record();
    r.sources = r.sources.filter((s) => s.id !== "electorates");
    expect(hasError(verdict([entry(r)]), 'required source "electorates" is missing')).toBe(true);
  });

  it("fails a retrievedAt before publishedAt", () => {
    const r = record();
    r.sources[0].retrievedAt = "2020-01-01";
    expect(hasError(verdict([entry(r)]), "retrievedAt is before publishedAt")).toBe(true);
  });

  it("fails a non-null, non-ISO retrievedAt", () => {
    const r = record();
    r.sources[0].retrievedAt = "soon";
    expect(hasError(verdict([entry(r)]), "retrievedAt must be null or an ISO date")).toBe(true);
  });

  it("fails a missing/invalid recordedAt", () => {
    expect(
      hasError(verdict([entry({ recordedAt: "someday" })]), "recordedAt must be an ISO date"),
    ).toBe(true);
  });

  it("fails a publishedAt that predates close of nominations (wrong-domain date)", () => {
    // dataVersion (2025-03-28) predates close of nominations (2025-04-10) — the exact bug this guards.
    const r = record();
    for (const s of r.sources) s.publishedAt = "2025-03-28";
    const res = verdict([entry(r, { minPublishedAt: "2025-04-10" })]);
    expect(hasError(res, "is before close of nominations")).toBe(true);
  });
});

describe("verdict — verified control", () => {
  it("requires reviewer, review date, retained raw + hash when verified", () => {
    const r = record();
    r.sources[0].status = "verified";
    const res = verdict([entry(r)]);
    expect(res.ok).toBe(false);
    expect(hasError(res, "needs a reviewer")).toBe(true);
    expect(hasError(res, "needs the raw sourceSha256")).toBe(true);
    expect(hasError(res, "must retain the raw source")).toBe(true);
  });

  it("passes a fully-attributed verified source", () => {
    const r = record();
    r.sources[0] = source({
      status: "verified",
      reviewer: "Ada",
      reviewedAt: "2026-07-15",
      retrievedAt: "2026-07-15",
      sourceSha256: "c".repeat(64),
      rawRetained: true,
    });
    expect(verdict([entry(r)]).ok).toBe(true);
  });

  it("fails a verified source that was never retrieved", () => {
    const r = record();
    r.sources[0] = source({
      status: "verified",
      reviewer: "Ada",
      reviewedAt: "2026-07-15",
      retrievedAt: null,
      sourceSha256: "c".repeat(64),
      rawRetained: true,
    });
    expect(hasError(verdict([entry(r)]), "needs a valid retrievedAt")).toBe(true);
  });
});
