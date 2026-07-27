import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verdict } from "./check-legal-review.mjs";

const REAL = JSON.parse(
  readFileSync(new URL("../docs/legal/legal-review.json", import.meta.url), "utf8"),
);

const NOW = Date.parse("2026-07-15T00:00:00Z");
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

describe("verdict — real committed legal-review record", () => {
  it("passes all gates at review time", () => {
    const res = verdict(REAL, { now: NOW, changedPaths: null });
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("gate 1 — freshness", () => {
  it("fails when the last review is more than 12 months old", () => {
    const later = Date.parse("2027-07-28T00:00:00Z"); // just past 12 months (review 2026-07-27)
    expect(hasError(verdict(REAL, { now: later }), "more than 12 months old")).toBe(true);
  });

  it("still passes exactly 12 months later (freshness boundary, isolated)", () => {
    // Strip commencements so only the freshness gate is exercised at the boundary.
    const review = { ...REAL, knownCommencementDates: [] };
    const exactly = Date.parse("2027-07-15T00:00:00Z");
    expect(verdict(review, { now: exactly }).ok).toBe(true);
  });
});

describe("gate 2 — effective-date", () => {
  it("fails once a commencement date is in effect but the review predates it", () => {
    // Move now past 2027-01-01 while the review stays 2026-07-15.
    const after2027 = Date.parse("2027-01-02T00:00:00Z");
    // freshness is still fine (<12mo), so only the effective-date gate should fire
    const res = verdict(REAL, { now: after2027 });
    expect(hasError(res, "post-commencement review is required")).toBe(true);
    expect(hasError(res, "2027-01-01")).toBe(true);
  });

  it("passes when the review was performed on/after the commencement", () => {
    const review = { ...REAL, lastReviewDate: "2027-01-05", nextMandatoryReviewDate: "2028-01-05" };
    const after2027 = Date.parse("2027-01-10T00:00:00Z");
    expect(verdict(review, { now: after2027 }).ok).toBe(true);
  });

  it("the 2026-07-01 transitional commencement is already covered by the 2026-07-15 review", () => {
    // At NOW, 2026-07-01 has passed but lastReviewDate 2026-07-15 >= it, so no error.
    expect(hasError(verdict(REAL, { now: NOW }), "2026-07-01")).toBe(false);
  });
});

describe("gate 3 — data-change", () => {
  it("fails when a sensitive path changes without a legal-review update", () => {
    const changedPaths = ["data/source/2025/ballots.json", "apps/web/src/routes/card/+page.svelte"];
    expect(hasError(verdict(REAL, { now: NOW, changedPaths }), "does not update")).toBe(true);
  });

  it("passes when the sensitive change also updates legal-review.json", () => {
    const changedPaths = ["data/source/2025/ballots.json", "docs/legal/legal-review.json"];
    expect(verdict(REAL, { now: NOW, changedPaths }).ok).toBe(true);
  });

  it("covers consent, research-ingestion and answer-scoring code", () => {
    for (const p of [
      "apps/web/src/lib/privacy/consent.svelte.ts",
      "apps/web/functions/api/research.ts",
      "apps/web/functions/api/research/geography.ts",
      "packages/engine/src/answers.ts",
    ]) {
      const res = verdict(REAL, { now: NOW, changedPaths: [p] });
      expect(res.ok, `${p} should be treated as sensitive`).toBe(false);
      expect(hasError(res, "does not update")).toBe(true);
    }
  });

  it("ignores non-sensitive changes", () => {
    const changedPaths = ["README.md", "apps/web/src/routes/about/+page.svelte"];
    expect(verdict(REAL, { now: NOW, changedPaths }).ok).toBe(true);
  });

  it("skips the data-change gate when no diff is provided", () => {
    expect(verdict(REAL, { now: NOW, changedPaths: null }).ok).toBe(true);
  });
});
