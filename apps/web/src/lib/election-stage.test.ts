import { ELECTIONS, type ElectionMeta } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import {
  STAGES,
  assertNoListedElection,
  ballotOf,
  parliamentHintStage,
  plansOpen,
  stageAt,
  stageFor,
  stageOfPhase,
  type Ballot,
} from "./election-stage";

const called = ELECTIONS.find((e) => e.id === "2025")!;
const { timetable, ...unannounced } = called;
void timetable;
const before = new Date("2025-04-01T00:00:00+10:00");
const during = new Date("2025-04-30T00:00:00+10:00");
const after = new Date("2025-05-20T00:00:00+10:00");
const BALLOTS: Ballot[] = ["none", "provisional", "drawn"];

describe("ballotOf", () => {
  it("reads none, a provisional list or the drawn ballot; an omitted status is drawn", () => {
    expect(ballotOf({ electorates: [] })).toBe("none");
    expect(ballotOf({ electorates: [], ballotStatus: "pending" })).toBe("none");
    expect(ballotOf({ electorates: [{}], ballotStatus: "provisional" })).toBe("provisional");
    expect(ballotOf({ electorates: [{}], ballotStatus: "drawn" })).toBe("drawn");
    expect(ballotOf({ electorates: [{}] })).toBe("drawn");
  });
});

describe("stageFor", () => {
  it("is unannounced with no timetable and no electorates", () => {
    expect(stageFor(unannounced, "none", during)).toBe("unannounced");
  });

  it("is called once the timetable exists, before nominations are declared", () => {
    expect(stageFor(called, "none", before)).toBe("called");
  });

  it("is declared from the declaration of nominations while no electorates are loaded", () => {
    expect(stageFor(called, "none", during)).toBe("declared");
  });

  it("is listed while candidates are loaded before nominations are declared", () => {
    expect(stageFor(called, "drawn", before)).toBe("listed");
    expect(stageFor(called, "provisional", before)).toBe("listed");
    expect(stageFor(unannounced, "drawn", during)).toBe("listed");
  });

  it("keeps a provisional list listed after the declaration", () => {
    expect(stageFor(called, "provisional", during)).toBe("listed");
  });

  it("has a ballot only for a drawn ballot once nominations are declared", () => {
    expect(stageFor(called, "drawn", during)).toBe("ballot");
  });

  it("is held once the polls have closed, whatever the ballot", () => {
    for (const ballot of BALLOTS) expect(stageFor(called, ballot, after)).toBe("held");
  });

  it("names every stage", () => {
    expect(new Set(STAGES)).toEqual(
      new Set(["unannounced", "called", "listed", "declared", "ballot", "held"]),
    );
  });
});

describe("plansOpen", () => {
  it("opens the plan builder only for a declared drawn ballot or a held drawn ballot", () => {
    const open = STAGES.flatMap((stage) =>
      BALLOTS.filter((ballot) => plansOpen(stage, ballot)).map((ballot) => `${stage}/${ballot}`),
    );
    expect(open).toEqual(["ballot/none", "ballot/provisional", "ballot/drawn", "held/drawn"]);
    for (const [meta, now] of [
      [called, before],
      [called, during],
      [called, after],
      [unannounced, during],
    ] as const) {
      for (const ballot of BALLOTS) {
        const stage = stageFor(meta, ballot, now);
        expect(plansOpen(stage, ballot)).toBe(
          ballot === "drawn" && (stage === "ballot" || stage === "held"),
        );
      }
    }
  });
});

describe("stageAt and stageOfPhase", () => {
  it("read a phase given out of time, as the iOS states pages and the card render it", () => {
    expect(stageAt("upcoming", false, "none")).toBe("unannounced");
    expect(stageAt("upcoming", true, "none")).toBe("called");
    expect(stageAt("upcoming", false, "drawn")).toBe("listed");
    expect(stageAt("upcoming", true, "provisional")).toBe("listed");
    expect(stageAt("live", true, "drawn")).toBe("ballot");
    expect(stageAt("live", true, "provisional")).toBe("listed");
    expect(stageAt("live", true, "none")).toBe("declared");
    expect(stageAt("live", false, "none")).toBe("declared");
    expect(stageAt("archived", false, "none")).toBe("held");
    expect(stageAt("archived", true, "drawn")).toBe("held");
    expect(stageOfPhase(called, "upcoming", "none")).toBe("called");
    expect(stageOfPhase(unannounced, "upcoming", "none")).toBe("unannounced");
  });
});

const entry = (id: string, meta: ElectionMeta, ballot: Ballot) => ({ id, meta, ballot });

describe("parliamentHintStage", () => {
  it("is the stage every election without electorates shares", () => {
    expect(
      parliamentHintStage(
        [entry("next", unannounced, "none"), entry("2025", called, "drawn")],
        during,
      ),
    ).toBe("unannounced");
    expect(parliamentHintStage([entry("next", called, "none")], before)).toBe("called");
    expect(parliamentHintStage([entry("next", called, "none")], during)).toBe("declared");
  });

  it("is unannounced when every election has electorates", () => {
    expect(parliamentHintStage([entry("2025", called, "drawn")], during)).toBe("unannounced");
  });

  it("fails the build, naming each election, when they disagree", () => {
    expect(() =>
      parliamentHintStage(
        [entry("next", unannounced, "none"), entry("2031", called, "none")],
        before,
      ),
    ).toThrow(/next is unannounced, 2031 is called.*CardWording/);
  });
});

describe("assertNoListedElection", () => {
  it("passes the elections built today", () => {
    expect(() =>
      assertNoListedElection([entry("next", unannounced, "none"), entry("2025", called, "drawn")]),
    ).not.toThrow();
  });

  it("fails the build when an election would be listed, which the app would draw as a ballot", () => {
    expect(() => assertNoListedElection([entry("next", called, "drawn")], before)).toThrow(
      /next would be listed.*card-hint-ballot/,
    );
    expect(() => assertNoListedElection([entry("next", called, "provisional")], during)).toThrow(
      /next would be listed/,
    );
  });
});
