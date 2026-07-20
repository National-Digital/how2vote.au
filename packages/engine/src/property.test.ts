import type { Ballots, Party, PartyKey, Position, Question } from "@how2vote/data-schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Answer, AnswerPoints } from "./answers.js";
import { mapBallot } from "./ballot.js";
import { matchPercentages, topPartyMatch } from "./scoring.js";
import { decodeShare, encodeShare, packAnswers, unpackAnswers } from "./share.js";

/**
 * Property-based tests encoding invariants from the project's dev methodology. Where the existing
 * example-based tests pin single worked cases, these generate across the input space and assert the
 * invariant holds for every generated dataset/answer set.
 *
 *   Invariant 1 — every eligible candidate appears exactly once in generated ballot material.
 *   Invariant 3 — sharing then reopening preferences preserves the candidate/answer order (round-trip).
 *   Invariant 4 — changing presentation order (question order and/or party order) does not change the
 *                 calculated alignment/scores.
 *
 * (Invariant 2 — no candidate can occupy two preference positions in a voting plan — lives against
 * the plan reducer in apps/web/src/lib/plan.property.test.ts.)
 */

// A deterministic seeded shuffle (no Math.random) so a failing case is reproducible from its seed.
function permute<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0 || 1;
  const next = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff);
  for (let i = a.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// Rebuild a positions record with its keys in a permuted insertion order — the "party order" half of
// a presentation change (Object.entries iterates insertion order, so this genuinely reorders scoring).
function permutePositions(
  positions: Record<string, Position>,
  seed: number,
): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const [k, v] of permute(Object.entries(positions), seed)) out[k] = v;
  return out;
}

const mapEntries = (m: ReadonlyMap<PartyKey, number>): [PartyKey, number][] =>
  [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

// ── Invariant 1: ballot material contains every eligible candidate exactly once ──────────────────

const stateArb = fc.constantFrom("ACT", "NSW", "VIC", "QLD", "WA");
const divisionArb = fc.constantFrom("Bean", "Reid", "Wills", "Bass", "Canberra", "Fenner");
const partyStrArb = fc.constantFrom(
  "The Greens",
  "Australian Labor Party",
  "Liberal",
  "",
  "Independent",
);
const groupArb = fc.constantFrom("A", "B", "C", "AA", "AB", "UG");

// House/Senate candidate lists with globally-unique candidate names, so "appears exactly once" is a
// question of identity rather than of coincidental duplicate names.
const houseArb = fc
  .array(
    fc.record({
      state: stateArb,
      division: divisionArb,
      party: partyStrArb,
      position: fc.integer({ min: 1, max: 100 }),
    }),
    { minLength: 1, maxLength: 25 },
  )
  .map((list) => list.map((c, i) => ({ ...c, candidate: `H${i}` })));

const senateArb = fc
  .array(
    fc.record({
      state: stateArb,
      group: groupArb,
      party: partyStrArb,
      position: fc.integer({ min: 1, max: 100 }),
    }),
    { minLength: 1, maxLength: 25 },
  )
  .map((list) => list.map((c, i) => ({ ...c, candidate: `S${i}` })));

const eqName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

describe("Invariant 1 — ballot material lists every eligible candidate exactly once", () => {
  it("maps each candidate in the selected division/state exactly once, and nothing else", () => {
    fc.assert(
      fc.property(houseArb, senateArb, (house, senate) => {
        // A real selection is one state + one electorate; take the first house candidate's.
        const selection = { state: house[0]!.state, electorate: house[0]!.division };
        const ballots = {
          schemaVersion: 1,
          dataVersion: "2025-01-01",
          source: "AEC",
          house,
          senate,
          electorates: [{ state: selection.state, electorate: selection.electorate }],
        } as unknown as Ballots;

        const { house: houseRows, senate: senateRows } = mapBallot(
          ballots,
          [] as Party[],
          new Map<PartyKey, number>(),
          selection,
        );

        const eligibleHouse = house.filter((c) => eqName(c.division, selection.electorate));
        const eligibleSenate = senate.filter((c) => eqName(c.state, selection.state));

        // Exactly-once: output multiset equals the eligible multiset, and no duplicates leak in.
        expect(houseRows).toHaveLength(eligibleHouse.length);
        expect(new Set(houseRows.map((r) => r.candidate)).size).toBe(houseRows.length);
        expect([...houseRows.map((r) => r.candidate)].sort()).toEqual(
          [...eligibleHouse.map((c) => c.candidate)].sort(),
        );
        // Nothing outside the selected division ever appears.
        expect(houseRows.every((r) => eqName(r.division, selection.electorate))).toBe(true);

        expect(senateRows).toHaveLength(eligibleSenate.length);
        expect(new Set(senateRows.map((r) => r.candidate)).size).toBe(senateRows.length);
        expect([...senateRows.map((r) => r.candidate)].sort()).toEqual(
          [...eligibleSenate.map((c) => c.candidate)].sort(),
        );
        expect(senateRows.every((r) => eqName(r.state, selection.state))).toBe(true);
      }),
    );
  });
});

// ── Invariant 3: share round-trip preserves the answer set exactly ───────────────────────────────

const pointsArb = fc.constantFrom<AnswerPoints>(0, 1, 2, 3, 4, 5);

// An ordered id list plus one answer body per id (mirrors the dataset-aware, positional codec).
const answersOverIdsArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 60 })
  .chain((ids) =>
    fc.record({
      ids: fc.constant(ids),
      bodies: fc.array(fc.record({ points: pointsArb, important: fc.boolean() }), {
        minLength: ids.length,
        maxLength: ids.length,
      }),
    }),
  )
  .map(({ ids, bodies }): { ids: number[]; answers: Answer[] } => ({
    ids,
    answers: ids.map((id, i) => ({
      id,
      points: bodies[i]!.points,
      important: bodies[i]!.important,
    })),
  }));

describe("Invariant 3 — sharing then reopening preferences round-trips exactly", () => {
  it("packAnswers → unpackAnswers reconstructs the same answers against the same ordering", () => {
    fc.assert(
      fc.property(answersOverIdsArb, ({ ids, answers }) => {
        expect(unpackAnswers(packAnswers(answers, ids), ids)).toEqual(answers);
      }),
    );
  });

  it("encodeShare → decodeShare preserves election, electorate and the full answer order", () => {
    const electionIdArb = fc.constantFrom("2025", "2022", "2019");
    const electorateArb = fc.constantFrom("Bean", "Wills", "Melbourne Ports", "Reid", "Kooyong");
    fc.assert(
      fc.property(
        answersOverIdsArb,
        electionIdArb,
        electorateArb,
        ({ ids, answers }, electionId, electorate) => {
          const fragment = encodeShare({ electorate, answers }, ids, electionId);
          // Resolver returns this election's ordering (and nothing for anything else) — exactly the
          // dataset-aware contract decodeShare expects.
          const decoded = decodeShare(
            fragment,
            (id) => (id === electionId ? ids : undefined),
            "2025",
          );
          expect(decoded).not.toBeNull();
          expect(decoded!.electionId).toBe(electionId);
          expect(decoded!.answers).toEqual(answers);
        },
      ),
    );
  });
});

// ── Invariant 4: alignment is independent of presentation order ──────────────────────────────────

const partyKeyArb = fc.constantFrom(
  "australian_greens",
  "australian_labor_party",
  "liberal_party",
  "the_nationals",
  "pauline_hansons_one_nation_party",
  "australian_democrats",
  "centre_alliance",
);
const positionValueArb = fc.constantFrom<Position>(-1, 1, 2, 3, 4, 5);

// A dataset (questions with per-party positions) plus one answer per question, and seeds to permute
// question order and each question's party order.
const scoringSceneArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 15 })
  .chain((ids) =>
    fc.record({
      ids: fc.constant(ids),
      positionsList: fc.array(
        fc.dictionary(partyKeyArb, positionValueArb, { minKeys: 1, maxKeys: 7 }),
        {
          minLength: ids.length,
          maxLength: ids.length,
        },
      ),
      bodies: fc.array(fc.record({ points: pointsArb, important: fc.boolean() }), {
        minLength: ids.length,
        maxLength: ids.length,
      }),
      qSeed: fc.integer(),
      aSeed: fc.integer(),
      pSeeds: fc.array(fc.integer(), { minLength: ids.length, maxLength: ids.length }),
    }),
  );

describe("Invariant 4 — presentation order does not change the calculated alignment", () => {
  it("permuting question order, party order and answer order leaves every party's score unchanged", () => {
    fc.assert(
      fc.property(scoringSceneArb, ({ ids, positionsList, bodies, qSeed, aSeed, pSeeds }) => {
        const questions: Question[] = ids.map((id, i) => ({
          id,
          text: `Q${id}`,
          positions: positionsList[i]!,
        }));
        const answers: Answer[] = ids.map((id, i) => ({
          id,
          points: bodies[i]!.points,
          important: bodies[i]!.important,
        }));

        const base = matchPercentages(answers, questions);
        const baseTop = topPartyMatch(answers, questions);

        // A different PRESENTATION of the same data: questions reordered, each question's party
        // positions rebuilt in a different key order, and the answers themselves reordered.
        const permutedQuestions: Question[] = permute(questions, qSeed).map((q) => {
          const originalIndex = ids.indexOf(q.id);
          return { ...q, positions: permutePositions(q.positions, pSeeds[originalIndex]!) };
        });
        const permutedAnswers = permute(answers, aSeed);

        const after = matchPercentages(permutedAnswers, permutedQuestions);
        const afterTop = topPartyMatch(permutedAnswers, permutedQuestions);

        expect(mapEntries(after)).toEqual(mapEntries(base));
        expect(afterTop).toBe(baseTop);
      }),
    );
  });
});
