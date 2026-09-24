/**
 * The review screen's wording that only the app shows, rendered into `states/review.html` beside
 * `REVIEW_COPY`. Kept apart so it never ships in the web page's code.
 */
export const REVIEW_APP_COPY = {
  /** The hint VoiceOver reads on each row. */
  edit: "Changes this answer",
  /** Where an election has no questions to review: the web's page cannot be reached that way. */
  empty: "There are no questions to show for this election.",
} as const;
