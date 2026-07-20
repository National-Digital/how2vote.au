import type { Ballots, Party, PartyKey } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import { aboveTheLine, bandFor, mapBallot, type SenateBallotRow } from "./ballot.js";

const parties: Party[] = [
  {
    key: "australian_greens",
    displayName: "The Greens",
    aecName: "The Greens",
    aliases: [],
    kind: "party",
  },
  {
    key: "australian_labor_party",
    displayName: "Labor",
    aecName: "Australian Labor Party",
    aliases: [],
    kind: "party",
  },
  { key: "liberal_party", displayName: "Liberal", aecName: "Liberal", aliases: [], kind: "party" },
  {
    key: "jane_doe_mp",
    displayName: "Jane Doe",
    aecName: "DOE, Jane",
    aliases: [],
    kind: "independent",
  },
];

const ballots: Ballots = {
  schemaVersion: 1,
  dataVersion: "2025-03-28",
  source: "AEC",
  house: [
    { state: "ACT", division: "Bean", candidate: "A, Green", party: "The Greens", position: 1 },
    {
      state: "ACT",
      division: "Bean",
      candidate: "B, Labor",
      party: "Australian Labor Party",
      position: 2,
    },
    { state: "ACT", division: "Bean", candidate: "DOE, Jane", party: "", position: 3 },
    { state: "ACT", division: "Bean", candidate: "C, Lib", party: "Liberal", position: 4 },
    { state: "NSW", division: "Reid", candidate: "Z, Other", party: "Liberal", position: 1 },
  ],
  senate: [
    { state: "ACT", group: "A", candidate: "S1", party: "The Greens", position: 1 },
    { state: "ACT", group: "B", candidate: "S2", party: "Australian Labor Party", position: 1 },
    { state: "ACT", group: "AA", candidate: "S3", party: "Liberal", position: 1 },
    { state: "ACT", group: "A", candidate: "S4", party: "Liberal", position: 2 },
  ],
  electorates: [
    { state: "ACT", electorate: "Bean" },
    { state: "NSW", electorate: "Reid" },
  ],
};

// Example 4 figures: Greens 88, Labor 74, Independent no-record (-1), Liberal 31.
const percentages = new Map<PartyKey, number>([
  ["australian_greens", 88],
  ["australian_labor_party", 74],
  ["liberal_party", 31],
  // jane_doe_mp intentionally absent → no data
]);

describe("bandFor", () => {
  it("bands at 50 and 0", () => {
    expect(bandFor(88)).toBe("matched");
    expect(bandFor(50)).toBe("matched");
    expect(bandFor(49)).toBe("low");
    expect(bandFor(0)).toBe("low");
    expect(bandFor(-1)).toBe("no-data");
  });
});

describe("House ballot mapping in official ballot order (no ranking)", () => {
  const { house } = mapBallot(ballots, parties, percentages, { state: "ACT", electorate: "Bean" });

  it("filters to the user's division only", () => {
    expect(house).toHaveLength(4);
    expect(house.every((r) => r.division === "Bean")).toBe(true);
  });

  it("keeps printed ballot order (by position), NOT score order, and annotates each with alignment", () => {
    // Printed order is position 1..4: Green, Labor, Doe (independent), Lib — regardless of score.
    expect(house.map((r) => r.candidate)).toEqual(["A, Green", "B, Labor", "DOE, Jane", "C, Lib"]);
    expect(house.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    // The alignment annotation travels with each row but does not reorder them.
    expect(house.map((r) => r.score)).toEqual([88, 74, -1, 31]);
    expect(house.map((r) => r.band)).toEqual(["matched", "matched", "no-data", "low"]);
  });

  it("resolves the independent by printed name", () => {
    const jane = house.find((r) => r.candidate === "DOE, Jane");
    expect(jane!.partyKey).toBe("jane_doe_mp");
    expect(jane!.score).toBe(-1); // no percentage recorded → no data
  });
});

describe("Senate ballot ordering — ballot columns, not score", () => {
  const { senate } = mapBallot(ballots, parties, percentages, { state: "ACT", electorate: "Bean" });

  it("orders by group-length, group-alpha, then position — score does not reorder", () => {
    // Ballot column order: group A (len 1) rows in position order, then B (len 1), then AA (len 2).
    // Scores (88, 31, 74, 31) are annotations only and do not change the order.
    expect(senate.map((r) => `${r.candidate}:${r.group}:${r.score}`)).toEqual([
      "S1:A:88",
      "S4:A:31",
      "S2:B:74",
      "S3:AA:31",
    ]);
  });
});

describe("Provisional (pre-draw) ballot ordering — neutral randomised order, not official/score", () => {
  const provisional: Ballots = { ...ballots, ballotStatus: "provisional" };
  const officialNames = ["A, Green", "B, Labor", "DOE, Jane", "C, Lib"]; // by position 1..4

  it("is deterministic for a given seed (stable across renders and offline recompute)", () => {
    const a = mapBallot(provisional, parties, percentages, { state: "ACT", electorate: "Bean" }, new Set(), 12345); // prettier-ignore
    const b = mapBallot(provisional, parties, percentages, { state: "ACT", electorate: "Bean" }, new Set(), 12345); // prettier-ignore
    expect(a.house.map((r) => r.candidate)).toEqual(b.house.map((r) => r.candidate));
  });

  it("is a permutation of the same candidates — nothing dropped, added, or re-scored", () => {
    const { house } = mapBallot(provisional, parties, percentages, { state: "ACT", electorate: "Bean" }, new Set(), 7); // prettier-ignore
    expect([...house.map((r) => r.candidate)].sort()).toEqual([...officialNames].sort());
    // Each candidate keeps its own alignment annotation regardless of the shuffled position.
    const green = house.find((r) => r.candidate === "A, Green")!;
    expect(green.score).toBe(88);
    const jane = house.find((r) => r.candidate === "DOE, Jane")!;
    expect(jane.score).toBe(-1);
  });

  it("does not simply reproduce the official ballot-position order (randomisation is active)", () => {
    // Deterministic sweep: at least one seed must reorder away from official position order, proving
    // the provisional path is not silently falling back to position order.
    const seeds = Array.from({ length: 24 }, (_, i) => i);
    const anyReordered = seeds.some((seed) => {
      const { house } = mapBallot(provisional, parties, percentages, { state: "ACT", electorate: "Bean" }, new Set(), seed); // prettier-ignore
      return house.map((r) => r.candidate).join("|") !== officialNames.join("|");
    });
    expect(anyReordered).toBe(true);
  });

  it("still keeps a `drawn`/default ballot in strict official position order (seed ignored)", () => {
    const { house } = mapBallot(ballots, parties, percentages, { state: "ACT", electorate: "Bean" }, new Set(), 999); // prettier-ignore
    expect(house.map((r) => r.candidate)).toEqual(officialNames);
  });
});

describe("Pending ballot (no candidates yet) — party alignment only", () => {
  it("returns empty House and Senate lists", () => {
    const pending: Ballots = {
      schemaVersion: 1,
      dataVersion: "2028-01-15",
      source: "provisional",
      ballotStatus: "pending",
      house: [],
      senate: [],
      electorates: [],
    };
    const { house, senate } = mapBallot(pending, parties, percentages, {
      state: "ACT",
      electorate: "Bean",
    });
    expect(house).toEqual([]);
    expect(senate).toEqual([]);
  });
});

describe("Correction / right-of-reply suspension", () => {
  it("defaults to nothing suspended — every row carries suspended:false", () => {
    const { house, senate } = mapBallot(ballots, parties, percentages, {
      state: "ACT",
      electorate: "Bean",
    });
    expect(house.every((r) => r.suspended === false)).toBe(true);
    expect(senate.every((r) => r.suspended === false)).toBe(true);
  });

  it("forces a suspended party's rows to no-alignment (fail-closed) and flags them", () => {
    const suspended = new Set<PartyKey>(["australian_greens"]);
    const { house, senate } = mapBallot(
      ballots,
      parties,
      percentages,
      { state: "ACT", electorate: "Bean" },
      suspended,
    );
    const green = house.find((r) => r.partyKey === "australian_greens")!;
    expect(green.suspended).toBe(true);
    // The disputed figure is withdrawn entirely — no residual score can leak.
    expect(green.score).toBe(-1);
    expect(green.band).toBe("no-data");
    // Every Greens Senate row is suspended too; other parties are untouched.
    expect(senate.filter((r) => r.partyKey === "australian_greens").every((r) => r.suspended)).toBe(
      true,
    );
    const labor = house.find((r) => r.partyKey === "australian_labor_party")!;
    expect(labor.suspended).toBe(false);
    expect(labor.score).toBe(74);
  });

  it("carries suspension up to the above-the-line group box", () => {
    const suspended = new Set<PartyKey>(["australian_greens"]);
    const { senate } = mapBallot(
      ballots,
      parties,
      percentages,
      { state: "ACT", electorate: "Bean" },
      suspended,
    );
    const atl = aboveTheLine(senate);
    const groupA = atl.find((r) => r.partyKey === "australian_greens")!;
    expect(groupA.suspended).toBe(true);
    expect(groupA.score).toBe(-1);
  });
});

describe("Senate above-the-line grouping", () => {
  // Two groups tie at 31 to exercise the group-length then group-alpha tie-break, and an ungrouped
  // ("UG") candidate that has no box above the line and so must be dropped.
  const rows: SenateBallotRow[] = [
    { state: "ACT", group: "A", candidate: "S1", party: "The Greens", position: 1, partyKey: "australian_greens", score: 88, band: "matched", suspended: false }, // prettier-ignore
    { state: "ACT", group: "A", candidate: "S4", party: "The Greens", position: 2, partyKey: "australian_greens", score: 88, band: "matched", suspended: false }, // prettier-ignore
    { state: "ACT", group: "B", candidate: "S2", party: "Australian Labor Party", position: 1, partyKey: "australian_labor_party", score: 31, band: "low", suspended: false }, // prettier-ignore
    { state: "ACT", group: "AB", candidate: "S3", party: "Liberal", position: 1, partyKey: "liberal_party", score: 31, band: "low", suspended: false }, // prettier-ignore
    { state: "ACT", group: "UG", candidate: "S5", party: "", position: 1, partyKey: null, score: -1, band: "no-data", suspended: false }, // prettier-ignore
  ];

  const atl = aboveTheLine(rows);

  it("drops the ungrouped column (no box above the line)", () => {
    expect(atl.map((r) => r.group)).toEqual(["A", "B", "AB"]);
  });

  it("orders by ballot column (single-letter before two-letter, then alphabetically), not score", () => {
    // Ballot column order: A and B (length 1, alpha), then AB (length 2). Scores are annotations.
    expect(atl.map((r) => `${r.group}:${r.score}`)).toEqual(["A:88", "B:31", "AB:31"]);
  });

  it("scores each box by its lead candidate and counts the group's candidates", () => {
    const groupA = atl.find((r) => r.group === "A")!;
    expect(groupA.party).toBe("The Greens");
    expect(groupA.partyKey).toBe("australian_greens");
    expect(groupA.score).toBe(88);
    expect(groupA.candidates).toBe(2);
  });
});
