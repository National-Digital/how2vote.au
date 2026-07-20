import type { Question } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import type { Answer } from "./answers.js";
import { topPartyMatch } from "./scoring.js";

// Two propositions on which A and B are polar opposites, and a party C with no recorded data —
// enough to exercise every branch of the top-match selection. (scoreParties/matchPercentages
// themselves are pinned end-to-end by golden.test.ts.)
const questions = [
  { id: 1, text: "One.", positions: { A: 5, B: 1, C: -1 } },
  { id: 2, text: "Two.", positions: { A: 5, B: 1, C: -1 } },
] as unknown as Question[];

const answer = (id: number, points: Answer["points"]): Answer => ({
  id,
  points,
  important: false,
});

describe("topPartyMatch", () => {
  it("returns the highest-percentage party", () => {
    expect(topPartyMatch([answer(1, 5), answer(2, 5)], questions)).toBe("A");
    expect(topPartyMatch([answer(1, 1), answer(2, 1)], questions)).toBe("B");
  });

  it("returns null when nothing scored (all skips)", () => {
    expect(topPartyMatch([answer(1, 0), answer(2, 0)], questions)).toBeNull();
    expect(topPartyMatch([], questions)).toBeNull();
  });

  it("ignores parties with no scorable data (NO_RESULT) rather than returning them", () => {
    // C has no positions at all; it must never be the match even though it appears in the map.
    expect(topPartyMatch([answer(1, 5)], questions)).toBe("A");
  });

  it("breaks percentage ties on party key, deterministically", () => {
    // Answering neutral (3) puts the user equidistant from A (5) and B (1): identical percentages.
    // The tie must break to the lexicographically smaller key on every client (ADR-0008 — the
    // counters are only comparable if every device derives the same match).
    expect(topPartyMatch([answer(1, 3), answer(2, 3)], questions)).toBe("A");
  });

  it("applies merges before picking the top match", () => {
    // B absorbs A: the merged pool holds all contributions under B, which then must win.
    const merges = [{ master: "B", merger: "A" }];
    expect(topPartyMatch([answer(1, 5), answer(2, 5)], questions, merges)).toBe("B");
  });
});
