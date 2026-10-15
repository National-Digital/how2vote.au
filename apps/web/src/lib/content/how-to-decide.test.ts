import { describe, expect, it } from "vitest";
import { STAGES, type Stage } from "../election-stage";
import { faqGraph } from "../structured-data";
import { compareLead, decideFaqs } from "./how-to-decide";

/** Whether a stage has electorates, where the stage alone decides it. */
const LOADED: Record<Stage, boolean> = {
  unannounced: false,
  called: false,
  listed: true,
  declared: false,
  ballot: true,
  held: true,
};
const faqsFor = (stage: Stage, electorateLess = !LOADED[stage]) =>
  decideFaqs({ label: "Test Federal Election", propositions: 40, stage, electorateLess });
const text = (stage: Stage, electorateLess = !LOADED[stage]) =>
  [...faqsFor(stage, electorateLess).map((f) => f.answer), compareLead(stage, electorateLess)].join(
    " ",
  );

describe("decideFaqs and compareLead", () => {
  it("report the election and its proposition count at every stage", () => {
    for (const stage of STAGES) {
      expect(text(stage)).toContain(
        "For the Test Federal Election, How2Vote asks about 40 propositions:",
      );
    }
  });

  it("say not announced only when there is no timetable", () => {
    expect(text("unannounced")).toContain(
      "The next federal election hasn't been announced, so there are no candidates or ballot yet",
    );
    for (const stage of STAGES.filter((s) => s !== "unannounced")) {
      expect(text(stage)).not.toContain("announced");
    }
    expect(text("called")).toContain(
      "Candidates for this election aren't final yet, so there is no ballot yet",
    );
  });

  it("say How2Vote hasn't listed the candidates once they are declared", () => {
    expect(text("declared")).toContain(
      "The AEC has declared the candidates for this election, but How2Vote hasn't listed them yet, and the propositions may change until it does.",
    );
    expect(text("declared")).not.toContain("aren't final");
  });

  it("point a listed election to its candidates so far, with no plan until verified", () => {
    expect(text("listed")).toContain(
      "How2Vote doesn't have the AEC's declared candidates for this election yet: your answers are compared with the parties' recorded votes, as evidence only; the candidates listed so far are on each electorate's page. The voting plan opens once How2Vote has the AEC's declared ballot order and it is verified.",
    );
    // The card shows party panels only: nothing is said to sit beside candidates.
    expect(text("listed")).not.toMatch(/beside the candidates/);
    expect(compareLead("listed", false)).not.toContain("candidates");
    expect(text("listed")).toContain("the propositions may change");
  });

  it("promise no ballot or plan before there is a ballot", () => {
    for (const stage of ["unannounced", "called", "declared"] as const) {
      expect(text(stage)).not.toMatch(/ballot order|voting plan|blank ballot|your ballot/);
      expect(compareLead(stage, true)).toContain("in the current Parliament");
    }
  });

  it("describe official ballot order and an 18+ plan only while the ballot is live", () => {
    expect(text("ballot")).toContain(
      "If you are 18 or over, you can then build your own voting plan",
    );
    expect(compareLead("ballot", false)).toContain("beside the candidates on your ballot");
    for (const stage of ["unannounced", "called", "listed", "declared", "held"] as const) {
      expect(text(stage)).not.toContain("build your own voting plan");
    }
    for (const stage of ["unannounced", "called", "listed", "declared"] as const) {
      expect(text(stage)).not.toContain("official ballot order");
    }
  });

  it("call a held election's plan a historical demonstration", () => {
    expect(text("held")).toContain("This election has already been held");
    expect(text("held")).toContain("A plan built for it is a historical demonstration");
    expect(compareLead("held", false)).toContain("as a historical comparison");
  });

  it("give a held election without electorates no ballot or plan", () => {
    expect(text("held", true)).toContain(
      "This election has already been held and How2Vote holds no ballot for it: your answers are compared with the parties' recorded votes, as a historical comparison and evidence only.",
    );
    expect(text("held", true)).not.toMatch(/official ballot order|plan built|Choose an electorate/);
  });

  it("answer in plain text, which the JSON-LD carries unchanged", () => {
    for (const stage of STAGES) {
      const faqs = faqsFor(stage);
      expect(faqs.length).toBe(4);
      for (const { question, answer } of faqs) {
        expect(question).toMatch(/\?$/);
        expect(answer).not.toMatch(/[<>{}]/);
      }
      const graph = faqGraph(faqs);
      expect(graph.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
        faqs.map((f) => [f.question, f.answer]),
      );
    }
  });
});
