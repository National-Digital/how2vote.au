import { describe, expect, it } from "vitest";
import {
  ELECTIONS,
  electionMetaSchema,
  electionPhase,
  electionStage,
  isArchivedElection,
  isPollingDayNoticeWindow,
  writWindow,
  type ElectionMeta,
} from "./elections.js";

const election2025 = ELECTIONS.find((e) => e.id === "2025")!;
// Scheduled elections have an AEC timetable; a placeholder upcoming election (e.g. "next") targets a
// parliament period before the election is announced, so it has no timetable and carries a
// provisionalStage instead.
const scheduled = ELECTIONS.filter((e) => e.timetable);
const placeholders = ELECTIONS.filter((e) => !e.timetable);

describe("election registry", () => {
  it("every shipped election validates; scheduled ones carry an AEC timetable with a source", () => {
    for (const e of ELECTIONS) expect(() => electionMetaSchema.parse(e)).not.toThrow();
    for (const e of scheduled) {
      expect(e.timetable!.source).toMatch(/^https:\/\/www\.aec\.gov\.au\//);
      expect(e.date).toBeDefined(); // a scheduled election has a polling day
      expect(e.provisionalStage).toBeUndefined();
    }
  });

  it("a placeholder (no-timetable) election is upcoming and carries a provisionalStage, no date", () => {
    for (const e of placeholders) {
      expect(e.provisionalStage).toBeDefined();
      expect(e.date).toBeUndefined();
      expect(electionPhase(e, new Date())).toBe("upcoming");
    }
  });

  it("has exactly one current election", () => {
    // The registry documents "Exactly one election is current" but nothing else enforces it:
    // CURRENT_ELECTION_ID just takes the first current entry (newest-first), so two currents would
    // silently pick one and zero would fall back to ELECTIONS[0]. Adding an election flips `current`
    // from the old to the new one by hand (docs/adding-an-election.md step 4) — this guards that
    // manual, otherwise-unchecked flip so a stray or missing `current: true` fails loudly.
    expect(ELECTIONS.filter((e) => e.current)).toHaveLength(1);
  });

  it("has a unique id per election", () => {
    // ids double as on-disk directory names, URL/share tokens and localStorage namespaces, so a
    // collision would cross-contaminate datasets and saved progress.
    const ids = ELECTIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("electionStage — AEC timetable boundaries (no magic-number offsets)", () => {
  it("classifies each stage against the 2025 milestones", () => {
    const before = new Date("2025-04-01T00:00:00+10:00");
    const campaign = new Date("2025-04-30T00:00:00+10:00");
    const afterPolls = new Date("2025-05-20T00:00:00+10:00");
    const afterWrits = new Date("2026-07-14T00:00:00+10:00");
    expect(electionStage(election2025, before)).toBe("pre-declaration");
    expect(electionStage(election2025, campaign)).toBe("live");
    expect(electionStage(election2025, afterPolls)).toBe("post-election");
    expect(electionStage(election2025, afterWrits)).toBe("historical");
  });

  it("treats the polls-close instant as the last national close (8pm AEST = 6pm AWST)", () => {
    // 7:30pm AEST on polling day: WA polls (AWST) are still open, so it is still 'live'.
    expect(electionStage(election2025, new Date("2025-05-03T19:30:00+10:00"))).toBe("live");
    // 8:30pm AEST: polls have closed everywhere → post-election.
    expect(electionStage(election2025, new Date("2025-05-03T20:30:00+10:00"))).toBe(
      "post-election",
    );
  });

  it("is 'unknown' when no timetable is recorded", () => {
    const { timetable, ...noTimetable } = election2025;
    void timetable;
    expect(electionStage(noTimetable, new Date())).toBe("unknown");
  });
});

describe("electionPhase", () => {
  it("maps stages to product phases and never opens a live plan without a timetable", () => {
    expect(electionPhase(election2025, new Date("2025-04-01T00:00:00+10:00"))).toBe("upcoming");
    expect(electionPhase(election2025, new Date("2025-04-30T00:00:00+10:00"))).toBe("live");
    expect(electionPhase(election2025, new Date("2025-05-20T00:00:00+10:00"))).toBe("archived");
    const { timetable, ...noTimetable } = election2025;
    void timetable;
    expect(electionPhase(noTimetable, new Date())).toBe("upcoming");
  });

  it("reports every scheduled election as archived today (all have been held)", () => {
    const now = new Date("2026-07-14T00:00:00+10:00");
    for (const e of scheduled) expect(isArchivedElection(e, now)).toBe(true);
    // A placeholder upcoming election is never archived — it has not been held.
    for (const e of placeholders) expect(isArchivedElection(e, now)).toBe(false);
  });
});

describe("electionMeta refinements — placeholder vs scheduled", () => {
  it("rejects a timetable-bearing election with no polling day", () => {
    const { date, ...noDate } = election2025;
    void date;
    expect(() => electionMetaSchema.parse(noDate)).toThrow();
  });

  it("rejects provisionalStage alongside a timetable (lifecycle must come from one source)", () => {
    expect(() =>
      electionMetaSchema.parse({ ...election2025, provisionalStage: "pending" }),
    ).toThrow();
  });

  it("accepts a placeholder with no timetable, no date, and a provisionalStage", () => {
    const placeholder = {
      id: "next-test",
      year: 2028,
      label: "Next Federal Election",
      shortLabel: "Next",
      current: false,
      provisionalStage: "pending" as const,
      dataVersion: "2026-06-23",
    };
    expect(() => electionMetaSchema.parse(placeholder)).not.toThrow();
  });
});

describe("writWindow — the only period a live TVFY snapshot fetch is permitted", () => {
  it("opens at midnight AEST on the day the writs issue and closes at the declaration", () => {
    const w = writWindow(election2025)!;
    expect(w.start).toBe(Date.parse("2025-03-31T00:00:00+10:00"));
    expect(w.end).toBe(Date.parse("2025-04-11T12:00:00+10:00"));

    const dayBeforeWrit = Date.parse("2025-03-30T23:59:59+10:00");
    const writMidnight = Date.parse("2025-03-31T00:00:00+10:00");
    const beforeNoon = Date.parse("2025-04-11T11:59:59+10:00");
    const declaration = Date.parse("2025-04-11T12:00:00+10:00");
    expect(dayBeforeWrit < w.start).toBe(true);
    expect(writMidnight >= w.start && writMidnight < w.end).toBe(true);
    expect(beforeNoon >= w.start && beforeNoon < w.end).toBe(true);
    // The declaration instant itself is OUTSIDE the window: from here the snapshot locks.
    expect(declaration < w.end).toBe(false);
  });

  it("is null without a timetable (the election must be registered first)", () => {
    const { timetable, ...noTimetable } = election2025;
    void timetable;
    expect(writWindow(noTimetable)).toBeNull();
  });
});

describe("isPollingDayNoticeWindow — 00:00 to pollsCloseAt on polling day", () => {
  // A future election so the window is testable independently of the wall clock (all shipped
  // elections are already archived, so their windows are fixed in the past).
  const future: ElectionMeta = {
    ...election2025,
    id: "future",
    year: 2028,
    date: "2028-05-20",
    current: false,
    timetable: {
      ...election2025.timetable!,
      declarationOfNominations: "2028-04-28T12:00:00+10:00",
      pollsCloseAt: "2028-05-20T20:00:00+10:00",
      returnOfWrits: "2028-06-30T23:59:59+10:00",
    },
  };

  it("is closed from 00:00 AEST on polling day until (not including) 8pm AEST", () => {
    // The evening before polling day: open.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-19T23:59:59+10:00"))).toBe(false);
    // Midnight, start of polling day (inclusive): closed.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-20T00:00:00+10:00"))).toBe(true);
    // Middle of polling day: closed.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-20T12:00:00+10:00"))).toBe(true);
    // One second before the last national close: still closed.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-20T19:59:59+10:00"))).toBe(true);
    // 8pm AEST — polls closed everywhere (pollsCloseAt, exclusive): open again.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-20T20:00:00+10:00"))).toBe(false);
  });

  it("uses fixed instants, so a non-AEST viewer gets the same answer", () => {
    // 12:00 UTC on polling day = 22:00 AEST → after 8pm close → open.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-20T12:00:00Z"))).toBe(false);
    // 03:00 UTC on polling day = 13:00 AEST → within the window → closed.
    expect(isPollingDayNoticeWindow(future, new Date("2028-05-20T03:00:00Z"))).toBe(true);
  });

  it("never re-triggers for a past election, whatever the clock says", () => {
    const now = new Date("2026-07-14T12:00:00+10:00");
    for (const e of ELECTIONS) expect(isPollingDayNoticeWindow(e, now)).toBe(false);
  });

  it("is false when no timetable is recorded", () => {
    const { timetable, ...noTimetable } = future;
    void timetable;
    expect(isPollingDayNoticeWindow(noTimetable, new Date("2028-05-20T12:00:00+10:00"))).toBe(
      false,
    );
  });
});
