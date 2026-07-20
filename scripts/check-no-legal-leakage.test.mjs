import { describe, expect, it } from "vitest";
import { scan, LEAKAGE_RULES } from "./check-no-legal-leakage.mjs";

const hit = (text) => scan([{ path: "x", text }]);

describe("scan — catches leakage citations", () => {
  it("flags legal-pack citations", () => {
    expect(hit("adapted from the National Digital legal pack").length).toBe(1);
    expect(hit("see pack §8.5 for the rule").length).toBe(1);
    expect(hit("supersedes the pack draft's text").length).toBe(1);
    expect(hit("(pack Terms §19)").length).toBe(1);
  });

  it("flags risk-register citations, hyphenated or spaced", () => {
    expect(hit("risk register item 14").length).toBeGreaterThanOrEqual(1);
    expect(hit("risk-register item 11").length).toBeGreaterThanOrEqual(1);
  });

  it("flags bracketed risk-register item citations", () => {
    expect(hit("mandatory (item 8): no consent").length).toBe(1);
    expect(hit("the electorate (item 13) is separated").length).toBe(1);
  });

  it("flags a counsel citation in any case", () => {
    expect(hit("Counsel's recommendation was").length).toBe(1);
    expect(hit("per Counsel review §3").length).toBeGreaterThanOrEqual(1);
    expect(hit("a formal counsel characterisation").length).toBe(1);
    expect(hit("electoral counsel opinion").length).toBe(1);
  });

  it("reports the file, line and matched text", () => {
    const hits = scan([{ path: "a.ts", text: "ok\nsee pack §5 here" }]);
    expect(hits[0]).toMatchObject({ path: "a.ts", line: 2 });
    expect(hits[0].match).toContain("pack §");
  });
});

describe("scan — leaves legitimate content alone", () => {
  it("does not flag the data word 'counselling' (no boundary after 'counsel')", () => {
    expect(hit("Motions - Abortion - Alternatives and counselling").length).toBe(0);
    expect(hit("family counselling services").length).toBe(0);
  });

  it("does not flag sanctioned control-N register keys", () => {
    expect(hit("affectedControls: control-3, control-17").length).toBe(0);
    expect(hit("control-5 stays partial").length).toBe(0);
  });

  it("does not flag ordinary prose, ADR refs, or package paths", () => {
    expect(hit("see docs/adr/0008 and packages/engine").length).toBe(0);
    expect(hit("the third item in the list explains why").length).toBe(0);
    expect(hit("WCAG 2.5.7 drag alternative").length).toBe(0);
  });
});

describe("LEAKAGE_RULES", () => {
  it("exports a non-empty rule set", () => {
    expect(LEAKAGE_RULES.length).toBeGreaterThan(0);
    for (const r of LEAKAGE_RULES) expect(r.re).toBeInstanceOf(RegExp);
  });
});
