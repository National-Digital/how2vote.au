import { describe, expect, it } from "vitest";
import { answerLabel, keyToAction, OPTIONS } from "./answers";

describe("answer option scale", () => {
  it("has exactly one skip and five direction answers, and no importance option", () => {
    expect(OPTIONS.filter((o) => o.kind === "skip")).toHaveLength(1);
    expect(OPTIONS.filter((o) => o.kind === "answer")).toHaveLength(5);
    // Importance is set by starring on the review screen, not during answering.
    expect(OPTIONS.some((o) => o.kind === "answer" && "important" in o)).toBe(false);
  });
});

describe("keyToAction", () => {
  it("maps 1–5 to answers and 0 to skip; importance is no longer keyed here", () => {
    expect(keyToAction("3")).toEqual({ type: "answer", points: 3 });
    expect(keyToAction("0")).toEqual({ type: "skip" });
    expect(keyToAction("!")).toBeNull();
    expect(keyToAction("x")).toBeNull();
  });
});

describe("answerLabel", () => {
  it("prefixes a star for important answers", () => {
    expect(answerLabel(5, false)).toBe("Strongly agree");
    expect(answerLabel(5, true)).toBe("★ Strongly agree");
    expect(answerLabel(0, false)).toBe("Skipped");
  });
});
