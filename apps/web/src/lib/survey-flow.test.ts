import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NativeSurveyStep } from "./survey-flow.svelte";
import { surveyFor } from "./survey-questions";

/**
 * A step of each kind, as `survey.nativeStep()` hands it to the iOS app. Typed as the web's own
 * step, so a change to what the web hands over fails the typecheck here until the fixture — and the
 * app's decoder, which `DocumentLogic` holds to it — follows.
 */
const STEPS: NativeSurveyStep[] = [
  {
    step: "gate",
    key: "gate",
    archived: true,
    year: "2022",
    inFlight: false,
    consented: true,
    sensitive: false,
    termsNeeded: true,
    terms: false,
    canContribute: false,
  },
  {
    step: "question",
    key: "age",
    label: "How old are you?",
    note: "",
    options: ["18–24", "25–34", "35–49", "50–64", "65 or over"],
    position: 1,
    total: 12,
  },
];

describe("the survey steps the app draws", () => {
  // Regenerate with UPDATE_SURVEY_FIXTURE=1.
  it("match the fixture the app's decoder is held to", () => {
    const path = new URL("../../../mobile/ios/Parity/survey-steps.json", import.meta.url);
    const json = JSON.stringify(STEPS, null, 2) + "\n";
    if (process.env["UPDATE_SURVEY_FIXTURE"]) writeFileSync(path, json);
    expect(readFileSync(path, "utf8")).toBe(json);
  });
});

describe("the survey's step keys", () => {
  // The gate and each question are named by their key in the requests the app makes; one question
  // named as the gate would let a step back from it be read as one from the gate.
  it("never name a question as the gate", () => {
    const gate: Extract<NativeSurveyStep, { step: "gate" }>["key"] = "gate";
    for (const id of ["next", "2025", "2022", "2019"]) {
      for (const isArchived of [false, true]) {
        const keys = surveyFor(id, { isArchived, year: 2022 }).map((q) => q.key);
        expect(keys).not.toContain(gate);
      }
    }
  });
});
