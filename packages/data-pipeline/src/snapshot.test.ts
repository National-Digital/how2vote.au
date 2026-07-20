import { describe, expect, it } from "vitest";
import { ELECTIONS, type QuestionSet, type SnapshotMeta } from "@how2vote/data-schema";
import { filterDivisionsToVintage, guardFetch, guardLock, mergeQuestions } from "./snapshot.js";
import type { CompiledPolicy, TvfyPolicyDetail } from "./tvfy.js";

const election2025 = ELECTIONS.find((e) => e.id === "2025")!;

const snapshotMeta = (over: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  schemaVersion: 2,
  electionId: "2025",
  version: 1,
  source: "tvfy-api",
  basis: "contemporaneous-api-snapshot",
  endpoint: "https://theyvoteforyou.org.au/api/v1",
  retrievedAt: "2025-04-01T00:00:00.000Z",
  responseSha256: "0".repeat(64),
  apiSchemaVersion: "v1",
  licenceVersion: "ODbL-1.0",
  effectiveAsAt: null,
  locked: false,
  lockedAt: null,
  policyIds: [32],
  files: {},
  ...over,
});

const locked = snapshotMeta({ locked: true, lockedAt: "2025-04-11T02:00:00.000Z" });

// AEC 2025 milestones: writ 2025-03-31, declaration 2025-04-11T12:00+10:00, polls close 05-03.
const preWrit = new Date("2025-03-15T00:00:00+10:00");
const inWindow = new Date("2025-04-05T00:00:00+10:00");
const postDeclaration = new Date("2025-04-20T00:00:00+10:00");
const postPolls = new Date("2025-06-01T00:00:00+10:00");

describe("guardFetch", () => {
  it("refuses without a timetable, pointing at the ELECTIONS registry", () => {
    const { timetable, ...noTimetable } = election2025;
    void timetable;
    const verdict = guardFetch(noTimetable, null, inWindow, { force: false, newVersion: false });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal).toContain("elections.ts");
  });

  it("allows a fetch inside the writ window", () => {
    expect(guardFetch(election2025, null, inWindow, { force: false, newVersion: false }).ok).toBe(
      true,
    );
  });

  it("refuses outside the writ window unless forced (API hygiene)", () => {
    for (const now of [preWrit, postDeclaration]) {
      const verdict = guardFetch(election2025, null, now, { force: false, newVersion: false });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.refusal).toContain("writ window");
    }
    const forced = guardFetch(election2025, null, preWrit, { force: true, newVersion: false });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.warnings[0]).toContain("--force");
  });

  it("a lock is absolute: --force cannot refresh a locked version", () => {
    const verdict = guardFetch(election2025, locked, inWindow, { force: true, newVersion: false });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal).toContain("--new-version");
  });

  it("--new-version passes a lock (verified correction) but not an unlocked snapshot", () => {
    expect(guardFetch(election2025, locked, inWindow, { force: true, newVersion: true }).ok).toBe(
      true,
    );
    expect(
      guardFetch(election2025, snapshotMeta(), inWindow, { force: false, newVersion: true }).ok,
    ).toBe(false);
  });
});

describe("guardLock", () => {
  it("refuses before the declaration of nominations unless forced (rehearsal)", () => {
    const verdict = guardLock(election2025, snapshotMeta(), inWindow, { force: false });
    expect(verdict.ok).toBe(false);
    const rehearsal = guardLock(election2025, snapshotMeta(), inWindow, { force: true });
    expect(rehearsal.ok).toBe(true);
    if (rehearsal.ok) expect(rehearsal.warnings[0]).toContain("rehearsal");
  });

  it("allows the lock from the declaration instant and warns after polls close", () => {
    expect(guardLock(election2025, snapshotMeta(), postDeclaration, { force: false }).ok).toBe(
      true,
    );
    const late = guardLock(election2025, snapshotMeta(), postPolls, { force: false });
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.warnings.some((w) => w.includes("Polls closed"))).toBe(true);
  });

  it("never relocks a locked version", () => {
    const verdict = guardLock(election2025, locked, postDeclaration, { force: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.refusal).toContain("already LOCKED");
  });
});

describe("mergeQuestions", () => {
  const questions: QuestionSet = {
    schemaVersion: 1,
    dataVersion: "2020-01-01",
    attribution: "Vote data © They Vote For You (OpenAustralia Foundation), ODbL",
    questions: [
      {
        id: 32,
        text: "Hand-curated wording stays.",
        positions: { old_party: 1 },
        withdrawn: { date: "2025-04-20", reason: "under review" },
      },
      { id: 6, text: "Second question.", positions: { old_party: 2 } },
    ],
  };
  const compiled = new Map<number, CompiledPolicy>([
    [
      32,
      {
        id: 32,
        title: "t",
        description: "d",
        divisionCount: 3,
        divisionFirst: "2018-06-18",
        divisionLast: "2025-03-26",
        positions: { australian_labor_party: 2 },
      },
    ],
    [
      6,
      {
        id: 6,
        title: "t",
        description: "d",
        divisionCount: 1,
        divisionFirst: "2025-03-28",
        divisionLast: "2025-03-28",
        positions: { australian_labor_party: 5 },
      },
    ],
  ]);

  it("replaces positions/divisions wholesale, keeps text/order/withdrawn, bumps dataVersion", () => {
    const merged = mergeQuestions(questions, compiled);
    expect(merged.questions.map((q) => q.id)).toEqual([32, 6]);
    expect(merged.questions[0]).toEqual({
      id: 32,
      text: "Hand-curated wording stays.",
      divisionFirst: "2018-06-18",
      divisionLast: "2025-03-26",
      divisionCount: 3,
      positions: { australian_labor_party: 2 },
      withdrawn: { date: "2025-04-20", reason: "under review" },
    });
    expect(merged.dataVersion).toBe("2025-03-28"); // max divisionLast across questions
    expect(merged.attribution).toBe(questions.attribution);
  });

  it("throws when a question has no snapshot policy", () => {
    expect(() => mergeQuestions(questions, new Map())).toThrow(/no snapshot policy/);
  });
});

describe("filterDivisionsToVintage", () => {
  const detail: TvfyPolicyDetail = {
    id: 32,
    name: "n",
    description: "d",
    policy_divisions: [
      { division: { date: "2018-06-18" } },
      { division: { date: "2019-05-09" } },
      { division: { date: "2024-11-27" } },
    ],
    people_comparisons: [],
  };

  it("keeps divisions on/before the vintage and drops later curation", () => {
    const filtered = filterDivisionsToVintage(detail, "2019-05-09");
    expect(filtered.policy_divisions.map((d) => d.division.date)).toEqual([
      "2018-06-18",
      "2019-05-09",
    ]);
  });

  it("can leave zero divisions (caller warns and omits fields)", () => {
    expect(filterDivisionsToVintage(detail, "2017-01-01").policy_divisions).toEqual([]);
  });
});
