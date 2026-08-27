import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  nativeImportancePoints,
  nativeScale,
  verifyAnswerScale,
  webImportancePoints,
  webScale,
} from "./check-native-answer-scale.mjs";

const url = (p) => new URL(p, import.meta.url);
const WEB = readFileSync(url("../apps/web/src/lib/answers.ts"), "utf8");
const NATIVE = readFileSync(url("../apps/mobile/ios/App/App/Model/AnswerScale.swift"), "utf8");
const WEB_QUIZ = readFileSync(url("../apps/web/src/lib/quiz.svelte.ts"), "utf8");
/** The importance rule in the shape `record()` writes it, for the synthetic fixtures below. */
const rule = (points = [1, 5]) =>
  `const imp = important && (${points.map((p) => `points === ${p}`).join(" || ")})`;

const ts = ({ options = [], labels = {}, star = "★" } = {}) =>
  "export const OPTIONS: OptionSpec[] = [\n" +
  options
    .map((o) =>
      o.kind === "skip"
        ? `  { kind: "skip", label: "${o.label}" },`
        : `  { kind: "answer", points: ${o.points}, label: "${o.label}"` +
          `${o.sub === undefined ? "" : `, sub: "${o.sub}"`} },`,
    )
    .join("\n") +
  "\n];\n" +
  "  const base: Record<AnswerPoints, string> = {\n" +
  Object.entries(labels)
    .map(([p, l]) => `    ${p}: "${l}",`)
    .join("\n") +
  "\n  };\n" +
  "  return important ? `" +
  star +
  " ${base[points]}` : base[points];\n";

const swift = ({ options = [], labels = {}, star = "★" } = {}) =>
  "    static let options: [AnswerOption] = [\n" +
  options
    .map(
      (o) =>
        `        AnswerOption(kind: .${o.kind}, points: ${o.points}, label: "${o.label}", ` +
        `sub: ${o.sub === undefined ? "nil" : `"${o.sub}"`}),`,
    )
    .join("\n") +
  "\n    ]\n" +
  "        let base: [Int: String] = [\n" +
  Object.entries(labels)
    .map(([p, l]) => `            ${p}: "${l}",`)
    .join("\n") +
  "\n        ]\n" +
  `        return important ? "${star} \\(text)" : text\n`;

const SCALE = [
  { kind: "answer", points: 5, label: "Strongly agree" },
  { kind: "answer", points: 3, label: "Equal merits", sub: "both sides have a point" },
  { kind: "skip", points: 0, label: "Skip" },
];
const LABELS = { 0: "Skipped", 3: "Equal merits", 5: "Strongly agree" };

describe("webScale", () => {
  it("reads options, secondary text, short labels and the star", () => {
    const scale = webScale(ts({ options: SCALE, labels: LABELS }));
    expect(scale.options).toEqual([
      { kind: "answer", points: 5, label: "Strongly agree", sub: null },
      { kind: "answer", points: 3, label: "Equal merits", sub: "both sides have a point" },
      // A skip row declares no points and is scored as No Answer.
      { kind: "skip", points: 0, label: "Skip", sub: null },
    ]);
    expect(scale.labels).toEqual({ 0: "Skipped", 3: "Equal merits", 5: "Strongly agree" });
    expect(scale.star).toBe("★");
  });

  it("reads the committed source", () => {
    const scale = webScale(WEB);
    expect(scale.options).toHaveLength(6);
    expect(scale.options.at(-1)?.kind).toBe("skip");
    expect(Object.keys(scale.labels)).toHaveLength(6);
    expect(scale.star).toBe("★");
  });
});

describe("nativeScale", () => {
  it("reads the committed source", () => {
    const scale = nativeScale(NATIVE);
    expect(scale.options).toHaveLength(6);
    expect(scale.options.at(-1)?.kind).toBe("skip");
    expect(Object.keys(scale.labels)).toHaveLength(6);
    expect(scale.star).toBe("★");
  });
});

describe("verifyAnswerScale", () => {
  it("passes on the committed sources", () => {
    expect(verifyAnswerScale(WEB, NATIVE, WEB_QUIZ)).toEqual([]);
  });

  it("fails closed when either side is unreadable", () => {
    expect(verifyAnswerScale("", NATIVE, WEB_QUIZ).join(" ")).toContain(
      "the web declares no OPTIONS",
    );
    expect(verifyAnswerScale(WEB, "", WEB_QUIZ).join(" ")).toContain("declares no options");
  });

  // The failure this guard exists for: the screen still reads correctly and the engine still
  // scores, but the tap is recorded as its opposite.
  it("catches a rebound label", () => {
    const swapped = SCALE.map((o) => (o.points === 5 ? { ...o, points: 1 } : o));
    const errors = verifyAnswerScale(
      ts({ options: SCALE, labels: LABELS }),
      swift({ options: swapped, labels: LABELS }),
      rule(),
    );
    expect(errors.join(" ")).toContain("option 1 differs");
  });

  it("catches a scale of a different length", () => {
    const errors = verifyAnswerScale(
      ts({ options: SCALE, labels: LABELS }),
      swift({ options: SCALE.slice(0, 2), labels: LABELS }),
      rule(),
    );
    expect(errors.join(" ")).toContain("3 options on the web and 2 natively");
  });

  it("catches drifted secondary text", () => {
    const reworded = SCALE.map((o) => (o.sub ? { ...o, sub: "both sides have a case" } : o));
    const errors = verifyAnswerScale(
      ts({ options: SCALE, labels: LABELS }),
      swift({ options: reworded, labels: LABELS }),
      rule(),
    );
    expect(errors.join(" ")).toContain("option 2 differs");
  });

  it("catches a short label that would misreport an answer to VoiceOver", () => {
    const errors = verifyAnswerScale(
      ts({ options: SCALE, labels: LABELS }),
      swift({ options: SCALE, labels: { ...LABELS, 3: "Mixed views" } }),
      rule(),
    );
    expect(errors.join(" ")).toContain("the short label for 3 differs");
  });

  it("catches a scored option that answerLabel cannot name", () => {
    const unnamed = { 0: "Skipped", 5: "Strongly agree" };
    const errors = verifyAnswerScale(
      ts({ options: SCALE, labels: unnamed }),
      swift({ options: SCALE, labels: unnamed }),
      rule(),
    );
    expect(errors.join(" ")).toContain("the web scores 3 but answerLabel has no name for it");
  });

  it("catches a drifted importance mark", () => {
    const errors = verifyAnswerScale(
      ts({ options: SCALE, labels: LABELS }),
      swift({ options: SCALE, labels: LABELS, star: "*" }),
      rule(),
    );
    expect(errors.join(" ")).toContain("mark differs");
  });
});

describe("the \u00d710 importance lever", () => {
  it("reads the same two extremes from both committed sources", () => {
    expect(webImportancePoints(WEB_QUIZ)).toEqual([1, 5]);
    expect(nativeImportancePoints(NATIVE)).toEqual([1, 5]);
  });

  // A star on a middling answer multiplies a weight the scoring model does not, so the result is
  // wrong without looking wrong.
  it("catches a native side that would star a middling answer", () => {
    const widened = NATIVE.replace(
      "importanceApplies: Set<Int> = [1, 5]",
      "importanceApplies: Set<Int> = [1, 3, 5]",
    );
    expect(verifyAnswerScale(WEB, widened, WEB_QUIZ).join(" ")).toContain("[1,3,5] natively");
  });

  it("catches a web rule the native side has not followed", () => {
    const changed = WEB_QUIZ.replace(
      "points === 1 || points === 5",
      "points === 1 || points === 2 || points === 5",
    );
    expect(verifyAnswerScale(WEB, NATIVE, changed).join(" ")).toContain("[1,2,5] on the web");
  });

  it("fails closed when either side stops declaring the rule", () => {
    expect(verifyAnswerScale(WEB, NATIVE, "").join(" ")).toContain("no importance rule");
    const stripped = NATIVE.replace(/static let importanceApplies: Set<Int> = \[[^\]]*\]/, "");
    expect(verifyAnswerScale(WEB, stripped, WEB_QUIZ).join(" ")).toContain("no importanceApplies");
  });
});
