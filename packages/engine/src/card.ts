import type { Dataset, PartyKey, Position, Question } from "@how2vote/data-schema";
import { NO_DATA, activeQuestions } from "@how2vote/data-schema";
import type { Answer } from "./answers.js";
import {
  aboveTheLine,
  mapBallot,
  type HouseBallotRow,
  type SenateBallotRow,
  type SenateGroupRow,
} from "./ballot.js";
import { matchPercentages } from "./scoring.js";

export type BallotSelection = { state: string; electorate: string };

export type Card = {
  state: string;
  electorate: string;
  house: HouseBallotRow[];
  /** Below-the-line Senate rows: every candidate on the state's paper, in printed ballot order. */
  senate: SenateBallotRow[];
  /** Above-the-line Senate rows: one box per group, in printed column order — the default Senate view. */
  senateAboveLine: SenateGroupRow[];
  /** Per-party match percentages, for the evidence / "why these numbers?" view. */
  percentages: Map<PartyKey, number>;
  /** Data vintage and attribution, surfaced on the card and print (ODbL obligation). */
  dataVersion: string;
  attribution: string;
};

/**
 * The full pipeline for a card: score every party against the answers, merge, then annotate the
 * candidates on the user's ballot — in official ballot order, never reordered by score.
 * Pure and deterministic — the
 * same inputs always produce the same card, which is what lets a shared link recompute offline.
 */
export function generateCard(
  dataset: Dataset,
  input: BallotSelection & {
    answers: readonly Answer[];
    /**
     * Party keys whose party-position alignment is SUSPENDED pending a correction / right of reply
     * Rows for these parties are forced to no-alignment so a disputed figure is never
     * shown. Defaults to empty (nothing suspended).
     */
    suspended?: ReadonlySet<PartyKey>;
    /**
     * Per-session seed for the neutral randomised order used only when the dataset's ballot is
     * `provisional` (candidates nominated, AEC draw not yet declared). Ignored for `drawn`/`pending`
     * ballots, which is every current dataset, so this leaves official-order cards unchanged.
     */
    ballotSeed?: number;
  },
): Card {
  // Withdrawn questions (disabled outputs, ADR 0005) never score — including answers arriving
  // from links shared before the withdrawal.
  const percentages = matchPercentages(
    input.answers,
    activeQuestions(dataset.questions),
    dataset.parties.merges,
  );
  const { house, senate } = mapBallot(
    dataset.ballots,
    dataset.parties.parties,
    percentages,
    input,
    input.suspended,
    input.ballotSeed ?? 0,
  );
  return {
    state: input.state,
    electorate: input.electorate,
    house,
    senate,
    senateAboveLine: aboveTheLine(senate),
    percentages,
    dataVersion: dataset.questions.dataVersion,
    attribution: dataset.questions.attribution,
  };
}

/** One line of the evidence view: how the user answered vs how the party's record scored. */
export type EvidenceLine = {
  questionId: number;
  question: string;
  userPoints: Answer["points"];
  important: boolean;
  partyPosition: Position;
  /** Manhattan distance, or null when the party has no record on this question. */
  distance: number | null;
  agreement: "aligned" | "partial" | "opposed" | "no-data" | "skipped";
  /**
   * Set when this line's position comes from a party that merged into the displayed one (e.g. a
   * predecessor / merged party pooled into it for scoring). The score pools the merger's record, so
   * the evidence must disclose it too — otherwise a question the merger answered shows as "no-data"
   * against a score that in fact counted it.
   */
  viaMerger?: PartyKey;
};

function classify(
  userPoints: Answer["points"],
  partyPosition: Position,
): EvidenceLine["agreement"] {
  if (userPoints === 0) return "skipped";
  if (partyPosition === NO_DATA) return "no-data";
  const d = Math.abs(partyPosition - userPoints);
  if (d === 0) return "aligned";
  if (d <= 1) return "partial";
  return "opposed";
}

/**
 * Builds the per-party evidence breakdown ("Why these numbers?"). For a resolved
 * party key, lists every question the user answered alongside that party's recorded position and
 * whether they align. Cheap because all the data is already client-side.
 */
export function evidenceFor(
  dataset: Dataset,
  partyKey: PartyKey,
  answers: readonly Answer[],
): EvidenceLine[] {
  const byId = new Map<number, Question>(activeQuestions(dataset.questions).map((q) => [q.id, q]));
  // Parties that merged INTO this one — their positions are pooled into the score (applyMerges), so
  // the evidence must fall back to them when the displayed party has no record of its own.
  const mergers = dataset.parties.merges.filter((m) => m.master === partyKey).map((m) => m.merger);
  const lines: EvidenceLine[] = [];
  for (const answer of answers) {
    const q = byId.get(answer.id);
    if (q === undefined) continue;
    let partyPosition = (q.positions[partyKey] ?? NO_DATA) as Position;
    let viaMerger: PartyKey | undefined;
    // Mirror the score: when the displayed party has no record, use the first merged-in party that
    // does, and disclose whose record it is.
    if (partyPosition === NO_DATA) {
      for (const merger of mergers) {
        const mergerPosition = (q.positions[merger] ?? NO_DATA) as Position;
        if (mergerPosition !== NO_DATA) {
          partyPosition = mergerPosition;
          viaMerger = merger;
          break;
        }
      }
    }
    lines.push({
      questionId: q.id,
      question: q.text,
      userPoints: answer.points,
      important: answer.important,
      partyPosition,
      distance:
        answer.points === 0 || partyPosition === NO_DATA
          ? null
          : Math.abs(partyPosition - answer.points),
      agreement: classify(answer.points, partyPosition),
      ...(viaMerger ? { viaMerger } : {}),
    });
  }
  return lines;
}

/**
 * The ordered question-id list used by the share codec (dataset question order). Deliberately
 * INCLUDES withdrawn questions: the fragment payload is positional over this list, so it must
 * stay stable across a withdrawal for previously shared links to keep decoding correctly.
 * Withdrawn answers are inert — {@link generateCard} and {@link evidenceFor} score and present
 * only active questions.
 */
export function orderedQuestionIds(dataset: Dataset): number[] {
  return dataset.questions.questions.map((q) => q.id);
}
