import type { Dataset, PartyKey } from "@how2vote/data-schema";
import { NO_DATA } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import type { Answer } from "./answers.js";
import { evidenceFor, generateCard, orderedQuestionIds } from "./card.js";

// Runs the card pipeline against the committed, build-validated dataset — the same data the app
// ships — so the test exercises real ballots, parties and questions.
import datasetJson from "../../../data/dist/2025/dataset.json" with { type: "json" };
const dataset = datasetJson as unknown as Dataset;

const questions = dataset.questions.questions;
const partyKey = dataset.parties.parties[0].key as PartyKey;

describe("generateCard", () => {
  const answers: Answer[] = questions
    .slice(0, 10)
    .map((q, i) => ({ id: q.id, points: ((i % 5) + 1) as Answer["points"], important: i === 0 }));

  const card = generateCard(dataset, { state: "ACT", electorate: "Bean", answers });

  it("returns the selected electorate and state", () => {
    expect(card.state).toBe("ACT");
    expect(card.electorate).toBe("Bean");
  });

  it("lists only House candidates in the chosen division, and Senate for the state", () => {
    expect(card.house.length).toBeGreaterThan(0);
    expect(card.house.every((r) => r.division === "Bean")).toBe(true);
    expect(card.senate.length).toBeGreaterThan(0);
  });

  it("carries per-party percentages and the data vintage/attribution", () => {
    expect(card.percentages).toBeInstanceOf(Map);
    expect(card.dataVersion).toBe(dataset.questions.dataVersion);
    expect(card.attribution).toBe(dataset.questions.attribution);
  });

  it("is deterministic — same inputs, identical card", () => {
    const again = generateCard(dataset, { state: "ACT", electorate: "Bean", answers });
    expect(again).toEqual(card);
  });
});

describe("evidenceFor", () => {
  // Find questions that force each classify branch for this party.
  const withPosition = questions.find(
    (q) => q.positions[partyKey] !== undefined && q.positions[partyKey] !== NO_DATA,
  )!;
  const partyPos = withPosition.positions[partyKey] as number;
  const noData = questions.find(
    (q) => q.positions[partyKey] === undefined || q.positions[partyKey] === NO_DATA,
  );

  it("classifies aligned / opposed / skipped and drops unknown question ids", () => {
    const opposedPoints = (partyPos <= 2 ? 5 : 1) as Answer["points"];
    const answers: Answer[] = [
      { id: withPosition.id, points: partyPos as Answer["points"], important: false }, // aligned
      { id: withPosition.id, points: opposedPoints, important: false }, // opposed (distance ≥ 2)
      { id: withPosition.id, points: 0, important: false }, // skipped
      { id: -999, points: 3, important: false }, // unknown id → dropped
    ];
    const lines = evidenceFor(dataset, partyKey, answers);

    expect(lines).toHaveLength(3); // unknown id excluded
    expect(lines[0].agreement).toBe("aligned");
    expect(lines[0].distance).toBe(0);
    expect(lines[1].agreement).toBe("opposed");
    expect(lines[2].agreement).toBe("skipped");
    expect(lines[2].distance).toBeNull();
  });

  it("reports no-data when the party has no recorded position", () => {
    if (!noData) return; // dataset may have a position for every question for this party
    const lines = evidenceFor(dataset, partyKey, [{ id: noData.id, points: 4, important: false }]);
    expect(lines[0].agreement).toBe("no-data");
    expect(lines[0].distance).toBeNull();
  });

  it("discloses a merged-in party's position when the master has none (merge-aware receipts)", () => {
    const merge = dataset.parties.merges[0];
    if (!merge) return;
    // A question where the master party has no record of its own but the merged-in party does —
    // exactly the case where the score pools the merger but the old evidence showed "no-data".
    const q = questions.find(
      (x) =>
        (x.positions[merge.master] === undefined || x.positions[merge.master] === NO_DATA) &&
        x.positions[merge.merger] !== undefined &&
        x.positions[merge.merger] !== NO_DATA,
    );
    if (!q) return;
    const lines = evidenceFor(dataset, merge.master as PartyKey, [
      { id: q.id, points: 3, important: false },
    ]);
    expect(lines[0].viaMerger).toBe(merge.merger);
    expect(lines[0].partyPosition).toBe(q.positions[merge.merger]);
    expect(lines[0].agreement).not.toBe("no-data");
  });
});

describe("orderedQuestionIds", () => {
  it("mirrors the dataset question order", () => {
    expect(orderedQuestionIds(dataset)).toEqual(questions.map((q) => q.id));
  });
});
