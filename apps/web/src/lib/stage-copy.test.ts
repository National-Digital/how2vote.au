import { readFileSync } from "node:fs";
import { ELECTIONS, type ElectionMeta, type ElectionPhase } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import { buildElectorateHub } from "./content.server";
import { compareLead, decideFaqs } from "./content/how-to-decide";
import { plansOpen, stageFor, stageOfPhase, type Ballot, type Stage } from "./election-stage";
import { cardHint, cardPlanNote, electorateHubCopy, landingCopy } from "./stage-copy";

const called = ELECTIONS.find((e) => e.id === "2025")!;
const { timetable, ...unannounced } = called;
void timetable;
const before = new Date("2025-04-01T00:00:00+10:00");
const during = new Date("2025-04-30T00:00:00+10:00");
const after = new Date("2025-05-20T00:00:00+10:00");
const phaseAt = (now: Date): ElectionPhase =>
  now === before ? "upcoming" : now === during ? "live" : "archived";

/** Synthetic elections, each with the stage the shared rule should give it. */
const CASES: {
  name: string;
  meta: ElectionMeta;
  now: Date;
  ballot: Ballot;
  stage: Stage;
}[] = [
  {
    name: "no timetable",
    meta: unannounced,
    now: before,
    ballot: "none",
    stage: "unannounced",
  },
  {
    name: "no timetable, a provisional list loaded",
    meta: unannounced,
    now: before,
    ballot: "drawn",
    stage: "listed",
  },
  { name: "called", meta: called, now: before, ballot: "none", stage: "called" },
  {
    name: "called, electorates loaded early",
    meta: called,
    now: before,
    ballot: "drawn",
    stage: "listed",
  },
  {
    name: "declared, not yet loaded",
    meta: called,
    now: during,
    ballot: "none",
    stage: "declared",
  },
  {
    name: "declared, a provisional list still loaded",
    meta: called,
    now: during,
    ballot: "provisional",
    stage: "listed",
  },
  { name: "live with a ballot", meta: called, now: during, ballot: "drawn", stage: "ballot" },
  { name: "held", meta: called, now: after, ballot: "drawn", stage: "held" },
  { name: "held, no electorates", meta: called, now: after, ballot: "none", stage: "held" },
];

const byName = (name: string) => CASES.find((c) => c.name === name)!;

/** Each surface's visible words for a synthetic election. */
function surfaces({ meta, now, ballot }: (typeof CASES)[number]) {
  const electorateLess = ballot === "none";
  const phase = meta.timetable ? phaseAt(now) : "upcoming";
  const landing = landingCopy({ meta, phase, ballot, count: 40 });
  // The card reads its stage as `CardFlow.electionStage` does.
  const cardStage = stageOfPhase(meta, phase, ballot);
  const hub = electorateHubCopy(stageFor(meta, ballot, now), {
    count: electorateLess ? 0 : 150,
    label: "Test Federal Election",
    year: 2025,
  });
  const decide = stageFor(meta, ballot, now);
  return {
    landingStage: landing.stage,
    cardStage,
    lede: landing.lede.note ? `${landing.lede.lead} ${landing.lede.note}` : landing.lede.lead,
    steps: landing.steps.map((s) => `${s.n} ${s.d}`).join(" | "),
    hint: cardHint(cardStage, electorateLess)
      .map((r) => r.text)
      .join(""),
    hub,
    plan: cardPlanNote(cardStage, ballot),
    decide: [
      ...decideFaqs({
        label: "Test Federal Election",
        propositions: 40,
        stage: decide,
        electorateLess,
      }).map((f) => f.answer),
      compareLead(decide, electorateLess),
    ].join(" "),
  };
}

describe("every surface, for every synthetic election", () => {
  for (const c of CASES) {
    const s = surfaces(c);
    const texts = [s.lede, s.hint, s.hub.intro, s.hub.description, s.decide];

    it(`${c.name}: the landing and the card read the shared stage`, () => {
      expect(s.landingStage).toBe(c.stage);
      expect(s.cardStage).toBe(c.stage);
    });

    it(`${c.name}: says not announced exactly when the stage is unannounced`, () => {
      for (const text of texts) {
        expect(text.includes("announced")).toBe(c.stage === "unannounced");
      }
    });

    it(`${c.name}: says candidates aren't final when called, never once declared`, () => {
      for (const text of [s.lede, s.hint, s.hub.intro, s.hub.description]) {
        if (c.stage === "called") expect(text).toContain("aren't final");
        if (c.stage !== "called" && c.stage !== "listed")
          expect(text).not.toContain("aren't final");
      }
    });

    it(`${c.name}: says How2Vote hasn't listed declared candidates only when declared`, () => {
      for (const text of [s.lede, s.hint, s.hub.intro]) {
        expect(text.includes("How2Vote hasn't listed")).toBe(c.stage === "declared");
      }
    });

    it(`${c.name}: calls the comparison provisional exactly until the ballot is declared`, () => {
      const provisional = !["ballot", "held"].includes(c.stage);
      expect(s.lede.includes("provisional comparison")).toBe(provisional);
      expect(
        /provisional comparison|aren't final|doesn't have the AEC's declared/.test(s.hint),
      ).toBe(provisional);
    });

    it(`${c.name}: promises official ballot order or a plan only when the builder opens`, () => {
      const promise =
        /official ballot order|you build your own order|build your own voting plan|A plan built for it/;
      for (const text of texts) {
        if (!plansOpen(c.stage, c.ballot)) expect(text).not.toMatch(promise);
      }
      if (plansOpen(c.stage, c.ballot)) expect(s.hint).toMatch(promise);
    });

    it(`${c.name}: has a stage plan note only when held without a drawn ballot`, () => {
      expect(s.plan !== null).toBe(c.stage === "held" && c.ballot !== "drawn");
    });

    it(`${c.name}: offers a ballot step and a ballot hint exactly when there are electorates`, () => {
      expect(s.steps.includes("Ballot")).toBe(c.ballot !== "none");
      expect(s.hint.includes("For each chamber")).toBe(c.ballot !== "none");
    });

    it(`${c.name}: the electorate list promises candidates on declaration only before it`, () => {
      expect(s.hub.awaitsNominations).toBe(c.stage === "unannounced" || c.stage === "called");
      expect(s.hub.description).not.toMatch(/all 0 /);
      expect(s.hub.description.startsWith("The candidates listed so far in all 150")).toBe(
        c.stage === "listed",
      );
    });
  }
});

describe("the wording published today", () => {
  const unannouncedCase = byName("no timetable");
  const heldCase = byName("held");

  it("is kept for an unannounced election without electorates", () => {
    const s = surfaces(unannouncedCase);
    expect(s.lede).toBe(
      "Answer 40 real questions the current Parliament has voted on and see how your views compare with the parties' recorded votes. The next federal election hasn't been announced yet, so this is a provisional comparison against the current Parliament — the questions may change, and there are no candidates or printable how-to-vote plan yet.",
    );
    expect(s.steps).toBe("1 · Answer 40 questions, ~5 min | 2 · Compare See how you compare");
    expect(
      s.hint.startsWith(
        "This shows how often the parties' recorded votes in the current Parliament align with your answers — as evidence only. The next election hasn't been announced, so there are no candidates or ballot yet; this is a provisional comparison against the parties,",
      ),
    ).toBe(true);
    expect(s.hub.intro).toBe(
      "The next federal election hasn't been announced yet, so no electorates or candidates have been drawn.",
    );
  });

  it("is kept for a held election with electorates", () => {
    const s = surfaces(heldCase);
    expect(s.lede).toBe(
      "Answer 40 real questions parliament has voted on and see how your views compare with the parties' recorded votes, for your 2025 ballot — House and Senate. This election has already been held — what follows is a historical comparison, scored on the record as it stood then.",
    );
    expect(s.steps).toBe(
      "1 · Ballot Find your electorate | 2 · Answer 40 questions, ~5 min | 3 · Compare Review the record",
    );
    expect(s.hint).toBe(
      "For each chamber, this shows how often the parties' recorded votes align with your answers — as evidence only. Nothing here is ranked or recommended: How2Vote does not tell you who to put first. When you're ready, you build your own order.",
    );
    expect(s.hub.intro).toBe(
      "Choose your federal electorate to see every candidate on the House ballot, or open your state's Senate ballot. 2025 election.",
    );
    expect(s.hub.description).toBe(
      "Every candidate standing in all 150 federal House electorates at the Test Federal Election, by state, plus each state's Senate ballot.",
    );
  });

  it("closes every ballot-less hint on the same disclaimer", () => {
    const ending = (h: string) => h.slice(h.lastIndexOf(","));
    const hints = CASES.filter((c) => c.ballot === "none").map((c) => surfaces(c).hint);
    expect(hints.length).toBeGreaterThan(3);
    expect(new Set(hints.map(ending)).size).toBe(1);
  });
});

describe("the electorate hub as built", () => {
  it("words the next election's page and description without a count", () => {
    const hub = buildElectorateHub("next")!;
    expect(hub.states).toHaveLength(0);
    expect(hub.intro).toContain("hasn't been announced");
    expect(hub.awaitsNominations).toBe(true);
    expect(hub.seo.description).not.toMatch(/all 0 /);
    expect(hub.seo.description).toContain("Next Federal Election");
  });

  it("keeps a held election's page and description", () => {
    const hub = buildElectorateHub("2025")!;
    expect(hub.intro).toContain("Choose your federal electorate");
    expect(hub.awaitsNominations).toBe(false);
    expect(hub.seo.description).toMatch(/^Every candidate standing in all \d+ federal House/);
  });
});

describe("the card", () => {
  // `CardFlow` is a rune class the unit runner cannot compile; its stage is read by the same call
  // `surfaces` makes above.
  const flow = readFileSync(new URL("./card-flow.svelte.ts", import.meta.url), "utf8");
  /** A `$derived` field's expression, whitespace collapsed. */
  const derived = (field: string) =>
    new RegExp(`\\n  ${field} = \\$derived\\(([\\s\\S]*?)\\);\\n`)
      .exec(flow)?.[1]
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/,$/, "");

  it("reads its stage from the phase and the dataset's ballot", () => {
    expect(derived("ballot")).toBe('this.dataset ? ballotOf(this.dataset.ballots) : "none"');
    expect(derived("electionStage")).toBe("stageOfPhase(election.meta, this.phase, this.ballot)");
    expect(derived("panelsBallotOrdered")).toBe(
      'this.ballot === "drawn" && this.electionStage !== "listed"',
    );
  });

  it("opens plans exactly when printing is allowed and plansOpen says so", () => {
    expect(derived("plansEnabled")).toBe(
      "this.data && this.activeElectionId ? isPrintingAllowed(this.activeElectionId, slugify(this.data.card.electorate)) && plansOpen(this.electionStage, this.ballot) : false",
    );
  });

  it("shows a held election without a drawn ballot no archive banner and no plan", () => {
    const page = readFileSync(new URL("../routes/card/+page.svelte", import.meta.url), "utf8");
    expect(page).toContain('{#if flow.isArchived && flow.ballot === "drawn"}');
    expect(page).toContain(
      "cardPlanNote(flow.electionStage, flow.ballot) ?? CARD_COPY.plansClosed",
    );
    expect(page.match(/ballotOrdered=\{flow\.panelsBallotOrdered\}/g)).toHaveLength(2);
    expect(surfaces(byName("held, no electorates")).plan).toBe(
      "How2Vote holds no declared ballot for this election, so there is no plan to build.",
    );
  });

  it("words the declared landing and the held-without-electorates steps", () => {
    expect(surfaces(byName("declared, not yet loaded")).lede).toContain(
      "the questions may change until it does",
    );
    expect(surfaces(byName("held, no electorates")).steps).toBe(
      "1 · Answer 40 questions, ~5 min | 2 · Compare Review the record",
    );
  });

  it("shows a listed election's candidates with no plan to build", () => {
    const s = surfaces(byName("called, electorates loaded early"));
    expect(s.hint).toBe(
      "For each chamber, this shows how often the parties' recorded votes align with your answers — as evidence only. Nothing here is ranked or recommended: How2Vote does not tell you who to put first. How2Vote doesn't have the AEC's declared candidates and ballot order yet, so there is no voting plan to build yet.",
    );
    expect(s.lede).toContain(
      "How2Vote doesn't have the AEC's declared candidates and ballot order yet, so this is a provisional comparison — the questions may change, and there is no printable how-to-vote plan yet.",
    );
    expect(s.steps).toContain("1 · Ballot Find your electorate");
  });
});
