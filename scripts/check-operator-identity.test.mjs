import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-operator-identity.mjs";

const REAL = JSON.parse(
  readFileSync(new URL("../apps/web/src/lib/operator.json", import.meta.url), "utf8"),
);

const NOW = Date.parse("2026-07-15T00:00:00Z");
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed operator record", () => {
  it("is complete and well-formed", () => {
    const res = verdict(REAL, { now: NOW, sources: [] });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("has a future privacy-act review date", () => {
    expect(verdict(REAL, { now: NOW, sources: [] }).ok).toBe(true);
    // one year later, the review is overdue
    const later = Date.parse("2027-08-01T00:00:00Z");
    expect(hasError(verdict(REAL, { now: later, sources: [] }), "review overdue")).toBe(true);
  });
});

describe("verdict — required fields", () => {
  it("flags a missing required string", () => {
    const op = { ...REAL, tradingName: "" };
    expect(hasError(verdict(op, { now: NOW }), "missing tradingName")).toBe(true);
  });

  it("flags a privacyAct without a legal basis", () => {
    const op = { ...REAL, privacyAct: { ...REAL.privacyAct, legalBasis: "" } };
    expect(hasError(verdict(op, { now: NOW }), "legalBasis is required")).toBe(true);
  });

  it("flags a missing authorisation block", () => {
    const op = { ...REAL, authorisation: undefined };
    expect(hasError(verdict(op, { now: NOW }), "missing authorisation")).toBe(true);
  });
});

describe("verdict — no second hard-coded entity", () => {
  it("flags source that hard-codes the ABN", () => {
    const sources = [{ path: "apps/web/src/lib/rogue.ts", text: `const abn = "13 744 838 758";` }];
    expect(hasError(verdict(REAL, { now: NOW, sources }), "hard-codes the operator ABN")).toBe(
      true,
    );
  });

  it("flags source that hard-codes the ACN", () => {
    const sources = [{ path: "apps/web/src/lib/rogue.ts", text: `const acn = "658 447 280";` }];
    expect(hasError(verdict(REAL, { now: NOW, sources }), "hard-codes the operator ACN")).toBe(
      true,
    );
  });

  it("flags source that hard-codes the legal name", () => {
    const sources = [
      {
        path: "apps/web/src/routes/rogue/+page.svelte",
        text: "<p>General Consulting Services Pty Ltd</p>",
      },
    ];
    expect(
      hasError(verdict(REAL, { now: NOW, sources }), "hard-codes the operator legal name"),
    ).toBe(true);
  });

  it("catches a legal name that reflows across lines (whitespace-normalised)", () => {
    const sources = [
      {
        path: "apps/web/src/routes/rogue/+page.svelte",
        text: "<p>General Consulting\n  Services Pty Ltd, a great company</p>",
      },
    ];
    expect(
      hasError(verdict(REAL, { now: NOW, sources }), "hard-codes the operator legal name"),
    ).toBe(true);
  });

  it("catches an ABN reflowed across a real newline", () => {
    const sources = [{ path: "x.ts", text: "const abn = `13744\n838758`;" }];
    expect(hasError(verdict(REAL, { now: NOW, sources }), "hard-codes the operator ABN")).toBe(
      true,
    );
  });

  it("ignores operator.json itself", () => {
    const sources = [
      { path: "apps/web/src/lib/operator.json", text: JSON.stringify(REAL) },
      { path: "apps/web/src/lib/org.ts", text: "import operator from './operator.json';" },
    ];
    expect(verdict(REAL, { now: NOW, sources }).ok).toBe(true);
  });
});

describe("verdict — privacyAct date sanity", () => {
  it("flags a determination dated after its own review date", () => {
    const op = {
      ...REAL,
      privacyAct: {
        ...REAL.privacyAct,
        determinationDate: "2028-01-01",
        nextReviewDate: "2027-07-15",
      },
    };
    expect(hasError(verdict(op, { now: NOW }), "after nextReviewDate")).toBe(true);
  });
});
