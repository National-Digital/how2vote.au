import { ELECTIONS } from "@how2vote/data-schema";
import { describe, expect, it } from "vitest";
import { faqGraph } from "../structured-data";
import { compareLead, decideFaqs, decideStage, type DecideStage } from "./how-to-decide";

const held = ELECTIONS.find((e) => e.id === "2025")!;
const { timetable, ...unannounced } = held;
void timetable;
const at = (iso: string) => new Date(iso);

const STAGES: DecideStage[] = ["unannounced", "called", "ballot", "held"];
const faqsFor = (stage: DecideStage) =>
  decideFaqs({ label: "Test Federal Election", propositions: 40, stage });
const text = (stage: DecideStage) =>
  [...faqsFor(stage).map((f) => f.answer), compareLead(stage)].join(" ");

describe("decideStage", () => {
  it("is unannounced with no timetable", () => {
    expect(decideStage(unannounced, true, at("2025-04-30T00:00:00+10:00"))).toBe("unannounced");
  });
  it("is called once the timetable exists, before nominations are declared", () => {
    expect(decideStage(held, true, at("2025-04-01T00:00:00+10:00"))).toBe("called");
    expect(decideStage(held, false, at("2025-04-01T00:00:00+10:00"))).toBe("called");
  });
  it("has a ballot while live, once candidates are loaded", () => {
    expect(decideStage(held, false, at("2025-04-30T00:00:00+10:00"))).toBe("ballot");
    expect(decideStage(held, true, at("2025-04-30T00:00:00+10:00"))).toBe("called");
  });
  it("is held once the polls have closed", () => {
    expect(decideStage(held, false, at("2025-05-20T00:00:00+10:00"))).toBe("held");
  });
});

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
    for (const stage of ["called", "ballot", "held"] as const) {
      expect(text(stage)).not.toContain("announced");
    }
    expect(text("called")).toContain(
      "Candidates for this election aren't final yet, so there is no ballot yet",
    );
  });

  it("promise no ballot or plan before there is a ballot", () => {
    for (const stage of ["unannounced", "called"] as const) {
      expect(text(stage)).not.toMatch(/ballot order|voting plan|blank ballot|your ballot/);
      expect(compareLead(stage)).toContain("in the current Parliament");
    }
  });

  it("describe ballot order and an 18+ plan only while the ballot is live", () => {
    expect(text("ballot")).toContain(
      "If you are 18 or over, you can then build your own voting plan",
    );
    expect(compareLead("ballot")).toContain("beside the candidates on your ballot");
    for (const stage of ["unannounced", "called", "held"] as const) {
      expect(text(stage)).not.toContain("build your own voting plan");
    }
  });

  it("call a held election's plan a historical demonstration", () => {
    expect(text("held")).toContain("This election has already been held");
    expect(text("held")).toContain("A plan built for it is a historical demonstration");
    expect(compareLead("held")).toContain("as a historical comparison");
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
