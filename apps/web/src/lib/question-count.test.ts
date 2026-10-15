import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_ELECTION_ID,
  ELECTIONS,
  activeQuestions,
  type Dataset,
} from "@how2vote/data-schema";
import { manifestFor } from "./manifest";
import { CURRENT_QUESTION_COUNT, pageMeta, quizDescription } from "./seo";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const REPO = resolve(SRC, "../../..");

const datasetFor = (id: string): Dataset =>
  JSON.parse(readFileSync(join(REPO, "data/dist", id, "dataset.json"), "utf8")) as Dataset;

const GAP = String.raw`(?:\s|&nbsp;|-)+`;
const UNITS = "one|two|three|four|five|six|seven|eight|nine";
const NUMBER_WORD = String.raw`(?:twenty|thirty|forty|fifty|sixty)(?:[\s-](?:${UNITS}))?`;
const NUMBER = String.raw`\{?\s*(?:\d+|${NUMBER_WORD})\s*\}?`;

/**
 * A literal question count in copy: "50 questions", "The 36 propositions", "50-question",
 * "fifty real questions", a braced number, "50&nbsp;questions", including across a line break.
 * At most one word may sit between the number and the noun.
 */
const LITERAL_COUNT = new RegExp(
  String.raw`\b${NUMBER}${GAP}(?:[a-z]+${GAP})?(?:questions?|propositions?|issues?)\b`,
  "gi",
);

/** Matches that are not about the proposition set: the research survey's own question list. */
const ALLOWED = [
  { file: "lib/survey-questions.ts", text: "The 20 questions, in the order they are asked" },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(svelte|ts|js|mjs|json|html|md|txt)$/.test(e.name) && !/\.test\.ts$/.test(e.name)
      ? [path]
      : [];
  });
}

type Hit = { hit: string; context: string };

function literalCounts(text: string): Hit[] {
  return [...text.matchAll(LITERAL_COUNT)].map((m) => ({
    hit: m[0].replace(/\s+/g, " ").trim(),
    context: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40),
  }));
}

describe("question counts", () => {
  it.each(ELECTIONS.map((e) => e.id))(
    "%s: the manifest count equals the dataset's active questions",
    (id) => {
      expect(manifestFor(id).counts["questions"]).toBe(
        activeQuestions(datasetFor(id).questions).length,
      );
    },
  );

  it("takes the current election's count for the default copy", () => {
    expect(CURRENT_QUESTION_COUNT).toBe(
      activeQuestions(datasetFor(CURRENT_ELECTION_ID).questions).length,
    );
    expect(CURRENT_QUESTION_COUNT).toBeGreaterThan(0);
    expect(pageMeta["/quiz"].description).toBe(quizDescription(CURRENT_QUESTION_COUNT));
    expect(pageMeta["/quiz"].description).toContain(
      `Answer ${CURRENT_QUESTION_COUNT} real questions`,
    );
  });

  it("omits the number from the quiz description when the count is unknown", () => {
    expect(quizDescription(0)).toMatch(/^Answer real questions /);
  });

  it("detects a literal count in any form", () => {
    for (const sample of [
      "Answer 50 questions",
      "Answer 50\n  questions",
      "The 36 propositions",
      "a 50-question run",
      "fifty real questions",
      "thirty-six issues",
      "twenty nine actual questions",
      "{29} questions",
      "50&nbsp;questions",
    ])
      expect(literalCounts(sample), sample).toHaveLength(1);
    expect(literalCounts("Answer {count} real questions")).toEqual([]);
  });

  it("never hard-codes a question count in app copy", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const at = relative(SRC, file);
      return literalCounts(readFileSync(file, "utf8"))
        .filter(({ context }) => !ALLOWED.some((a) => a.file === at && context.includes(a.text)))
        .map(({ hit }) => `${at}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });
});
