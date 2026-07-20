import type { AnswerPoints } from "@how2vote/engine";

/**
 * The answer scale. One tap encodes direction/strength (`points`). The ×10
 * "extremely important" flag is no longer set here — it is applied on the review screen by
 * starring an issue, and still only ever attaches to the two extremes (strongly agree/disagree),
 * exactly as the scoring model allows. "Skip" is a real, quiet option (scored as No Answer).
 */
export type OptionSpec =
  | { kind: "answer"; points: AnswerPoints; label: string; sub?: string }
  | { kind: "skip"; label: string };

export const OPTIONS: OptionSpec[] = [
  { kind: "answer", points: 5, label: "Strongly agree" },
  { kind: "answer", points: 4, label: "Agree" },
  { kind: "answer", points: 3, label: "Equal merits", sub: "both sides have a point" },
  { kind: "answer", points: 2, label: "Disagree" },
  { kind: "answer", points: 1, label: "Strongly disagree" },
  { kind: "skip", label: "Skip — no position on this issue" },
];

/** Short label for the review screen and a11y announcements. `important` prefixes a star. */
export function answerLabel(points: AnswerPoints, important: boolean): string {
  const base: Record<AnswerPoints, string> = {
    0: "Skipped",
    1: "Strongly disagree",
    2: "Disagree",
    3: "Equal merits",
    4: "Agree",
    5: "Strongly agree",
  };
  return important ? `★ ${base[points]}` : base[points];
}

/** Maps a keyboard key to an answer action for the quiz screen. */
export function keyToAction(
  key: string,
): { type: "answer"; points: AnswerPoints } | { type: "skip" } | null {
  if (key >= "1" && key <= "5") return { type: "answer", points: Number(key) as AnswerPoints };
  if (key === "0") return { type: "skip" };
  return null;
}
