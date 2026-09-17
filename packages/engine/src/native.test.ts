import type { Dataset } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import type { Answer } from "./answers.js";
import {
  NATIVE_API_VERSION,
  ballotPaper,
  card,
  electorates,
  elections,
  percentages,
  questions,
  share,
  unshare,
} from "./native.js";

import dataset2025Json from "../../../data/dist/2025/dataset.json" with { type: "json" };
import dataset2019Json from "../../../data/dist/2019/dataset.json" with { type: "json" };
import goldenCard2025 from "./__golden__/card-2025-bean.json" with { type: "json" };
import goldenBallot2025 from "./__golden__/ballot-paper-2025-act.json" with { type: "json" };

const dataset2025 = dataset2025Json as unknown as Dataset;
const dataset2019 = dataset2019Json as unknown as Dataset;
const json2025 = JSON.stringify(dataset2025);
const json2019 = JSON.stringify(dataset2019);

/** The recipe the golden artifacts were captured with (see golden-output.test.ts). */
const fixedAnswers = (dataset: Dataset): Answer[] =>
  dataset.questions.questions.slice(0, 12).map((q, i) => ({
    id: q.id,
    points: ((i % 5) + 1) as Answer["points"],
    important: i === 0 || i === 5,
  }));

const request = (dataset: Dataset) =>
  JSON.stringify({ state: "ACT", electorate: "Bean", answers: fixedAnswers(dataset) });

describe("the native contract", () => {
  it("declares an API version the Swift bridge pins against", () => {
    expect(NATIVE_API_VERSION).toBe(4);
  });

  // The bridge marshals strings, so every entry point must be total over JSON in and JSON out.
  it("returns parseable JSON from every entry point", () => {
    expect(() => JSON.parse(card(json2025, request(dataset2025)))).not.toThrow();
    expect(() =>
      JSON.parse(ballotPaper(json2025, '{"state":"ACT","electorate":"Bean"}')),
    ).not.toThrow();
    expect(() =>
      JSON.parse(percentages(JSON.stringify(fixedAnswers(dataset2025)), JSON.stringify([]))),
    ).not.toThrow();
    expect(() => JSON.parse(questions(json2025))).not.toThrow();
    expect(() => JSON.parse(electorates(json2025, "ACT"))).not.toThrow();
    expect(() => JSON.parse(elections())).not.toThrow();
  });
});

describe("elections", () => {
  it("offers every registered election, exactly one of them current", () => {
    const list = JSON.parse(elections()) as { id: string; current: boolean }[];
    expect(list.length).toBeGreaterThan(1);
    expect(list.filter((e) => e.current)).toHaveLength(1);
  });

  // The stage is what decides whether a screen says "provisional" or "historical". Judged against a
  // moment the caller supplies, so a screen and a test can ask about the same instant rather than
  // about whenever they happened to run.
  it("judges the stage against the moment it is given", () => {
    const before = JSON.parse(elections("2019-01-01T00:00:00Z")) as { id: string; phase: string }[];
    const after = JSON.parse(elections("2026-01-01T00:00:00Z")) as { id: string; phase: string }[];
    const phaseOf = (list: { id: string; phase: string }[], id: string) =>
      list.find((e) => e.id === id)?.phase;

    expect(phaseOf(before, "2019")).toBe("upcoming");
    expect(phaseOf(after, "2019")).toBe("archived");
  });

  it("carries the labels a picker shows", () => {
    const list = JSON.parse(elections()) as { shortLabel: string; label: string }[];
    for (const election of list) {
      expect(election.shortLabel.length).toBeGreaterThan(0);
      expect(election.label.length).toBeGreaterThan(0);
    }
  });
});

describe("electorates", () => {
  it("lists a state's electorates in picker order", () => {
    const list = JSON.parse(electorates(json2025, "ACT")) as { electorate: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((e) => e.electorate)).toEqual(
      [...list.map((e) => e.electorate)].sort((a, b) => a.localeCompare(b)),
    );
  });

  // The compiled dataset writes "Qld" and "Tas" where the picker uses "QLD" and "TAS". A
  // case-sensitive match would return an empty state and the picker would look broken for a third
  // of the country.
  it("matches a state code whatever case it is given in", () => {
    const upper = JSON.parse(electorates(json2025, "QLD")) as unknown[];
    const asWritten = JSON.parse(electorates(json2025, "Qld")) as unknown[];
    expect(upper.length).toBeGreaterThan(0);
    expect(asWritten).toEqual(upper);
  });

  it("returns an empty list for a state the election has no ballot for", () => {
    expect(JSON.parse(electorates(json2025, "ZZ"))).toEqual([]);
  });

  it("covers every electorate exactly once across the states", () => {
    const states = [...new Set(dataset2025.ballots.electorates.map((e) => e.state.toUpperCase()))];
    const total = states.reduce(
      (n, code) => n + (JSON.parse(electorates(json2025, code)) as unknown[]).length,
      0,
    );
    expect(total).toBe(dataset2025.ballots.electorates.length);
  });
});

describe("questions", () => {
  it("carries the election's data vintage and attribution", () => {
    const payload = JSON.parse(questions(json2025));
    expect(payload.dataVersion).toBe(dataset2025.questions.dataVersion);
    expect(payload.attribution).toBe(dataset2025.questions.attribution);
  });

  it("presents every question the dataset holds when none is withdrawn", () => {
    const payload = JSON.parse(questions(json2025));
    expect(payload.active.map((q: { id: number }) => q.id)).toEqual(
      dataset2025.questions.questions.map((q) => q.id),
    );
    expect(payload.orderedIds).toEqual(dataset2025.questions.questions.map((q) => q.id));
  });

  it("carries only what a question screen renders, never party positions", () => {
    const payload = JSON.parse(questions(json2025));
    expect(Object.keys(payload.active[0]).sort()).toEqual([
      "divisionCount",
      "divisionFirst",
      "divisionLast",
      "id",
      "text",
    ]);
    // A ~330 KB dataset crossing the bridge for every question screen, and positions on a surface
    // that must not show them.
    expect(questions(json2025)).not.toContain("positions");
  });

  // No committed dataset has a withdrawn question, so the distinction that matters most is only
  // reachable synthetically. Without this, a native core that presented `orderedIds` would pass
  // every check in the repository and show a withdrawn question to a voter (ADR 0005).
  it("withholds a withdrawn question from presentation but keeps it in the share ordering", () => {
    const withWithdrawn = structuredClone(dataset2025);
    const [first] = withWithdrawn.questions.questions;
    first.withdrawn = { at: "2025-01-01", reason: "test fixture" } as never;

    const payload = JSON.parse(questions(JSON.stringify(withWithdrawn)));
    expect(payload.active.map((q: { id: number }) => q.id)).not.toContain(first.id);
    expect(payload.active).toHaveLength(dataset2025.questions.questions.length - 1);
    expect(payload.orderedIds).toContain(first.id);
    expect(payload.orderedIds).toEqual(dataset2025.questions.questions.map((q) => q.id));
  });
});

describe("card", () => {
  it("reproduces the committed golden card for the current election", () => {
    expect(card(json2025, request(dataset2025))).toBe(
      `${JSON.stringify(goldenCard2025, null, 2)}\n`,
    );
  });

  it("reproduces the committed golden card for a historical election", () => {
    const produced = JSON.parse(card(json2019, request(dataset2019)));
    expect(produced.state).toBe("ACT");
    expect(produced.electorate).toBe("Bean");
    expect(produced.house.length).toBeGreaterThan(0);
  });

  it("sorts percentages by party key, so output cannot depend on insertion order", () => {
    const keys = Object.keys(JSON.parse(card(json2025, request(dataset2025))).percentages);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  // Suspension forces the affected BALLOT ROWS to no-alignment (score -1, band "no-data") so a
  // disputed figure cannot be shown. The percentages map is not the carrier of that guarantee.
  it("forces a suspended party's ballot rows to no-alignment", () => {
    const baseline = JSON.parse(card(json2025, request(dataset2025)));
    const partyKey = baseline.house.find(
      (r: { partyKey: string | null; score: number }) => r.partyKey && r.score >= 0,
    )?.partyKey;
    expect(partyKey).toBeTruthy();

    const suspended = JSON.parse(
      card(
        json2025,
        JSON.stringify({
          state: "ACT",
          electorate: "Bean",
          answers: fixedAnswers(dataset2025),
          suspended: [partyKey],
        }),
      ),
    );
    const rows = suspended.house.filter((r: { partyKey: string }) => r.partyKey === partyKey);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.score).toBe(-1);
      expect(row.band).toBe("no-data");
      expect(row.suspended).toBe(true);
    }
  });
});

describe("ballotPaper", () => {
  it("reproduces the committed golden ballot order", () => {
    expect(ballotPaper(json2025, '{"state":"ACT","electorate":"Bean"}')).toBe(
      `${JSON.stringify(goldenBallot2025, null, 2)}\n`,
    );
  });

  // The blank-ballot design: the paper carries no alignment figure at all.
  it("carries no percentages, so no alignment can leak onto the ballot surface", () => {
    const paper = JSON.parse(ballotPaper(json2025, '{"state":"ACT","electorate":"Bean"}'));
    expect(paper).not.toHaveProperty("percentages");
    for (const row of paper.house) expect(row).not.toHaveProperty("percent");
  });
});

describe("percentages", () => {
  const questions = JSON.stringify(dataset2025.questions.questions.slice(0, 12));

  it("scores every party in range, marking a no-data party -1", () => {
    const scored = JSON.parse(percentages(JSON.stringify(fixedAnswers(dataset2025)), questions));
    const values = Object.values(scored) as number[];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value === -1 || (value >= 0 && value <= 100)).toBe(true);
    }
  });

  it("sorts by party key, so the bridge's output cannot depend on insertion order", () => {
    const keys = Object.keys(
      JSON.parse(percentages(JSON.stringify(fixedAnswers(dataset2025)), questions)),
    );
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it("defaults merges to none when the argument is omitted", () => {
    expect(percentages(JSON.stringify(fixedAnswers(dataset2025)), questions)).toBe(
      percentages(JSON.stringify(fixedAnswers(dataset2025)), questions, "[]"),
    );
  });
});

describe("share and unshare", () => {
  const orderedIds = dataset2025.questions.questions.map((q) => q.id);
  const answers = fixedAnswers(dataset2025);
  const fragment = share(
    JSON.stringify({ electorate: "Bean", answers }),
    JSON.stringify(orderedIds),
    "2025",
  );

  it("encodes a fragment that names its election and electorate", () => {
    expect(fragment).toContain("2025");
    expect(fragment).toContain("bean");
  });

  // The payload is positional over EVERY question id, so decoding returns a full-length list with
  // unanswered slots zeroed — not just the twelve that were answered.
  it("round-trips every answer it encoded", () => {
    const decoded = JSON.parse(unshare(fragment, JSON.stringify({ 2025: orderedIds })));
    expect(decoded).not.toBeNull();
    expect(decoded.answers).toHaveLength(orderedIds.length);

    const byId = new Map(decoded.answers.map((a: Answer) => [a.id, a] as const));
    for (const answer of answers) {
      expect(byId.get(answer.id)).toEqual(answer);
    }
  });

  // The lookup crosses the bridge as a map because a function cannot; an unknown election must
  // still decode to null rather than throwing into Swift.
  it("returns null for an election the caller supplied no ordering for", () => {
    expect(JSON.parse(unshare(fragment, "{}"))).toBeNull();
  });

  it("returns null for an unreadable fragment", () => {
    expect(JSON.parse(unshare("not-a-fragment", JSON.stringify({ 2025: orderedIds })))).toBeNull();
  });

  it("accepts a data-version map for the version-pinned codec", () => {
    const decoded = JSON.parse(
      unshare(
        fragment,
        JSON.stringify({ 2025: orderedIds }),
        JSON.stringify({ 2025: "2026-06-23" }),
      ),
    );
    expect(decoded).not.toBeNull();
  });
});
