import { describe, expect, it } from "vitest";
import type { AnswerPoints } from "@how2vote/engine";
import { answerLabel } from "$lib/answers";
import { QUIZ_COPY, SPOKEN_ANSWERS } from "$lib/quiz-copy";
import { fill, parts } from "$lib/template";

describe("quiz copy", () => {
  it("fills a template's values", () => {
    expect(fill(QUIZ_COPY.position, { n: 3, total: 29 })).toBe("Question 3 of 29");
    expect(fill(QUIZ_COPY.answered, { answer: SPOKEN_ANSWERS[5], n: 4, total: 29 })).toBe(
      "Answered: strongly agree. Question 4 of 29.",
    );
  });

  it("keeps a value it is not given visible, rather than dropping it", () => {
    expect(fill(QUIZ_COPY.position, { n: 3 })).toBe("Question 3 of {total}");
  });

  it("splits a template into its text and its named values", () => {
    expect(parts(QUIZ_COPY.failed)).toEqual([
      { text: "Couldn't load the questions. Please check your connection and " },
      { value: "retry" },
      { text: "." },
    ]);
  });

  it("announces each answer as the review screen names it", () => {
    expect(SPOKEN_ANSWERS).toHaveLength(6);
    SPOKEN_ANSWERS.forEach((spoken, points) => {
      const label = answerLabel(points as AnswerPoints, false);
      expect(spoken).toBe(points === 0 ? label : label.toLowerCase());
    });
  });
});
