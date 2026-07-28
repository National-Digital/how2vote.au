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
  const SENSITIVE = ["data/source/2025/ballots.json", "docs/legal/legal-review.json"];
  const SIGNATORIES = new Set(["cameron-young", "tara-buckley"]);
  /** The record unchanged since the base: a sensitive PR that adds no approval. */
  const unchanged = (extra = {}) => ({
    now: NOW,
    changedPaths: SENSITIVE,
    baseChangeLog: REAL.changeLog,
    activeSignatories: SIGNATORIES,
    ...extra,
  });
  /** The record with `entry` appended, as a PR would add it. */
  const withEntry = (entry, extra = {}) => [
    { ...REAL, changeLog: [...REAL.changeLog, entry], ...(extra.review ?? {}) },
    unchanged(extra.options),
  ];
  const APPROVED = {
    date: "2026-07-15",
    change: "Ballot order recompiled from the published AEC result.",
    disposition: "no-review-required",
    reviewer: "cameron-young",
    affectedControls: [],
  };

  it("fails when a sensitive path changes without a legal-review update", () => {
    const changedPaths = ["data/source/2025/ballots.json", "apps/web/src/routes/card/+page.svelte"];
    const res = verdict(REAL, unchanged({ changedPaths }));
    expect(hasError(res, "adds no changeLog entry")).toBe(true);
  });

  it("is NOT satisfied by merely touching legal-review.json", () => {
    // The whole point of the gate: the file is in the diff, but no approval was added.
    const res = verdict(REAL, unchanged());
    expect(res.ok).toBe(false);
    expect(hasError(res, "adds no changeLog entry")).toBe(true);
  });

  it("passes when the PR adds an entry with a named active signatory and a disposition", () => {
    expect(verdict(...withEntry(APPROVED)).ok).toBe(true);
  });

  it("fails when the added entry names nobody", () => {
    const { reviewer: _reviewer, ...noReviewer } = APPROVED;
    expect(hasError(verdict(...withEntry(noReviewer)), "reviewer must be a signatory id")).toBe(
      true,
    );
  });

  it("fails when the named approver is not an active signatory", () => {
    const res = verdict(...withEntry({ ...APPROVED, reviewer: "someone-else" }));
    expect(hasError(res, '"someone-else" is not an active signatory')).toBe(true);
  });

  it("does not accept an external free-text descriptor as the approver", () => {
    // check-signatories exempts whitespace descriptors from resolution; this gate must not, or the
    // named-approver requirement would be satisfiable by typing a phrase.
    const res = verdict(...withEntry({ ...APPROVED, reviewer: "External Adviser" }));
    expect(hasError(res, "reviewer must be a signatory id")).toBe(true);
  });

  it("fails when the disposition is missing or unknown", () => {
    const { disposition: _disposition, ...none } = APPROVED;
    expect(hasError(verdict(...withEntry(none)), "disposition must be one of")).toBe(true);
    const bogus = { ...APPROVED, disposition: "fine" };
    expect(hasError(verdict(...withEntry(bogus)), "disposition must be one of")).toBe(true);
  });

  it('requires a "reviewed" entry to advance lastReviewDate', () => {
    const reviewed = { ...APPROVED, date: "2026-07-26", disposition: "reviewed" };
    const now = Date.parse("2026-07-27T00:00:00Z");
    // REAL.lastReviewDate is 2026-07-27, which is on/after the entry — accepted.
    expect(verdict(...withEntry(reviewed, { options: { now } })).ok).toBe(true);
    // A review claimed AFTER the recorded review date is a contradiction.
    const later = { ...reviewed, date: "2026-07-27" };
    const res = verdict(
      { ...REAL, lastReviewDate: "2026-07-20", changeLog: [...REAL.changeLog, later] },
      unchanged({ now }),
    );
    expect(hasError(res, "requires lastReviewDate to be on or after 2026-07-27")).toBe(true);
  });

  it("rejects a duplicate second reviewer and a future-dated entry", () => {
    const same = { ...APPROVED, secondReviewer: "cameron-young" };
    expect(hasError(verdict(...withEntry(same)), "different person")).toBe(true);
    const future = { ...APPROVED, date: "2026-08-01" };
    expect(hasError(verdict(...withEntry(future)), "is in the future")).toBe(true);
  });

  it("rejects a whitespace-padded duplicate second reviewer", () => {
    // Resolution trims before matching, so " cameron-young" is the same person — the distinctness
    // check must compare what resolves, not the raw strings.
    const padded = { ...APPROVED, secondReviewer: " cameron-young" };
    expect(hasError(verdict(...withEntry(padded)), "different person")).toBe(true);
  });

  it("treats the legal registers themselves as sensitive", () => {
    // Without this, a PR touching nothing else could advance lastReviewDate (resetting the
    // freshness clock), rewrite changeLog history or edit the signatory registry unapproved.
    for (const p of ["docs/legal/legal-review.json", "docs/legal/signatories.json"]) {
      const res = verdict(REAL, unchanged({ changedPaths: [p] }));
      expect(res.ok, `${p} should be treated as sensitive`).toBe(false);
      expect(hasError(res, "adds no changeLog entry")).toBe(true);
    }
  });

  it("accepts an entry dated today in an ahead-of-UTC timezone", () => {
    // 09:00 AEST on the 28th is still the 27th in UTC; the local date must not read as future.
    const aest = Date.parse("2026-07-27T23:00:00Z");
    const today = { ...APPROVED, date: "2026-07-28" };
    expect(verdict(...withEntry(today, { options: { now: aest } })).ok).toBe(true);
  });

  it("re-validates a historical entry that this PR edited", () => {
    // Not byte-identical to the base revision ⇒ treated as added, so it must carry an approval.
    const edited = REAL.changeLog.map((e, i) => (i === 0 ? { ...e, change: "reworded" } : e));
    const res = verdict({ ...REAL, changeLog: edited }, unchanged());
    expect(hasError(res, "changeLog[0]")).toBe(true);
  });

  it("fails closed when the signatory registry is unavailable", () => {
    const res = verdict(...withEntry(APPROVED, { options: { activeSignatories: null } }));
    expect(hasError(res, "signatory registry is unavailable")).toBe(true);
  });

  it("covers consent, research-ingestion and answer-scoring code", () => {
    for (const p of [
      "apps/web/src/lib/privacy/consent.svelte.ts",
      "apps/web/functions/api/research.ts",
      "apps/web/functions/api/research/geography.ts",
      "packages/engine/src/answers.ts",
    ]) {
      const res = verdict(REAL, unchanged({ changedPaths: [p] }));
      expect(res.ok, `${p} should be treated as sensitive`).toBe(false);
      expect(hasError(res, "adds no changeLog entry")).toBe(true);
    }
  });

  it("ignores non-sensitive changes", () => {
    const changedPaths = ["README.md", "apps/web/src/routes/about/+page.svelte"];
    expect(verdict(REAL, unchanged({ changedPaths })).ok).toBe(true);
  });

  it("skips the data-change gate when no diff is provided", () => {
    expect(verdict(REAL, { now: NOW, changedPaths: null }).ok).toBe(true);
  });
});
