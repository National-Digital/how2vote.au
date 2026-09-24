import { describe, expect, it } from "vitest";
import { BALLOT_COPY, PICKER_STATES } from "$lib/ballot-copy";
import { STATES } from "$lib/data";
import { around, fill, parts } from "$lib/template";

describe("ballot copy", () => {
  it("fills a template's values", () => {
    expect(fill(BALLOT_COPY.position, { step: 2, total: 3 })).toBe("Your ballot · 2 of 3");
    expect(fill(BALLOT_COPY.search, { count: 47, code: "NSW" })).toBe("Search 47 NSW electorates…");
  });

  it("places the lookup link inside its sentence", () => {
    expect(parts(BALLOT_COPY.unsure)).toEqual([
      { text: "Not sure? " },
      { value: "lookup" },
      { text: " — your progress is kept." },
    ]);
    expect(around(BALLOT_COPY.unsure)).toEqual(["Not sure? ", " — your progress is kept."]);
  });

  it("offers every state once, alphabetically by code", () => {
    expect(PICKER_STATES.map((s) => s.code)).toEqual(STATES.map((s) => s.code).sort());
  });
});
