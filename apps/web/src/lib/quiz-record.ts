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
