/**
 * The "clear all my data" control's confirmation: the question and its two answers, and the label
 * the confirming button takes while the wipe runs. `ClearMyData.svelte` renders them, and the build
 * renders each once into `states/clear-data.html` for the iOS app to draw the same words from
 * (ADR 0019 D4b).
 */
export const CLEAR_DATA_COPY = {
  ask: "Permanently clear everything on this device?",
  confirm: "Yes, clear everything",
  clearing: "Clearing…",
  cancel: "Cancel",
} as const;
