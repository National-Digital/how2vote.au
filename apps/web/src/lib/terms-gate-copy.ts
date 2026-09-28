/**
 * The Terms gate's controls. The gate renders them, and the build renders them into
 * `states/card.html` for the iOS app to draw the same words from (ADR 0019 D4b). The gate's intro
 * and its acceptance are the Terms' own (`$lib/terms/terms`).
 */
export const TERMS_GATE_COPY = {
  accept: "Accept and continue",
  cancel: "Cancel",
} as const;
