import type { PartyKey } from "@how2vote/data-schema";

/**
 * The user's answer to one proposition.
 *
 * `points` uses the same 1–5 scale as the compiled party positions, plus 0 for "no position"
 * (a skip): 1 strongly disagree · 2 disagree · 3 equal merits · 4 agree · 5 strongly agree ·
 * 0 skipped. `important` (the ×10 "extremely important" lever) exists only for the extremes
 * (1 or 5); it is ignored for any other answer.
 */
export type AnswerPoints = 0 | 1 | 2 | 3 | 4 | 5;

export type Answer = {
  /** The question id (a They Vote For You policy id). */
  id: number;
  points: AnswerPoints;
  important: boolean;
};

export const isExtreme = (points: AnswerPoints): boolean => points === 1 || points === 5;
export const isModerate = (points: AnswerPoints): boolean => points === 2 || points === 4;
export const isNeutral = (points: AnswerPoints): boolean => points === 3;
export const isSkipped = (points: AnswerPoints): boolean => points === 0;

/** A party's pooled scoring accumulator across all answered questions. */
export type PartyAccumulator = {
  key: PartyKey;
  /** Numerator: sum of points awarded. */
  score: number;
  /** Denominator: sum of the maximum points obtainable on the scored questions. */
  count: number;
};
