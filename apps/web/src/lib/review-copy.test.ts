import { describe, expect, it } from "vitest";
import { REVIEW_COPY } from "$lib/review-copy";
import { around, fill } from "$lib/template";

describe("review copy", () => {
  it("reports how many are answered", () => {
    expect(fill(REVIEW_COPY.all, { total: 12 })).toBe("All 12 answered.");
    expect(fill(REVIEW_COPY.some, { recorded: 9, total: 12 })).toBe("9 of 12 answered.");
  });

  it("names the question each star marks", () => {
    expect(fill(REVIEW_COPY.star, { question: "Q" })).toBe('Mark "Q" as extremely important');
  });

  it("places the retry link inside its sentence", () => {
    expect(around(REVIEW_COPY.failed)).toEqual([
      "Couldn't load your answers. Please check your connection and ",
      ".",
    ]);
  });
});
