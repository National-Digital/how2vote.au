/**
 * The quiz's own wording, apart from the questions: each piece with its values named, `{n}` for
 * one (filled with `$lib/template`). The quiz page fills them for the screen, and the build renders each once, its values marked,
 * into `states/quiz.html` for the iOS app to draw the same words from (ADR 0019 D4b).
 */
export const QUIZ_COPY = {
  position: "Question {n} of {total}",
  previous: "Previous question",
  backToAnswers: "Back to your answers",
  pause: "Pause",
  progress: "Quiz progress",
  loading: "Loading question…",
  failed: "Couldn't load the questions. Please check your connection and {retry}.",
  retry: "try again",
  voted: "Parliament voted on this",
  source: "See the parliamentary votes behind this",
  ask: "How would you vote on this?",
  answers: "Your answer",
  answered: "Answered: {answer}. Question {n} of {total}.",
  updated: "Answer updated: {answer}. Returning to your answers.",
} as const;

export type QuizCopyKey = keyof typeof QUIZ_COPY;

/** An answer as the quiz announces it, by its points: 0 is a skip. */
export const SPOKEN_ANSWERS = [
  "Skipped",
  "strongly disagree",
  "disagree",
  "equal merits",
  "agree",
  "strongly agree",
] as const;
