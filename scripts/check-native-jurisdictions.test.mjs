import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  pageJurisdictions,
  verifyJurisdictions,
  webJurisdictions,
} from "./check-native-jurisdictions.mjs";

const url = (p) => new URL(p, import.meta.url);
const WEB = readFileSync(url("../apps/web/src/lib/data.ts"), "utf8");

/** A projected states/ballot page offering these states, as the projection writes it. */
const page = (states) => ({
  blocks: [
    {
      t: "section",
      role: "template",
      id: "ballot-states",
      c: [
        {
          t: "definitions",
          items: states.map(([code, name]) => ({
            term: [{ t: "text", s: code }],
            detail: [{ t: "paragraph", c: [{ t: "text", s: name }] }],
          })),
        },
      ],
    },
  ],
});
const PICKER = webJurisdictions(WEB)
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((j) => [j.code, j.name]);

describe("webJurisdictions / pageJurisdictions", () => {
  it("read the web's eight in ballot-paper order, and a page's in its own", () => {
    const codes = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
    expect(webJurisdictions(WEB).map((j) => j.code)).toEqual(codes);
    expect(pageJurisdictions(page(PICKER)).map((j) => j.code)).toEqual([...codes].sort());
  });
});

describe("verifyJurisdictions", () => {
  it("passes on a page offering the web's states, alphabetically", () => {
    expect(verifyJurisdictions(WEB, page(PICKER))).toEqual([]);
  });

  // A missing entry is a state with no way to reach the questionnaire, on one channel only.
  it("catches a dropped state", () => {
    const dropped = PICKER.filter(([code]) => code !== "NT");
    expect(verifyJurisdictions(WEB, page(dropped)).join(" ")).toContain(
      "8 states and territories on the web and 7",
    );
  });

  // The code is matched against the compiled dataset, so a typo returns an empty electorate list
  // and the picker simply looks broken for everyone who lives there.
  it("catches a code that would match no electorates", () => {
    const typo = PICKER.map(([code, name]) => [code === "QLD" ? "QLD " : code, name]);
    expect(verifyJurisdictions(WEB, page(typo)).join(" ")).toContain("entry 4 differs");
  });

  it("catches a drifted name", () => {
    const drifted = PICKER.map(([code, name]) => [code, code === "TAS" ? "Tas" : name]);
    expect(verifyJurisdictions(WEB, page(drifted)).join(" ")).toContain('native TAS "Tas"');
  });

  it("catches a reordering", () => {
    const reordered = [...PICKER].reverse();
    expect(verifyJurisdictions(WEB, page(reordered)).join(" ")).toContain("entry 1 differs");
  });

  it("fails closed when either side is unreadable", () => {
    expect(verifyJurisdictions("", page(PICKER)).join(" ")).toContain("no STATES");
    expect(verifyJurisdictions(WEB, null).join(" ")).toContain("offers none");
  });
});
