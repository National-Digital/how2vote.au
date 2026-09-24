import { describe, expect, it } from "vitest";
import { fieldsOf, recordedCount, recordOf, type QuizFields } from "./quiz-record";

const quiz: QuizFields = {
  state: "ACT",
  electorate: "Bean",
  answers: { 3: { points: 5, important: true }, 7: { points: 0, important: false } },
  cursor: 2,
  questionIds: [3, 7, 9],
};

describe("the explorer record exchanged with the native core", () => {
  it("survives the round trip through JSON unchanged", () => {
    const wire = JSON.parse(JSON.stringify(recordOf(quiz, 1_700_000_000_000)));
    expect(wire.updatedAt).toBe(1_700_000_000_000);
    expect(fieldsOf(wire)).toEqual(quiz);
  });

  it("reads a record as the native core writes it: string keys, nil fields left out", () => {
    const native = JSON.parse(
      '{"answers":{"3":{"points":5,"important":true}},"cursor":1,"questionIds":[3,7],"updatedAt":1}',
    );
    expect(fieldsOf(native)).toEqual({
      state: null,
      electorate: null,
      answers: { 3: { points: 5, important: true } },
      cursor: 1,
      questionIds: [3, 7],
    });
  });

  it("reads an empty record as an empty quiz, never as undefined fields", () => {
    expect(fieldsOf({})).toEqual({
      state: null,
      electorate: null,
      answers: {},
      cursor: 0,
      questionIds: [],
    });
  });
});

describe("the count of answered questions", () => {
  const answers = {
    1: { points: 5 as const, important: false },
    2: { points: 0 as const, important: false },
    9: { points: 5 as const, important: false },
  };

  it("counts only answers to the current questions, so it never exceeds the total", () => {
    expect(recordedCount(answers, [1, 2, 3])).toBe(2);
    expect(recordedCount(answers, [1, 2])).toBe(2);
  });

  it("counts every answer while the questions are not yet known", () => {
    expect(recordedCount(answers, [])).toBe(3);
  });
});
