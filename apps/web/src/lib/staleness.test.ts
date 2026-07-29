import { describe, expect, it } from "vitest";
import { assessStaleness } from "./staleness";
import type { ElectionMeta } from "@how2vote/data-schema";

// A live-election fixture with a real timetable, plus a past record so `newest dataVersion` works.
const past: ElectionMeta = {
  schemaVersion: 1,
  id: "2025",
  year: 2025,
  label: "2025",
  shortLabel: "2025",
  current: false,
  timetable: {
    issueOfWrit: "2025-03-31",
    closeOfRolls: "2025-04-07",
    closeOfNominations: "2025-04-10",
    declarationOfNominations: "2025-04-11T12:00:00+10:00",
    pollsCloseAt: "2025-05-03T20:00:00+10:00",
    returnOfWrits: "2025-06-30T23:59:59+10:00",
    source: "https://aec.gov.au/2025",
  },
  dataVersion: "2025-03-28",
} as ElectionMeta;

function current(overrides: Partial<ElectionMeta>): ElectionMeta[] {
  return [{ ...past, id: "cur", current: true, ...overrides } as ElectionMeta, past];
}

const at = (iso: string): Date => new Date(iso);

describe("assessStaleness", () => {
  it("pending placeholder is always silent", () => {
    const els = [
      {
        ...past,
        id: "next",
        current: true,
        timetable: undefined,
        provisionalStage: "pending",
        dataVersion: "2026-06-23",
      } as ElectionMeta,
      past,
    ];
    expect(assessStaleness(els, at("2026-08-01T00:00:00+10:00")).level).toBe("none");
  });

  it("fails closed to silence when the clock is behind the newest data", () => {
    const v = assessStaleness(
      current({ dataVersion: "2028-01-01" }),
      at("2020-01-01T00:00:00+10:00"),
    );
    expect(v).toMatchObject({ level: "none", reason: "clock-behind-data" });
  });

  it("is PROMINENT during the campaign when the bundle predates the declared candidates", () => {
    // now between declaration and polls; dataVersion before declaration.
    const els = current({
      dataVersion: "2028-01-15",
      timetable: {
        issueOfWrit: "2028-03-01",
        closeOfRolls: "2028-03-08",
        closeOfNominations: "2028-04-10",
        declarationOfNominations: "2028-04-28T12:00:00+10:00",
        pollsCloseAt: "2028-05-20T20:00:00+10:00",
        returnOfWrits: "2028-06-30T23:59:59+10:00",
        source: "https://aec.gov.au/2028",
      },
    });
    const v = assessStaleness(els, at("2028-05-01T09:00:00+10:00"));
    expect(v).toMatchObject({ level: "prominent", reason: "predates-declaration" });
  });

  it("stays SILENT for a bundle built the same day the candidates were declared", () => {
    // The declaration lands at noon +10:00 and the rebuild that FIRST carries the declared
    // candidates is stamped that same date. Comparing a date-only dataVersion (AEST midnight)
    // against the raw stamp would read this freshest-possible build as predating the declaration;
    // whole-day comparison keeps it silent.
    const els = current({
      dataVersion: "2028-04-28",
      timetable: {
        issueOfWrit: "2028-03-01",
        closeOfRolls: "2028-03-08",
        closeOfNominations: "2028-04-10",
        declarationOfNominations: "2028-04-28T12:00:00+10:00",
        pollsCloseAt: "2028-05-20T20:00:00+10:00",
        returnOfWrits: "2028-06-30T23:59:59+10:00",
        source: "https://aec.gov.au/2028",
      },
    });
    expect(assessStaleness(els, at("2028-04-28T15:00:00+10:00"))).toMatchObject({
      level: "none",
      reason: "declared-list-final",
    });
    // …and still silent three weeks later, in poll week, when traffic peaks.
    expect(assessStaleness(els, at("2028-05-19T09:00:00+10:00")).level).toBe("none");
  });

  it("does not apply the 14-day churn nag above the declaration", () => {
    // The declared list cannot change again before the poll, so age alone is not a reason to nag:
    // there is no newer version to fetch and the store link would be a dead remedy.
    const els = current({
      dataVersion: "2028-04-29",
      timetable: {
        issueOfWrit: "2028-03-01",
        closeOfRolls: "2028-03-08",
        closeOfNominations: "2028-04-10",
        declarationOfNominations: "2028-04-28T12:00:00+10:00",
        pollsCloseAt: "2028-05-20T20:00:00+10:00",
        returnOfWrits: "2028-06-30T23:59:59+10:00",
        source: "https://aec.gov.au/2028",
      },
    });
    // 15 days past the build, six days before the poll — comfortably over CHURN_STALE_DAYS.
    expect(assessStaleness(els, at("2028-05-14T09:00:00+10:00"))).toMatchObject({
      level: "none",
      reason: "declared-list-final",
    });
  });

  it("is a low-urgency notice once polls have closed", () => {
    const els = current({
      dataVersion: "2028-04-29",
      timetable: {
        issueOfWrit: "2028-03-01",
        closeOfRolls: "2028-03-08",
        closeOfNominations: "2028-04-10",
        declarationOfNominations: "2028-04-28T12:00:00+10:00",
        pollsCloseAt: "2028-05-20T20:00:00+10:00",
        returnOfWrits: "2028-06-30T23:59:59+10:00",
        source: "https://aec.gov.au/2028",
      },
    });
    expect(assessStaleness(els, at("2028-06-01T00:00:00+10:00")).reason).toBe("past-polls");
  });

  it("only nags pre-close when the bundle is genuinely old (>14d)", () => {
    const mk = (dv: string) =>
      current({
        dataVersion: dv,
        timetable: {
          issueOfWrit: "2028-03-01",
          closeOfRolls: "2028-03-08",
          closeOfNominations: "2028-04-10",
          declarationOfNominations: "2028-04-28T12:00:00+10:00",
          pollsCloseAt: "2028-05-20T20:00:00+10:00",
          returnOfWrits: "2028-06-30T23:59:59+10:00",
          source: "https://aec.gov.au/2028",
        },
      });
    const now = at("2028-04-05T00:00:00+10:00");
    expect(assessStaleness(mk("2028-04-04"), now).level).toBe("none"); // 1 day old
    expect(assessStaleness(mk("2028-03-01"), now).level).toBe("notice"); // >14 days old
  });

  it("carries the current dataVersion as the dismissal key", () => {
    expect(
      assessStaleness(current({ dataVersion: "2028-02-02" }), at("2028-02-03T00:00:00+10:00"))
        .dataVersion,
    ).toBe("2028-02-02");
  });

  it("is channel-independent — the module takes no channel input, so the verdict is identical", () => {
    // The predicate has no PUBLIC_DIST_CHANNEL / isNativeShell input; same args → same verdict,
    // which is the whole point (only the remedy differs, in the component).
    const els = current({ dataVersion: "2028-01-01" });
    const now = at("2028-05-01T09:00:00+10:00");
    expect(assessStaleness(els, now)).toEqual(assessStaleness(els, now));
  });
});
