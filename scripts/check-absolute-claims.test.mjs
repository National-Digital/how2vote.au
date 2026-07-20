import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  compileTerms,
  parseIsoDate,
  scanCopy,
  stripComments,
  verdict,
} from "./check-absolute-claims.mjs";

const REGISTER = JSON.parse(
  readFileSync(new URL("../docs/legal/absolute-claims.json", import.meta.url), "utf8"),
);

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

// A future/past date relative to a fixed "now" the tests pass in (no Date.now() flakiness).
const NOW = Date.parse("2026-07-20T00:00:00Z");
const FUTURE = "2027-07-20";
const PAST = "2020-01-01";
const CURRENT_EV = new Set(["EV-A", "EV-B"]);

/** A minimal, self-contained register + one page that trips a single banned term. */
const term = (over = {}) => ({
  id: "anonymous",
  label: "an absolute 'anonymous' claim",
  pattern: "\\banonymous\\b",
  prefer: "de-identified",
  ...over,
});
const permit = (over = {}) => ({
  id: "P1",
  claim: "The page calls the survey anonymous.",
  location: "page.svelte",
  claim_type: "privacy",
  term: "anonymous",
  evidence: ["EV-A"],
  evidence_owner: "cameron-young",
  review_date: "2026-07-20",
  expiry_date: FUTURE,
  permitted_qualification: "context",
  prohibited_absolute_wording: "totally anonymous forever",
  ...over,
});
const registerWith = (permits) => ({
  schemaVersion: 1,
  bannedTerms: [term()],
  permittedClaims: permits,
});
const sourceSaying = (text) => [{ path: "page.svelte", text }];

const run = (register, sources, over = {}) =>
  verdict({ register, sources, currentEvidence: CURRENT_EV, now: NOW, ...over });

describe("parseIsoDate", () => {
  it("accepts a bare ISO date and rejects junk", () => {
    expect(parseIsoDate("2026-07-20")).toBeGreaterThan(0);
    expect(parseIsoDate("nope")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });
});

describe("stripComments", () => {
  it("removes JS/HTML comments but keeps URL schemes", () => {
    expect(stripComments("// anonymous\nkeep")).not.toContain("anonymous");
    expect(stripComments("<!-- anonymous -->kept")).not.toContain("anonymous");
    expect(stripComments("see https://x/y")).toContain("https://x/y");
  });
});

describe("compileTerms", () => {
  it("flags a bad regex rather than throwing", () => {
    const { errors } = compileTerms([{ id: "x", label: "x", prefer: "y", pattern: "(" }]);
    expect(errors.some((e) => e.includes("invalid regex"))).toBe(true);
  });
});

describe("scanCopy", () => {
  it("ignores banned words that live only in comments", () => {
    const { terms } = compileTerms([term()]);
    expect(scanCopy(sourceSaying("// the anonymous survey"), terms)).toHaveLength(0);
    expect(scanCopy(sourceSaying("<p>the anonymous survey</p>"), terms)).toHaveLength(1);
  });
});

describe("verdict — coverage", () => {
  it("passes when a current, evidence-backed permit covers the hit", () => {
    const res = run(registerWith([permit()]), sourceSaying("<p>anonymous survey</p>"));
    expect(res.ok).toBe(true);
  });

  it("fails an uncovered banned occurrence and suggests the softer wording", () => {
    const res = run(registerWith([]), sourceSaying("<p>anonymous survey</p>"));
    expect(res.ok).toBe(false);
    expect(hasError(res, "prefer: de-identified")).toBe(true);
  });
});

describe("verdict — permits are evidence-bound (fail-closed)", () => {
  it("treats a permit citing non-current evidence as inactive, re-exposing the hit", () => {
    const res = run(
      registerWith([permit({ evidence: ["EV-PENDING"] })]),
      sourceSaying("<p>anonymous survey</p>"),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "not current in the control register")).toBe(true);
    expect(hasError(res, "is not covered by a current evidence-backed permit")).toBe(true);
  });

  it("treats an expired permit as inactive", () => {
    const res = run(
      registerWith([permit({ expiry_date: PAST })]),
      sourceSaying("<p>anonymous survey</p>"),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "expired at")).toBe(true);
  });
});

describe("verdict — anti-drift", () => {
  it("fails a stale permit whose location no longer contains its term", () => {
    const res = run(registerWith([permit()]), sourceSaying("<p>nothing here</p>"));
    expect(res.ok).toBe(false);
    expect(hasError(res, "stale register entry")).toBe(true);
  });

  it("fails when the prohibited unqualified wording is actually on the page", () => {
    const res = run(
      registerWith([permit()]),
      sourceSaying("<p>anonymous survey — totally anonymous forever</p>"),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "prohibited_absolute_wording appears verbatim")).toBe(true);
  });

  it("fails when a mustContain qualification is missing from the page", () => {
    const res = run(
      registerWith([permit({ mustContain: ["only as group counts"] })]),
      sourceSaying("<p>anonymous survey</p>"),
    );
    expect(res.ok).toBe(false);
    expect(hasError(res, "mustContain phrase not found")).toBe(true);
  });
});

describe("verdict — structure", () => {
  it("rejects a non-object register", () => {
    expect(verdict({ register: null }).ok).toBe(false);
  });

  it("requires the full permit field set", () => {
    const res = run(registerWith([{ id: "P1", term: "anonymous" }]), sourceSaying("<p>x</p>"));
    expect(hasError(res, "missing claim")).toBe(true);
    expect(hasError(res, "missing evidence_owner")).toBe(true);
    expect(hasError(res, "missing permitted_qualification")).toBe(true);
  });

  it("rejects a permit naming an undeclared term", () => {
    const res = run(registerWith([permit({ term: "ghost" })]), sourceSaying("<p>x</p>"));
    expect(hasError(res, 'term "ghost" is not a declared bannedTerm')).toBe(true);
  });
});

describe("the shipped register is clean against a synthetic k-anonymity page", () => {
  it("does not flag the technical term 'k-anonymity'", () => {
    const { terms } = compileTerms(REGISTER.bannedTerms);
    const hits = scanCopy(sourceSaying("<p>published with k-anonymity suppression</p>"), terms);
    expect(hits.filter((h) => h.term === "anonymous")).toHaveLength(0);
  });
});
