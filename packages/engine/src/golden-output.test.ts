import type { Dataset } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import type { Answer } from "./answers.js";
import { aboveTheLine, mapBallot } from "./ballot.js";
import { generateCard, type Card } from "./card.js";

// Runs the engine against the committed, build-validated datasets the app actually ships, so these
// goldens are the real printable outputs — not a hand-written approximation of them.
import dataset2025Json from "../../../data/dist/2025/dataset.json" with { type: "json" };
import dataset2019Json from "../../../data/dist/2019/dataset.json" with { type: "json" };
const dataset2025 = dataset2025Json as unknown as Dataset;
const dataset2019 = dataset2019Json as unknown as Dataset;

/**
 * Golden-file (approved-output) harness. Each test writes a whole rendered/structured output to a
 * committed file under `__golden__/`; a change that alters any of these produces a REAL, reviewable
 * diff in that file. This is complementary to `golden.test.ts` (which pins individual scoring
 * numbers with inline asserts): here we capture the entire printable card model, a sample ballot
 * paper, and a historical election's card as approved artifacts.
 *
 * Everything is deterministic: fixed datasets (committed on disk), a fixed answer recipe (below),
 * and a fixed electorate. No Date.now()/random — the same inputs always produce the same file.
 */

// A fixed, explicit answer set: the first twelve dataset questions, points cycling 1..5, with two
// marked important. Mirrors the deterministic recipe in card.test.ts; no randomness or clock.
const fixedAnswers = (dataset: Dataset): Answer[] =>
  dataset.questions.questions.slice(0, 12).map((q, i) => ({
    id: q.id,
    points: ((i % 5) + 1) as Answer["points"],
    important: i === 0 || i === 5,
  }));

/** Serialise a Card to stable pretty JSON. The `percentages` Map is flattened to a key-sorted object
 * (Maps do not JSON-serialise, and sorting removes any dependence on insertion order). */
const serializeCard = (card: Card): string => {
  const obj = {
    state: card.state,
    electorate: card.electorate,
    house: card.house,
    senate: card.senate,
    senateAboveLine: card.senateAboveLine,
    percentages: Object.fromEntries(
      [...card.percentages.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    dataVersion: card.dataVersion,
    attribution: card.attribution,
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
};

describe("golden: printable card model (representative 2025 result)", () => {
  it("captures the full how-to-vote card for a representative electorate (ACT / Bean)", async () => {
    const card = generateCard(dataset2025, {
      state: "ACT",
      electorate: "Bean",
      answers: fixedAnswers(dataset2025),
    });
    await expect(serializeCard(card)).toMatchFileSnapshot("./__golden__/card-2025-bean.json");
  });
});

describe("golden: historical election card", () => {
  it("captures the same electorate against the 2019 historical dataset (ACT / Bean)", async () => {
    const card = generateCard(dataset2019, {
      state: "ACT",
      electorate: "Bean",
      answers: fixedAnswers(dataset2019),
    });
    await expect(serializeCard(card)).toMatchFileSnapshot("./__golden__/card-2019-bean.json");
  });
});

describe("golden: sample ballot paper (House + Senate ballot order)", () => {
  it("captures the printed ballot order with no scoring — candidates only, in ballot order", async () => {
    // Empty percentages: this golden is about BALLOT ORDER, not alignment. Rows are reduced to the
    // paper's own facts (position, candidate, party, column) so the diff is purely the ballot.
    const { house, senate } = mapBallot(
      dataset2025.ballots,
      dataset2025.parties.parties,
      new Map(),
      { state: "ACT", electorate: "Bean" },
    );
    const ballotPaper = {
      state: "ACT",
      electorate: "Bean",
      house: house.map((r) => ({
        position: r.position,
        candidate: r.candidate,
        party: r.party,
        division: r.division,
        partyKey: r.partyKey,
      })),
      senate: senate.map((r) => ({
        position: r.position,
        group: r.group,
        candidate: r.candidate,
        party: r.party,
        partyKey: r.partyKey,
      })),
      senateAboveLine: aboveTheLine(senate).map((g) => ({
        group: g.group,
        party: g.party,
        partyKey: g.partyKey,
        candidates: g.candidates,
      })),
    };
    await expect(`${JSON.stringify(ballotPaper, null, 2)}\n`).toMatchFileSnapshot(
      "./__golden__/ballot-paper-2025-act.json",
    );
  });
});
