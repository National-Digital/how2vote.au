import { describe, expect, it } from "vitest";
import {
  alignmentPresentation,
  distinctPartyAlignments,
  groupByFederalGroup,
  NO_PARTY_ALIGNMENT_BADGE,
  NO_PARTY_RECORD_BADGE,
  PARTY_ALIGNMENT_QUALIFIER,
  SUSPENDED_BADGE,
  type AlignmentInput,
  type PartyAlignmentRow,
} from "./candidate-alignment";

const row = (over: Partial<AlignmentInput> = {}): AlignmentInput => ({
  partyKey: "australian_greens",
  party: "The Greens",
  score: 88,
  band: "matched",
  suspended: false,
  ...over,
});

describe("alignmentPresentation — candidate/party distinction", () => {
  it("shows a figure for a mapped party with a record, qualified as the PARTY's alignment", () => {
    const p = alignmentPresentation(row({ score: 88, band: "matched" }));
    expect(p.kind).toBe("aligned");
    expect(p.showScore).toBe(true);
    expect(p.score).toBe(88);
    expect(p.badge).toBe("alignment");
    // The qualification must name the party and disclaim the individual candidate's views.
    expect(p.detail).toContain("The Greens");
    expect(p.detail).toContain("recorded parliamentary positions");
    expect(p.detail).toContain("not this candidate's personal views");
  });

  it("labels a lower-alignment mapped party with the same uniform unit, still showing the figure", () => {
    const p = alignmentPresentation(row({ score: 31, band: "low" }));
    expect(p.kind).toBe("aligned");
    // Same unit as a high-alignment party — 31% and 88% read off one scale, not two bands.
    expect(p.badge).toBe("alignment");
    expect(p.score).toBe(31);
  });

  it("NEVER shows a number for an independent / unmapped candidate (partyKey null)", () => {
    // Even if a stray score somehow arrives, a null mapping must yield no figure (fail-closed).
    const p = alignmentPresentation(row({ partyKey: null, party: "", score: 77, band: "matched" }));
    expect(p.kind).toBe("independent");
    expect(p.showScore).toBe(false);
    expect(p.score).toBeNull();
    expect(p.badge).toBe(NO_PARTY_ALIGNMENT_BADGE);
    expect(p.detail).toContain("No party-position alignment available");
  });

  it("distinguishes a mapped-but-recordless party from an independent", () => {
    const p = alignmentPresentation(
      row({ partyKey: "new_micro_party", score: -1, band: "no-data" }),
    );
    expect(p.kind).toBe("no-party-record");
    expect(p.showScore).toBe(false);
    expect(p.badge).toBe(NO_PARTY_RECORD_BADGE);
  });

  it("suspends a disputed alignment (correction / right of reply) over everything else", () => {
    // Suspension wins even with a valid mapping + score.
    const p = alignmentPresentation(row({ suspended: true, score: 88, band: "matched" }));
    expect(p.kind).toBe("suspended");
    expect(p.showScore).toBe(false);
    expect(p.score).toBeNull();
    expect(p.badge).toBe(SUSPENDED_BADGE);
  });

  it("the qualifier constant states the party-not-candidate limitation", () => {
    expect(PARTY_ALIGNMENT_QUALIFIER).toContain("not evidence of an individual candidate's");
    expect(PARTY_ALIGNMENT_QUALIFIER).toContain("do not predict");
  });
});

describe("distinctPartyAlignments — party-level panel derivation", () => {
  const r = (over: Partial<PartyAlignmentRow>): PartyAlignmentRow => ({
    partyKey: "australian_greens",
    party: "The Greens",
    score: 88,
    band: "matched",
    suspended: false,
    ...over,
  });

  it("dedupes by partyKey, keeping the first ballot-order occurrence", () => {
    const out = distinctPartyAlignments([
      r({ partyKey: "alp", party: "Labor", score: 60 }),
      r({ partyKey: "alp", party: "Labor", score: 60 }),
      r({ partyKey: "australian_greens", party: "The Greens", score: 88 }),
    ]);
    expect(out.map((p) => p.partyKey)).toEqual(["alp", "australian_greens"]);
    expect(out).toHaveLength(2);
  });

  it("DROPS independents / unmapped candidates (partyKey null) — no party record to attribute", () => {
    const out = distinctPartyAlignments([
      r({ partyKey: null, party: "", score: 77 }),
      r({ partyKey: "alp", party: "Labor", score: 60 }),
    ]);
    expect(out.map((p) => p.partyKey)).toEqual(["alp"]);
  });

  it("keeps suspended parties in the list (the panel shows their badge, never a figure)", () => {
    const out = distinctPartyAlignments([r({ partyKey: "alp", party: "Labor", suspended: true })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.suspended).toBe(true);
    // The panel routes it through alignmentPresentation, which withholds the figure.
    expect(alignmentPresentation(out[0]!).showScore).toBe(false);
  });

  it("returns an empty list when there are no mapped parties", () => {
    expect(distinctPartyAlignments([r({ partyKey: null })])).toEqual([]);
    expect(distinctPartyAlignments([])).toEqual([]);
  });
});

describe("groupByFederalGroup — registered-family clustering", () => {
  const r = (over: Partial<PartyAlignmentRow>): PartyAlignmentRow => ({
    partyKey: "liberal_party",
    party: "Liberal",
    score: 70,
    band: "matched",
    suspended: false,
    ...over,
  });

  it("passes ungrouped rows through as single blocks, in order", () => {
    const blocks = groupByFederalGroup([
      r({ partyKey: "alp", party: "Labor", federalGroup: undefined }),
      r({ partyKey: "australian_greens", party: "The Greens", federalGroup: undefined }),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["single", "single"]);
    expect(blocks.map((b) => (b.kind === "single" ? b.row.partyKey : null))).toEqual([
      "alp",
      "australian_greens",
    ]);
  });

  it("clusters same-label rows into one group block, keeping member order", () => {
    const blocks = groupByFederalGroup([
      r({ partyKey: "liberal_party", party: "Liberal", federalGroup: "Coalition" }),
      r({ partyKey: "national_party", party: "The Nationals", federalGroup: "Coalition" }),
      r({ partyKey: "liberal_national_party", party: "LNP", federalGroup: "Coalition" }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("group");
    if (blocks[0]!.kind !== "group") throw new Error("expected group");
    expect(blocks[0]!.label).toBe("Coalition");
    expect(blocks[0]!.rows.map((x) => x.partyKey)).toEqual([
      "liberal_party",
      "national_party",
      "liberal_national_party",
    ]);
  });

  it("takes the group's position from its FIRST member, without reordering the rest", () => {
    const blocks = groupByFederalGroup([
      r({ partyKey: "alp", party: "Labor", federalGroup: undefined }),
      r({ partyKey: "liberal_party", party: "Liberal", federalGroup: "Coalition" }),
      r({ partyKey: "australian_greens", party: "The Greens", federalGroup: undefined }),
      r({ partyKey: "liberal_national_party", party: "LNP", federalGroup: "Coalition" }),
    ]);
    // Labor (single), then the Coalition block at the Liberal position (absorbing the later LNP row),
    // then the Greens (single) — a scattered family clusters but nothing else moves.
    expect(blocks.map((b) => (b.kind === "single" ? b.row.partyKey : `group:${b.label}`))).toEqual([
      "alp",
      "group:Coalition",
      "australian_greens",
    ]);
    const coalition = blocks[1];
    if (coalition?.kind !== "group") throw new Error("expected group");
    expect(coalition.rows.map((x) => x.partyKey)).toEqual([
      "liberal_party",
      "liberal_national_party",
    ]);
  });

  it("never pools scores — each member keeps its own figure", () => {
    const blocks = groupByFederalGroup([
      r({ partyKey: "liberal_party", party: "Liberal", score: 70, federalGroup: "Coalition" }),
      r({ partyKey: "country_liberal_party", party: "CLP", score: 59, federalGroup: "Coalition" }),
    ]);
    if (blocks[0]?.kind !== "group") throw new Error("expected group");
    expect(blocks[0].rows.map((x) => x.score)).toEqual([70, 59]);
  });

  it("returns an empty list for no rows", () => {
    expect(groupByFederalGroup([])).toEqual([]);
  });
});
