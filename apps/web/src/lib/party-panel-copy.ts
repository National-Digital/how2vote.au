/**
 * The party alignment panel's wording, apart from its label (`PartyPanelLabel.svelte`), which
 * carries emphasis: each piece with its values named, `{n}` for one (filled with `$lib/template`).
 * The panel fills them, and the build renders each once, its values marked, into `states/card.html`
 * for the iOS app to draw the same words from (ADR 0019 D4b).
 */
export const PARTY_PANEL_COPY = {
  unnamed: "Unnamed group",
  groupNote: "Registered {group} parties — shown together, each with its own record. Not ranked.",
  empty: "No party voting records are available to compare for this ballot.",
  spoken:
    "{party}: {detail} This is the party's recorded voting, not this candidate's personal position — evidence only, not a recommended preference.",
} as const;
