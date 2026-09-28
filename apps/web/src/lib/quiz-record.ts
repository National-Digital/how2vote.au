/**
 * The quiz record exchanged with the iOS native core (ADR 0018 D3, ADR 0012), and its mapping to and
 * from the quiz store's fields. Pure, so the exchange is testable without the store's runtime.
 */
import type { AnswerPoints } from "@how2vote/engine";

export type StoredAnswer = { points: AnswerPoints; important: boolean };

export type Persisted = {
  state: string | null;
  electorate: string | null;
  answers: Record<number, StoredAnswer>;
  cursor: number;
  questionIds: number[];
  updatedAt: number;
};

/** The fields of a quiz the record carries. */
export type QuizFields = Omit<Persisted, "updatedAt">;

/** The record for a quiz's fields, stamped `now`. */
export function recordOf(fields: QuizFields, now: number): Persisted {
  return { ...fields, updatedAt: now };
}

/**
 * A quiz's fields from a record, as the native core wrote it: a field it left out (Swift omits a
 * nil) reads as empty rather than as undefined.
 */
export function fieldsOf(record: Partial<Persisted>): QuizFields {
  return {
    state: record.state ?? null,
    electorate: record.electorate ?? null,
    answers: record.answers ?? {},
    cursor: record.cursor ?? 0,
    questionIds: record.questionIds ?? [],
  };
}

/**
 * How many questions have a recorded decision (an explicit skip counts). Only the given questions
 * count: an answer left from a question since withdrawn is kept but not counted, or the count could
 * exceed the total. With no questions known yet, every answer counts.
 */
export function recordedCount(
  answers: Record<number, StoredAnswer>,
  questionIds: number[],
): number {
  if (questionIds.length === 0) return Object.keys(answers).length;
  return questionIds.filter((id) => id in answers).length;
}
