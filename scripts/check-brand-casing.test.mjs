import { describe, expect, it } from "vitest";
import { verdict } from "./check-brand-casing.mjs";

const src = (text, path = "a.ts") => ({ sources: [{ path, text }] });
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

// Every case below states its expectation as a LITERAL. Nothing is derived from the guard's own
// constants, so a mutation to those constants fails these tests instead of silently agreeing.

describe("verdict — identifier shapes must be lower case", () => {
  const CASES = [
    {
      label: "a domain",
      bad: "see https://How2Vote.au/privacy",
      good: "see https://how2vote.au/privacy",
    },
    { label: "a domain", bad: "forms@send.How2Vote.au", good: "forms@send.how2vote.au" },
    {
      label: "an application id",
      bad: 'appId: "au.How2Vote.app"',
      good: 'appId: "au.how2vote.app"',
    },
    { label: "a package scope", bad: 'from "@How2Vote/engine"', good: 'from "@how2vote/engine"' },
    { label: "a storage or cache key", bad: '"How2Vote:quiz:v2"', good: '"how2vote:quiz:v2"' },
    {
      label: "a tool or function name",
      bad: "How2Vote_find_electorate",
      good: "how2vote_find_electorate",
    },
    {
      label: "an infrastructure name",
      bad: "database_name = How2Vote-research",
      good: "database_name = how2vote-research",
    },
    {
      label: "a file or asset name",
      bad: "docs/brand/How2Vote-mark.svg",
      good: "docs/brand/how2vote-mark.svg",
    },
    {
      label: "an email address",
      bad: "How2Vote@nationaldigital.com.au",
      good: "how2vote@nationaldigital.com.au",
    },
  ];

  for (const { label, bad, good } of CASES) {
    it(`flags ${label} in ${JSON.stringify(bad)}`, () => {
      const res = verdict(src(bad));
      expect(res.ok).toBe(false);
      expect(hasError(res, label)).toBe(true);
    });

    it(`accepts the lower-case form ${JSON.stringify(good)}`, () => {
      expect(verdict(src(good))).toEqual({ ok: true, errors: [] });
    });
  }

  it("flags ALL-CAPS in an identifier, not just title case", () => {
    expect(verdict(src("HOW2VOTE:consent:v1")).ok).toBe(false);
  });

  it("flags an inner capital", () => {
    expect(verdict(src("how2Vote_list_candidates")).ok).toBe(false);
  });

  it("reports the 1-indexed line of the offending identifier", () => {
    const res = verdict(src('const a = 1;\nconst b = 2;\nimport "@How2Vote/engine";\n'));
    expect(res.errors[0]).toContain("a.ts:3:");
  });

  it("reports every offender, not just the first", () => {
    const res = verdict(src('"@How2Vote/engine" and "au.How2Vote.app"'));
    expect(res.errors).toHaveLength(2);
  });
});

describe("verdict — prose is not policed", () => {
  // The guard enforces the identifier direction ONLY. These must all pass: they are text a person
  // reads, where How2Vote is the correct spelling.
  const PROSE = [
    "How2Vote is an independent tool.",
    "the How2Vote-branded card", // hyphen in prose is not an infrastructure name
    "How2Vote/National Digital", // slash in prose is not a package scope
    "How2Vote's accessibility commitment",
    "About How2Vote — vote on their record",
    'aria-label="How2Vote"',
    "<title>Terms of use — How2Vote</title>",
  ];

  for (const text of PROSE) {
    it(`accepts ${JSON.stringify(text)}`, () => {
      expect(verdict(src(text, "page.svelte"))).toEqual({ ok: true, errors: [] });
    });
  }

  it("accepts the lower-case wordmark spelling in prose about the artwork", () => {
    expect(verdict(src("The wordmark sets the name in lower case, as how[2]vote.")).ok).toBe(true);
  });
});

describe("verdict — committed paths", () => {
  it("flags a title-cased path", () => {
    const res = verdict({ paths: ["docs/brand/How2Vote-mark.svg"] });
    expect(res.ok).toBe(false);
    expect(hasError(res, "committed path")).toBe(true);
  });

  it("accepts lower-case paths", () => {
    const res = verdict({
      paths: ["docs/brand/how2vote-mark.svg", "docs/fdroid/au.how2vote.app.yml"],
    });
    expect(res).toEqual({ ok: true, errors: [] });
  });
});

describe("verdict — input handling", () => {
  it("is clean on empty input", () => {
    expect(verdict()).toEqual({ ok: true, errors: [] });
    expect(verdict({})).toEqual({ ok: true, errors: [] });
  });

  it("skips non-string source text without throwing", () => {
    expect(verdict({ sources: [{ path: "a.ts", text: null }] }).ok).toBe(true);
  });

  it("does not leak regex state between sources", () => {
    // The shape patterns are module-level and /g is stateful; a missing lastIndex reset would make
    // the SECOND source's offender invisible. Both must be reported.
    const res = verdict({
      sources: [
        { path: "one.ts", text: '"@How2Vote/engine"' },
        { path: "two.ts", text: '"@How2Vote/web"' },
      ],
    });
    expect(res.errors).toHaveLength(2);
    expect(hasError(res, "one.ts")).toBe(true);
    expect(hasError(res, "two.ts")).toBe(true);
  });
});

describe("verdict — overlapping shapes report once", () => {
  it("labels au.How2Vote.app as an application id, not a domain", () => {
    const res = verdict(src('appId: "au.How2Vote.app"'));
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("an application id");
  });

  it("still reports a plain domain as a domain", () => {
    const res = verdict(src("https://How2Vote.au"));
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("a domain");
  });
});
