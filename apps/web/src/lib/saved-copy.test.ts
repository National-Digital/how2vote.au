import { describe, expect, it } from "vitest";
import { SAVED_COPY } from "./saved-copy";
import { savedRows } from "./saved-rows";
import { parts } from "./template";

describe("SAVED_COPY", () => {
  it("names the values the saved page and the iOS app fill", () => {
    const values = (template: string) =>
      parts(template).flatMap((p) => ("value" in p ? [p.value] : []));
    expect(values(SAVED_COPY.how)).toEqual(["action"]);
    expect(values(SAVED_COPY.meta)).toEqual(["state", "date"]);
    expect(values(SAVED_COPY.removal)).toEqual(["electorate"]);
    expect(values(SAVED_COPY.ask)).toEqual(["count"]);
  });
});

describe("savedRows", () => {
  it("lists each card with its state's name and the date it was saved", () => {
    const savedAt = new Date(2026, 0, 5, 12).getTime();
    expect(savedRows([{ url: "/card#v1.a", electorate: "Sydney", state: "NSW", savedAt }])).toEqual(
      [{ url: "/card#v1.a", electorate: "Sydney", state: "New South Wales", date: "5 Jan 2026" }],
    );
  });
});
