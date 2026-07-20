import { describe, expect, it } from "vitest";
import { buildPartyResolver } from "./resolve.js";
import { parseDataset, validateDataset } from "./validate.js";
import { ballotsSchema, houseCandidateSchema, senateCandidateSchema } from "./schemas.js";
import type { Dataset } from "./schemas.js";

function fixture(): Dataset {
  return parseDataset({
    questions: {
      schemaVersion: 1,
      dataVersion: "2025-03-28",
      attribution: "They Vote For You (ODbL)",
      questions: [
        {
          id: 32,
          text: "Allow live animal export and place minimal restrictions on it.",
          positions: {
            australian_labor_party: 2,
            australian_greens: 1,
            andrew_wilkie_mp: 1,
            pres: 4,
          },
        },
      ],
    },
    parties: {
      parties: [
        {
          key: "australian_labor_party",
          displayName: "Labor",
          aecName: "Australian Labor Party",
          aliases: ["Labor", "A.L.P."],
          kind: "party",
        },
        {
          key: "australian_greens",
          displayName: "The Greens",
          aecName: "The Greens",
          aliases: ["Queensland Greens"],
          kind: "party",
        },
        {
          key: "andrew_wilkie_mp",
          displayName: "Andrew Wilkie",
          aecName: "WILKIE, Andrew",
          aliases: [],
          kind: "independent",
        },
        { key: "pres", displayName: "President", aecName: null, aliases: [], kind: "office" },
      ],
      merges: [],
      noRecord: ["Some Brand New Party"],
    },
    ballots: {
      schemaVersion: 1,
      dataVersion: "2025-03-28",
      source: "AEC",
      house: [
        { state: "TAS", division: "Clark", candidate: "WILKIE, Andrew", party: "", position: 1 },
        {
          state: "QLD",
          division: "Griffith",
          candidate: "SMITH, Jo",
          party: "Queensland Greens",
          position: 2,
        },
        {
          state: "NSW",
          division: "Reid",
          candidate: "NEW, Pat",
          party: "Some Brand New Party",
          position: 3,
        },
      ],
      senate: [{ state: "TAS", group: "A", candidate: "DOE, Sam", party: "Labor", position: 1 }],
      electorates: [
        { state: "TAS", electorate: "Clark" },
        { state: "QLD", electorate: "Griffith" },
        { state: "NSW", electorate: "Reid" },
      ],
    },
  });
}

describe("party resolver", () => {
  const resolver = buildPartyResolver(fixture().parties.parties);

  it("resolves a party by canonical AEC name", () => {
    expect(resolver.resolve({ party: "Australian Labor Party", candidate: "X" })).toBe(
      "australian_labor_party",
    );
  });
  it("resolves via an alias, case/space-insensitively", () => {
    expect(resolver.resolve({ party: "  a.l.p.  ", candidate: "X" })).toBe(
      "australian_labor_party",
    );
    expect(resolver.resolve({ party: "queensland greens", candidate: "X" })).toBe(
      "australian_greens",
    );
  });
  it("resolves an independent by printed name when party is blank", () => {
    expect(resolver.resolve({ party: "", candidate: "WILKIE, Andrew" })).toBe("andrew_wilkie_mp");
  });
  it("returns null for an unknown party", () => {
    expect(resolver.resolve({ party: "Nonexistent Party", candidate: "X" })).toBeNull();
  });
});

describe("dataset validation gate", () => {
  it("accepts a consistent dataset", () => {
    const report = validateDataset(fixture());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails the build on an unrecognised candidate party string", () => {
    const d = fixture();
    d.ballots.house.push({
      state: "VIC",
      division: "Clark",
      candidate: "OOPS, Al",
      party: "Typo Party",
      position: 4,
    });
    const report = validateDataset(d);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === "unresolved-candidate")).toBe(true);
  });

  it("does not fail for a candidate on the noRecord allowlist", () => {
    // The fixture already includes a "Some Brand New Party" candidate on the allowlist.
    expect(validateDataset(fixture()).ok).toBe(true);
  });

  it("flags a question position key missing from the registry", () => {
    const d = fixture();
    d.questions.questions[0]!.positions["ghost_party"] = 3;
    const report = validateDataset(d);
    expect(report.errors.some((e) => e.code === "unknown-position-key")).toBe(true);
  });

  it("flags a division with no electorate entry", () => {
    const d = fixture();
    d.ballots.house[0]!.division = "Nowhere";
    const report = validateDataset(d);
    expect(report.errors.some((e) => e.code === "division-without-electorate")).toBe(true);
  });
});

describe("candidate schema minimisation", () => {
  // The candidate record is the AEC-declared ballot line and nothing more. `.strict()` means the
  // schema REJECTS any personal-data field (home address, date of birth, personal contact) — the
  // first-line minimisation control, backstopped by scripts/check-candidate-minimisation.mjs on the
  // raw source data.
  const house = { state: "ACT", division: "Bean", candidate: "DOE, Jane", party: "", position: 1 };
  const senate = { state: "ACT", group: "A", candidate: "DOE, Jane", party: "", position: 1 };

  it("accepts a minimised House / Senate ballot line", () => {
    expect(houseCandidateSchema.safeParse(house).success).toBe(true);
    expect(senateCandidateSchema.safeParse(senate).success).toBe(true);
  });

  for (const forbidden of [
    { address: "1 Main St" },
    { dob: "1980-01-01" },
    { dateOfBirth: "1980-01-01" },
    { phone: "0400000000" },
    { email: "jane@example.com" },
    { residentialAddress: "1 Main St" },
  ]) {
    const field = Object.keys(forbidden)[0];
    it(`rejects a candidate carrying "${field}"`, () => {
      expect(houseCandidateSchema.safeParse({ ...house, ...forbidden }).success).toBe(false);
      expect(senateCandidateSchema.safeParse({ ...senate, ...forbidden }).success).toBe(false);
    });
  }
});

describe("party resolver — no name fall-through for a named party", () => {
  const resolver = buildPartyResolver(fixture().parties.parties);
  it("does NOT resolve a named-but-unmapped party via a matching candidate name", () => {
    // "WILKIE, Andrew" is a registry name, but the candidate carries a real (unmapped) party string,
    // so it must stay unresolved rather than silently resolving to the independent by name.
    expect(
      resolver.resolve({ party: "Totally New Party", candidate: "WILKIE, Andrew" }),
    ).toBeNull();
  });
  it("still resolves an explicit Independent by printed name", () => {
    expect(resolver.resolve({ party: "Independent", candidate: "WILKIE, Andrew" })).toBe(
      "andrew_wilkie_mp",
    );
  });
});

describe("dataset validation — new guards", () => {
  it("errors when a senate candidate's state is off the eight-code allowlist", () => {
    const ds = fixture();
    ds.ballots.senate.push({
      state: "XX",
      group: "B",
      candidate: "BAD, State",
      party: "Labor",
      position: 2,
    });
    const report = validateDataset(ds);
    expect(report.errors.some((e) => e.code === "senate-invalid-state")).toBe(true);
  });

  it("errors when a merge's merger resolves from a ballot candidate (wrong direction)", () => {
    const ds = fixture();
    // Labor is on the ballot (senate TAS group A). Making it a MERGER would blank its rows.
    ds.parties.merges.push({ master: "australian_greens", merger: "australian_labor_party" });
    const report = validateDataset(ds);
    expect(report.errors.some((e) => e.code === "merger-on-ballot")).toBe(true);
  });
});

describe("ballot status (provisional / upcoming elections)", () => {
  const drawnCandidates = {
    house: [{ state: "ACT", division: "Bean", candidate: "DOE, Jane", party: "", position: 1 }],
    senate: [{ state: "ACT", group: "A", candidate: "ROE, Sam", party: "", position: 1 }],
    electorates: [{ state: "ACT", electorate: "Bean" }],
  };
  const base = { schemaVersion: 1 as const, dataVersion: "2028-01-15", source: "provisional" };

  it("defaults an omitted status to `drawn` and still requires non-empty ballots", () => {
    // The historical datasets omit ballotStatus and must keep the original min(1) guarantee.
    expect(
      ballotsSchema.safeParse({ ...base, house: [], senate: [], electorates: [] }).success,
    ).toBe(false);
    expect(ballotsSchema.safeParse({ ...base, ...drawnCandidates }).success).toBe(true);
  });

  it("accepts a `pending` ballot with empty arrays (no candidates yet)", () => {
    const parsed = ballotsSchema.safeParse({
      ...base,
      ballotStatus: "pending",
      house: [],
      senate: [],
      electorates: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a `pending` ballot that carries candidates (contradicts the status)", () => {
    expect(
      ballotsSchema.safeParse({ ...base, ballotStatus: "pending", ...drawnCandidates, senate: [] })
        .success,
    ).toBe(false);
  });

  it("requires a `provisional` ballot to actually carry the candidates it claims", () => {
    expect(
      ballotsSchema.safeParse({
        ...base,
        ballotStatus: "provisional",
        house: [],
        senate: [],
        electorates: [],
      }).success,
    ).toBe(false);
    expect(
      ballotsSchema.safeParse({ ...base, ballotStatus: "provisional", ...drawnCandidates }).success,
    ).toBe(true);
  });

  it("validates a full pending dataset end-to-end (party-alignment-only quiz)", () => {
    const ds = fixture();
    const pending = parseDataset({
      questions: ds.questions,
      parties: ds.parties,
      ballots: { ...base, ballotStatus: "pending", house: [], senate: [], electorates: [] },
    });
    expect(validateDataset(pending).ok).toBe(true);
  });
});
