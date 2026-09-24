/**
 * The ballot picker's wording: each piece with its values named, `{n}` for one, as `QUIZ_COPY` is.
 * The ballot page fills them for the screen, and the build renders each once, its values marked,
 * into `states/ballot.html` for the iOS app to draw the same words from (ADR 0019 D4b).
 */
import { STATES } from "$lib/data";

export const BALLOT_COPY = {
  position: "Your ballot · {step} of {total}",
  back: "Go back",
  progress: "Ballot setup progress",
  loading: "Loading…",
  pick: "Where will you vote?",
  electorate: "Your federal electorate",
  failed: "Couldn't load the electorate list. Please check your connection and {retry}.",
  retry: "try again",
  loadingElectorates: "Loading electorates…",
  search: "Search {count} {code} electorates…",
  searchLabel: "Search electorates",
  none: "No electorate matches “{filter}”.",
  unsure: "Not sure? {lookup} — your progress is kept.",
  lookup: "Look up your electorate on the AEC website",
  located: "Federal electorate in {state}",
  start: "This is my electorate — start",
  different: "Choose a different electorate",
  map: "Map of {state} with the {electorate} electorate marked",
  device: "Your answers stay on this device until you choose to share your card.",
} as const;

/** Where a voter who does not know their electorate can look it up. */
export const AEC_LOOKUP = "https://check.aec.gov.au/";

/** The picker's states: alphabetical by code, where `STATES` keeps ballot-paper order. */
export const PICKER_STATES = [...STATES].sort((a, b) => a.code.localeCompare(b.code));
