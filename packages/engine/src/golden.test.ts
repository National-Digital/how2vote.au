import type { Merge, Question } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import type { Answer } from "./answers.js";
import { matchPercent, matchPercentages, scoreParties } from "./scoring.js";

/**
 * Golden methodology tests — the worked examples for the scoring methodology. These pin the exact
 * numbers the methodology promises (100/75/25/0 and 95/71) and MUST NOT be weakened: any change
 * to scoring that breaks them requires a deliberate, versioned methodology bump.
 */

const pct = (answers: Answer[], questions: Question[], merges: Merge[] = []) =>
  matchPercentages(answers, questions, merges);

describe("Example 1 — single extreme (not important) answer", () => {
  const q: Question = {
    id: 32,
    text: "Allow live animal export and place minimal restrictions on it.",
    positions: {
      australian_greens: 1,
      australian_labor_party: 2,
      liberal_party: 4,
      pauline_hansons_one_nation_party: 5,
      an_independent_mp: -1,
    },
  };
  const answers: Answer[] = [{ id: 32, points: 1, important: false }]; // Strongly Disagree

  it("scores by Manhattan distance out of a denominator of 4", () => {
    const p = pct(answers, [q]);
    expect(p.get("australian_greens")).toBe(100); // d=0 → 4/4
    expect(p.get("australian_labor_party")).toBe(75); // d=1 → 3/4
    expect(p.get("liberal_party")).toBe(25); // d=3 → 1/4
    expect(p.get("pauline_hansons_one_nation_party")).toBe(0); // d=4 → 0/4
  });

  it("excludes a no-data party (count 0 → -1)", () => {
    expect(pct(answers, [q]).get("an_independent_mp")).toBe(-1);
  });
});

describe("Example 2 — the ×10 importance lever, pooled over two questions", () => {
  const q1: Question = { id: 1, text: "Q1", positions: { australian_labor_party: 5 } };
  const q2: Question = { id: 2, text: "Q2", positions: { australian_labor_party: 2 } };

  it("pulls the pooled match to 95% when the extreme question is important", () => {
    const answers: Answer[] = [
      { id: 1, points: 5, important: true }, // extreme important: d=0 → 40/40
      { id: 2, points: 4, important: false }, // moderate: d=2 → 1/3
    ];
    // (40+1)/(40+3) = 41/43 ≈ 95%
    expect(pct(answers, [q1, q2]).get("australian_labor_party")).toBe(95);
  });

  it("gives 71% when the same question is not important", () => {
    const answers: Answer[] = [
      { id: 1, points: 5, important: false }, // extreme: d=0 → 4/4
      { id: 2, points: 4, important: false }, // moderate: d=2 → 1/3
    ];
    // (4+1)/(4+3) = 5/7 ≈ 71%
    expect(pct(answers, [q1, q2]).get("australian_labor_party")).toBe(71);
  });
});

describe("Example 3 — answer strength changes per-unit-distance tolerance", () => {
  it("a one-step gap costs more on a neutral answer than on an extreme", () => {
    const neutral = pct(
      [{ id: 1, points: 3, important: false }],
      [{ id: 1, text: "Q", positions: { p: 2 } }],
    );
    expect(neutral.get("p")).toBe(50); // (2-1)/2

    const extreme = pct(
      [{ id: 1, points: 1, important: false }],
      [{ id: 1, text: "Q", positions: { p: 2 } }],
    );
    expect(extreme.get("p")).toBe(75); // (4-1)/4
  });
});

describe("scoring edge cases", () => {
  it("a skipped answer contributes nothing", () => {
    const acc = scoreParties(
      [{ id: 1, points: 0, important: false }],
      [{ id: 1, text: "Q", positions: { p: 3 } }],
    );
    expect(matchPercent(acc.get("p")!)).toBe(-1); // count stayed 0
  });

  it("keeps every party in the result set even with no scorable overlap", () => {
    const acc = scoreParties(
      [{ id: 1, points: 5, important: false }],
      [{ id: 1, text: "Q", positions: { scored: 5, nodata: -1 } }],
    );
    expect(acc.has("scored")).toBe(true);
    expect(acc.has("nodata")).toBe(true);
    expect(matchPercent(acc.get("nodata")!)).toBe(-1);
  });
});

describe("party merge (pools accumulators, ignores -1 no-data)", () => {
  const questions: Question[] = [
    { id: 1, text: "Q1", positions: { centre_alliance: 5, nick_xenophon_team: 1 } },
    { id: 2, text: "Q2", positions: { centre_alliance: -1, nick_xenophon_team: 3 } },
  ];
  const merges: Merge[] = [{ master: "centre_alliance", merger: "nick_xenophon_team" }];

  it("merges pooled score/count rather than averaging rounded percentages", () => {
    const answers: Answer[] = [
      { id: 1, points: 5, important: false }, // CA d=0 → 4/4 ; NXT d=4 → 0/4
      { id: 2, points: 3, important: false }, // CA no data ; NXT d=0 → 2/2
    ];
    // master pooled: score = (4) + (0 + 2) = 6 ; count = (4) + (4 + 2) = 10 → 60%
    const p = pct(answers, questions, merges);
    expect(p.get("centre_alliance")).toBe(60);
    expect(p.has("nick_xenophon_team")).toBe(false); // merged away
  });

  it("does not merge when only one side is present", () => {
    const p = pct(
      [{ id: 1, points: 5, important: false }],
      [{ id: 1, text: "Q1", positions: { centre_alliance: 5 } }],
      merges,
    );
    expect(p.get("centre_alliance")).toBe(100);
  });
});
