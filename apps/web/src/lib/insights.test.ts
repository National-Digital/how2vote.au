import { readFileSync, writeFileSync } from "node:fs";
import { ELECTIONS, isPollingDayNoticeWindow, type ElectionMeta } from "@how2vote/data-schema";
import { describe, expect, it, vi } from "vitest";
import {
  closedWindows,
  geoFor,
  insightsClosed,
  insightsModel,
  listedElections,
  pct,
  propParts,
  readInsights,
  readStats,
  type PartyView,
  type PropositionView,
  type StatsFile,
  type StatsIndex,
} from "./insights";

/** A registry of two elections: a past one with a polling day, and an upcoming one with none. */
const ELECTIONS_FIXTURE: ElectionMeta[] = [
  {
    id: "next",
    year: 2028,
    label: "Next Federal Election",
    shortLabel: "Next",
    current: true,
    provisionalStage: "pending",
    dataVersion: "2026-06-23",
  },
  {
    id: "2025",
    year: 2025,
    label: "2025 Federal Election",
    shortLabel: "2025",
    date: "2025-05-03",
    current: false,
    timetable: {
      issueOfWrit: "2025-03-31",
      closeOfRolls: "2025-04-07",
      closeOfNominations: "2025-04-10",
      declarationOfNominations: "2025-04-11T12:00:00+10:00",
      pollsCloseAt: "2025-05-03T20:00:00+10:00",
      returnOfWrits: "2025-06-12T23:59:59+10:00",
      source: "https://www.aec.gov.au/elections/federal_elections/2025/timetable.htm",
    },
    dataVersion: "2025-03-28",
  },
] as ElectionMeta[];

const geo = (code: string | null, counts: [string, number][]) => ({
  scope: code === null ? ("national" as const) : ("state" as const),
  code,
  label: code ?? "Australia-wide",
  buckets: [
    {
      key: "18-34",
      label: "18–34",
      shown: counts.reduce((sum, [, n]) => sum + n, 0),
      cells: counts.map(([key, n]) => ({ key, label: key.toUpperCase(), count: n })),
    },
  ],
});

const PUBLISHED: StatsFile = {
  schemaVersion: 3,
  // Midday UTC, so the date the page writes is the same in every timezone a test runs in.
  generatedAt: "2026-07-15T12:00:00.000Z",
  electionId: "2025",
  electionLabel: "2025 Federal Election",
  minCell: 12,
  totalResponses: 1234,
  published: true,
  views: [],
  cohorts: [
    {
      key: "campaign",
      label: "During the campaign",
      disclosure: "Collected between the declaration of nominations and polling day.",
      totalResponses: 1234,
      published: true,
      views: [
        {
          kind: "party",
          id: "age",
          title: "Top party match by age",
          dimension: "age",
          sensitive: false,
          geos: [
            geo(null, [
              ["alp", 2],
              ["lnp", 1],
            ]),
            geo("NSW", [["alp", 3]]),
          ],
        },
        {
          kind: "proposition",
          id: "p1",
          title: "Raise the pension",
          propositionId: 1,
          geos: [
            geo(null, [
              ["agree", 5],
              ["neutral", 1],
              ["disagree", 2],
            ]),
          ],
        },
      ],
    },
    {
      key: "historical",
      label: "Since the election",
      disclosure: "",
      totalResponses: 0,
      published: false,
      views: [],
    },
  ],
};

const INDEX: StatsIndex = {
  schemaVersion: 2,
  generatedAt: "2026-07-15T22:50:59.389Z",
  elections: [
    { id: "2025", label: "2025 Federal Election", published: true, totalResponses: 1234 },
  ],
};

const OPEN = new Date("2026-09-25T12:00:00+10:00");

const model = () =>
  insightsModel({
    now: OPEN,
    index: INDEX,
    files: { next: null, "2025": PUBLISHED },
    elections: ELECTIONS_FIXTURE,
    provenance: (id) => (id === "2025" ? "Positions as recorded at the 2025 election." : null),
  });

describe("the page's figures", () => {
  it("rounds a share as the page does, and a share of nothing as none", () => {
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
    expect(pct(1, 8)).toBe(13);
    expect(pct(3, 0)).toBe(0);
  });

  it("shows the selected geography, else the first", () => {
    const view = PUBLISHED.cohorts[0]!.views[0] as PartyView;
    expect(geoFor(view, "NSW").code).toBe("NSW");
    expect(geoFor(view, null).code).toBeNull();
    expect(geoFor(view, "WA").code).toBeNull();
  });

  it("reads a proposition's split from its overall bucket", () => {
    expect(propParts(PUBLISHED.cohorts[0]!.views[1] as PropositionView)).toEqual({
      agree: 5,
      neutral: 1,
      disagree: 2,
      shown: 8,
    });
  });

  it("reads an older file without cohorts as one", () => {
    const old = readStats({ ...PUBLISHED, cohorts: undefined });
    expect(old?.cohorts.map((c) => c.key)).toEqual(["all"]);
    expect(readStats({ ...PUBLISHED, schemaVersion: 2 })).toBeNull();
  });

  it("offers every registry election, the index's figures where it has them", () => {
    expect(listedElections(INDEX, ELECTIONS_FIXTURE).map((e) => [e.id, e.published])).toEqual([
      ["next", false],
      ["2025", true],
    ]);
  });
});

describe("the election-day close", () => {
  it("closes exactly in each window it hands the app", () => {
    const windows = closedWindows();
    for (const m of ELECTIONS.filter((e) => e.timetable)) {
      const start = Date.parse(`${m.date}T00:00:00+10:00`);
      const end = Date.parse(m.timetable!.pollsCloseAt);
      for (const t of [start - 1, start, end - 1, end]) {
        const at = new Date(t);
        const inWindow = windows.some(([from, to]) => t >= from && t < to);
        expect(inWindow).toBe(isPollingDayNoticeWindow(m, at));
        expect(insightsClosed(at)).toBe(ELECTIONS.some((e) => isPollingDayNoticeWindow(e, at)));
      }
    }
  });

  it("reads no figures while closed", () => {
    const closed = insightsModel({
      now: new Date("2025-05-03T09:00:00+10:00"),
      index: INDEX,
      files: { "2025": PUBLISHED },
      elections: ELECTIONS_FIXTURE,
    });
    expect(closed).toMatchObject({ closed: true, elections: null });
  });
});

describe("readInsights", () => {
  const polling = ELECTIONS.find((e) => e.timetable && e.date)!;
  const inWindow = new Date(`${polling.date}T09:00:00+10:00`);
  const before = new Date(`${polling.date}T00:00:00+10:00`).getTime() - 1000;

  it("reads no file while the page is closed", async () => {
    const read = vi.fn(async () => null);
    expect(await readInsights(read, () => inWindow)).toMatchObject({ closed: true });
    expect(read).not.toHaveBeenCalled();
  });

  it("hands over no figure read as a close begins", async () => {
    let now = before;
    const read = vi.fn(async (name: string) => {
      now = inWindow.getTime();
      return name === "index" ? INDEX : null;
    });
    const model = await readInsights(read, () => new Date(now));
    expect(read).toHaveBeenCalled();
    expect(model).toMatchObject({ closed: true, elections: null });
  });

  it("reads the index and every listed election's file while open", async () => {
    const read = vi.fn(async (name: string) => (name === "index" ? INDEX : null));
    const model = await readInsights(read, () => OPEN);
    expect(model.closed).toBe(false);
    expect(read.mock.calls.map(([name]) => name)).toEqual(["index", ...ELECTIONS.map((e) => e.id)]);
  });
});

describe("insightsModel", () => {
  it("derives every figure the page shows for each election", () => {
    const m = model();
    expect(m.initial).toBe("2025");
    const [next, past] = m.elections!;
    expect(next).toMatchObject({ id: "next", pill: "Next", upcoming: true, stats: null });
    expect(past!.stats!.cohorts[0]!.parties[0]!.geos[0]!.buckets[0]!.cells).toEqual([
      { label: "ALP", pct: 67 },
      { label: "LNP", pct: 33 },
    ]);
    expect(past!.stats!.cohorts[0]!.propositions[0]).toMatchObject({
      agree: 63,
      neutral: 13,
      disagree: 25,
      shown: 8,
    });
    expect(past!.stats!.cohorts[0]!.total).toBe("1,234");
  });

  it("reports a failure when the index cannot be read", () => {
    expect(
      insightsModel({ now: OPEN, index: null, files: {}, elections: ELECTIONS_FIXTURE }),
    ).toMatchObject({ failed: true, elections: null });
  });

  // The app decodes exactly this, in DocumentLogic: the shape the web hands over is the shape the
  // app reads. Regenerate with UPDATE_INSIGHTS_FIXTURE=1.
  it("matches the fixture the app's decoder is held to", () => {
    const path = new URL("../../../mobile/ios/Parity/insights-model.json", import.meta.url);
    const json = JSON.stringify(model(), null, 2) + "\n";
    if (process.env["UPDATE_INSIGHTS_FIXTURE"]) writeFileSync(path, json);
    expect(readFileSync(path, "utf8")).toBe(json);
  });
});
