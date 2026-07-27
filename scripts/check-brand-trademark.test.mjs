import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-brand-trademark.mjs";

const REAL_BRAND = readFileSync(new URL("../BRAND.md", import.meta.url), "utf8");

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

// Built from fragments so this test file itself never contains a literal the guard would flag
// (test files are excluded from the CLI scan anyway, but keeping the fixtures clean is tidier).
const REGISTERED_PHRASE = "registered" + " trade" + "mark";
const REGISTERED_SPACED = "Registered" + " Trade" + " Mark";
const CIRCLED_R = "®";
const CIRCLED_TM = "™";

describe("verdict — real committed brand guideline", () => {
  it("passes on the real BRAND.md with no offending sources", () => {
    const res = verdict({ sources: [], brandMd: REAL_BRAND });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("verdict — registration claims in source", () => {
  it("flags the spelt-out registered-mark phrase (case-insensitive)", () => {
    const sources = [{ path: "README.md", text: `The ${REGISTERED_PHRASE} How2Vote.` }];
    expect(hasError(verdict({ sources, brandMd: REAL_BRAND }), "README.md")).toBe(true);
  });

  it("flags the phrase with a space inside 'trade mark'", () => {
    const sources = [{ path: "terms.svelte", text: `Our ${REGISTERED_SPACED} rights.` }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(false);
  });

  it("flags the circled-R symbol", () => {
    const sources = [{ path: "a.ts", text: `const brand = "How2Vote${CIRCLED_R}";` }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(false);
  });

  it("flags the circled-TM symbol", () => {
    const sources = [{ path: "a.md", text: `How2Vote${CIRCLED_TM} is the name.` }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(false);
  });

  it("flags the uppercase (TM) token", () => {
    const sources = [{ path: "a.md", text: "How2Vote(TM)" }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(false);
  });

  it("flags the uppercase (R) token", () => {
    const sources = [{ path: "a.md", text: "How2Vote (R)" }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(false);
  });
});

describe("verdict — precision (no false positives)", () => {
  it("does not match the letters 'tm' inside an ordinary word", () => {
    const sources = [
      { path: "a.ts", text: "const atmosphere = itemCount; // batman rhythm system" },
    ];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(true);
  });

  it("does not match a lowercase (r) lambda parameter", () => {
    const sources = [{ path: "a.ts", text: "rows.map((r) => r.id).filter((r) => r);" }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(true);
  });

  it("does not match the plain words 'trade' and 'mark' without 'registered'", () => {
    const sources = [{ path: "a.md", text: "Do not use our trade marks or brand marks." }];
    expect(verdict({ sources, brandMd: REAL_BRAND }).ok).toBe(true);
  });
});

describe("verdict — BRAND.md requirements", () => {
  it("fails when BRAND.md is missing", () => {
    expect(hasError(verdict({ sources: [], brandMd: null }), "missing or empty")).toBe(true);
  });

  it("fails when BRAND.md lacks the canonical product name", () => {
    const brandMd = "# Brand\n\nCopyright is owned by the operator.";
    expect(hasError(verdict({ sources: [], brandMd }), "canonical product name")).toBe(true);
  });

  it("fails when BRAND.md lacks a copyright-ownership statement", () => {
    const brandMd = "# Brand\n\nThe product is How2Vote and here are some rules.";
    expect(hasError(verdict({ sources: [], brandMd }), "copyright-ownership")).toBe(true);
  });
});
