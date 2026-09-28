/**
 * The ballot picker's wording that only the app shows, rendered into `states/ballot.html` beside
 * `BALLOT_COPY`. Kept apart so it never ships in the web page's code.
 */
export const BALLOT_APP_COPY = {
  /** Where the ballot could not be recorded: the web's write cannot fail, the app's can. */
  unsaved: "Couldn't record your ballot. Please try again.",
} as const;
