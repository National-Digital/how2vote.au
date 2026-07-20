import type { Merge, PartyKey, Question } from "@how2vote/data-schema";
import { NO_DATA } from "@how2vote/data-schema";
import { isExtreme, isModerate, isNeutral, type Answer, type PartyAccumulator } from "./answers.js";

/** Sentinel percentage meaning "no result / no data". */
export const NO_RESULT = -1 as const;

/**
 * Points awarded and the per-question denominator for one party, given the user's answer and the
 * Manhattan distance `d = |partyScore − userScore|`.
 *
 * The award decreases linearly with distance and is floored at 0. The denominator encodes two
 * weightings pooled into the final ratio:
 *   - **answer strength** — extreme 4 / moderate 3 / neutral 2 max points per question;
 *   - **importance ×10** — an "extremely important" extreme scales both award and denominator by 10.
 *
 * Returns `null` when the answer contributes nothing (a skip, handled by the caller).
 */
function award(answer: Answer, d: number): { points: number; denom: number } | null {
  const { points, important } = answer;
  if (isExtreme(points)) {
    if (important) return { points: Math.max(0, 40 - 10 * d), denom: 40 };
    return { points: Math.max(0, 4 - d), denom: 4 };
  }
  if (isModerate(points)) return { points: Math.max(0, 3 - d), denom: 3 };
  if (isNeutral(points)) return { points: Math.max(0, 2 - d), denom: 2 };
  return null; // points === 0 → No Answer / skip
}

/**
 * Scores every party against the user's answers.
 *
 * For each answered question, every party with recorded data (position ≠ -1) receives points by
 * distance, and the question's denominator is added to that party's running total. Skipped answers
 * and no-data positions contribute nothing to either numerator or denominator. Every party key that
 * appears anywhere in the question set is present in the result with a zero accumulator, so a party
 * with no scorable overlap still exists in the output (and later resolves to -1).
 *
 * Party merges are applied here on the **pooled accumulators**, before any percentage is
 * computed, so the merge combines raw sums rather than already-rounded percentages and never
 * averages in a -1 no-data sentinel. Merging raw sums treats the merged party as a single entity
 * with the union of its scorable contributions.
 */
export function scoreParties(
  answers: readonly Answer[],
  questions: readonly Question[],
  merges: readonly Merge[] = [],
): Map<PartyKey, PartyAccumulator> {
  const questionsById = new Map<number, Question>(questions.map((q) => [q.id, q]));

  const acc = new Map<PartyKey, PartyAccumulator>();
  const ensure = (key: PartyKey): PartyAccumulator => {
    let a = acc.get(key);
    if (a === undefined) {
      a = { key, score: 0, count: 0 };
      acc.set(key, a);
    }
    return a;
  };
  // Initialise an accumulator for every party in the universe, so parties that never score still
  // appear in the result set.
  for (const q of questions) for (const key of Object.keys(q.positions)) ensure(key);

  for (const answer of answers) {
    if (answer.points === 0) continue; // skip
    const question = questionsById.get(answer.id);
    if (question === undefined) continue;

    for (const [key, partyScore] of Object.entries(question.positions)) {
      if (partyScore === NO_DATA) continue; // party has no record on this issue
      const contribution = award(answer, Math.abs(partyScore - answer.points));
      if (contribution === null) continue;
      const a = ensure(key);
      a.score += contribution.points;
      a.count += contribution.denom;
    }
  }

  applyMerges(acc, merges);
  return acc;
}

/** Merges pooled accumulators in place: master absorbs merger's score and count, merger removed. */
function applyMerges(acc: Map<PartyKey, PartyAccumulator>, merges: readonly Merge[]): void {
  for (const { master, merger } of merges) {
    const m = acc.get(master);
    const g = acc.get(merger);
    if (m === undefined || g === undefined) continue; // only merge when both are present
    m.score += g.score;
    m.count += g.count;
    acc.delete(merger);
  }
}

/**
 * Final match percentage for a party:
 * `round(score / count × 100)`, or -1 when the party had no scorable questions (count 0).
 */
export function matchPercent(a: PartyAccumulator): number {
  if (a.count === 0) return NO_RESULT;
  return Math.round((a.score / a.count) * 100);
}

/** Convenience: the full party → percentage map after scoring and merging. */
export function matchPercentages(
  answers: readonly Answer[],
  questions: readonly Question[],
  merges: readonly Merge[] = [],
): Map<PartyKey, number> {
  const acc = scoreParties(answers, questions, merges);
  const out = new Map<PartyKey, number>();
  for (const [key, a] of acc) out.set(key, matchPercent(a));
  return out;
}

/**
 * The single best-matching party, or null when nothing scored (all skips / no data). Highest
 * percentage wins; ties break on party key for determinism. Used by the research payload (the
 * match is derived ON DEVICE and only this value is ever transmitted — ADR-0008) and must stay
 * deterministic across clients so the aggregate counters are comparable.
 */
export function topPartyMatch(
  answers: readonly Answer[],
  questions: readonly Question[],
  merges: readonly Merge[] = [],
): PartyKey | null {
  // Compare the UNROUNDED ratio (score / count), not the rounded percentage: two parties whose
  // percentages round to the same integer can have genuinely different alignment, and the truly
  // higher one must win. Exact ratio ties break on party key for determinism (the research payload
  // derives this on-device and it must be identical across clients so the counters are comparable).
  const acc = scoreParties(answers, questions, merges);
  let best: PartyKey | null = null;
  let bestRatio = -Infinity;
  for (const [key, a] of acc) {
    if (a.count === 0) continue; // no scorable questions → no result
    const ratio = a.score / a.count;
    if (ratio > bestRatio || (ratio === bestRatio && best !== null && key < best)) {
      best = key;
      bestRatio = ratio;
    }
  }
  return best;
}
