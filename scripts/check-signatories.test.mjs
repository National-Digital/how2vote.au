import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isIdReference, verdict } from "./check-signatories.mjs";

const REGISTRY = JSON.parse(
  readFileSync(new URL("../docs/legal/signatories.json", import.meta.url), "utf8"),
);

const NOW = Date.parse("2026-07-17T00:00:00Z");
const clone = (v) => JSON.parse(JSON.stringify(v));
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));
const opts = (extra = {}) => ({ now: NOW, ...extra });

describe("verdict — real committed registry", () => {
  it("passes with the real registry and no references", () => {
    const res = verdict(REGISTRY, opts());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("fails closed on non-object input", () => {
    expect(verdict(null, opts()).ok).toBe(false);
    expect(verdict([], opts()).ok).toBe(false);
    expect(verdict("x", opts()).ok).toBe(false);
  });
});

describe("registry validation", () => {
  it("rejects a duplicate id", () => {
    const r = clone(REGISTRY);
    r.signatories.push(clone(r.signatories[0]));
    const res = verdict(r, opts());
    expect(res.ok).toBe(false);
    expect(hasError(res, "duplicate id")).toBe(true);
  });

  it("rejects an invalid GitHub handle", () => {
    const r = clone(REGISTRY);
    r.signatories[0].githubHandle = "-bad-";
    expect(hasError(verdict(r, opts()), "githubHandle")).toBe(true);
  });

  it("rejects a malformed LinkedIn URL", () => {
    const r = clone(REGISTRY);
    r.signatories[0].linkedin = "http://linkedin.com/in/x";
    expect(hasError(verdict(r, opts()), "linkedin")).toBe(true);
  });

  it("requires sameAs to include the GitHub URL", () => {
    const r = clone(REGISTRY);
    r.signatories[0].sameAs = r.signatories[0].sameAs.filter(
      (u) => !u.startsWith("https://github.com/"),
    );
    expect(hasError(verdict(r, opts()), "must include the GitHub URL")).toBe(true);
  });

  it("rejects an undeclared scope domain", () => {
    const r = clone(REGISTRY);
    r.signatories[0].signOffScope = ["not-a-domain"];
    expect(hasError(verdict(r, opts()), "undeclared domain")).toBe(true);
  });

  it("treats a future activeFrom as not-yet-active", () => {
    const r = clone(REGISTRY);
    r.signatories[0].activeFrom = "2099-01-01";
    const res = verdict(r, {
      now: NOW,
      references: [{ where: "x", reviewer: r.signatories[0].id }],
    });
    expect(hasError(res, "not an active signatory")).toBe(true);
  });
});

describe("referential integrity", () => {
  it("resolves an id-shaped reviewer reference to an active signatory", () => {
    const res = verdict(REGISTRY, {
      now: NOW,
      references: [{ where: "aec 2025", reviewer: "cameron-young", domain: "candidate-data" }],
    });
    expect(res.ok).toBe(true);
  });

  it("fails an unresolved id-shaped reference", () => {
    const res = verdict(REGISTRY, {
      now: NOW,
      references: [{ where: "aec 2025", reviewer: "someone-missing" }],
    });
    expect(hasError(res, "does not resolve")).toBe(true);
  });

  it("exempts an external/legacy descriptor (contains whitespace)", () => {
    const res = verdict(REGISTRY, {
      now: NOW,
      references: [
        { where: "x", reviewer: "Australian legal practitioner — periodic compliance review" },
        { where: "y", reviewer: "Cameron (National Digital)" },
        { where: "z", reviewer: null },
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("enforces scope coverage when a domain is given", () => {
    const r = clone(REGISTRY);
    r.signatories[0].signOffScope = ["privacy"];
    const res = verdict(r, {
      now: NOW,
      references: [{ where: "aec", reviewer: r.signatories[0].id, domain: "candidate-data" }],
    });
    expect(hasError(res, "scope does not cover")).toBe(true);
  });
});

describe("isIdReference", () => {
  it("recognises kebab ids and rejects descriptors", () => {
    expect(isIdReference("cameron-young")).toBe(true);
    expect(isIdReference("tara-buckley")).toBe(true);
    expect(isIdReference("Cameron (National Digital)")).toBe(false);
    expect(isIdReference(null)).toBe(false);
    expect(isIdReference("solo")).toBe(false);
  });
});
