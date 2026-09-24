/**
 * The review screen's wording, apart from the questions: each piece with its
 * values named, `{n}` for one (filled with `$lib/template`). The review page fills them for the
 * screen, and the build renders each once, its values marked, into `states/review.html` for the iOS
 * app to draw the same words from (ADR 0019 D4b).
 */
export const REVIEW_COPY = {
  title: "Review your answers",
  back: "Go back",
  progress: "Quiz complete",
  all: "All {total} answered.",
  some: "{recorded} of {total} answered.",
  loading: "Loading your answers…",
  failed: "Couldn't load your answers. Please check your connection and {retry}.",
  retry: "try again",
  unanswered: "Not answered",
  star: 'Mark "{question}" as extremely important',
  glyph: "★",
  compare: "See how I compare",
  importance:
    "Tap a question to change your answer. Star (★) the issues that matter most — only your strongest answers can count ten times as much.",
  multiplier: "Extremely important (×10)",
} as const;
