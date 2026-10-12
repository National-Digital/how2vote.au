import { describe, expect, it } from "vitest";
import { markdownTwinHref } from "./markdown-twin";

describe("markdownTwinHref", () => {
  it("names a twin beside each electorate, party, issue, Senate and methodology page", () => {
    expect(markdownTwinHref("/methodology", "/methodology")).toBe(
      "https://how2vote.au/methodology.md",
    );
    for (const [route, path] of [
      ["/[election=election]/electorates/[electorate]", "/2025/electorates/adelaide"],
      ["/[election=election]/parties/[party]", "/2025/parties/liberal"],
      ["/[election=election]/issues/[issue]", "/next/issues/x"],
      ["/[election=election]/senate/[state]", "/2025/senate/act"],
    ]) {
      expect(markdownTwinHref(route!, path!)).toBe(`https://how2vote.au${path}.md`);
    }
  });

  it("names none for other routes", () => {
    for (const route of ["/", "/quiz", "/card", "/[election=election]/parties", "/privacy", null]) {
      expect(markdownTwinHref(route, "/x")).toBeNull();
    }
  });
});
