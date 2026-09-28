/**
 * The saved-cards screen's wording: each piece with its values named, `{n}` for one (filled with
 * `$lib/template`). The saved page fills them, and the build renders each once, its values marked,
 * into `states/saved.html` for the iOS app to draw the same words from (ADR 0019 D4b).
 */
export const SAVED_COPY = {
  title: "Saved cards",
  back: "Back to start",
  loading: "Loading your saved cards…",
  none: "You haven't saved any cards yet.",
  how: "When you build a voting comparison, choose {action} to keep it here. Saved cards live only in this browser — they're never uploaded — so you can reopen them later, even offline.",
  action: "Save on this device",
  build: "Build my comparison",
  kept: "Kept only in this browser, on this device — never uploaded. Reopen them any time, even offline. Clearing your browser data removes them.",
  meta: "{state} · saved {date}",
  remove: "Delete",
  removal: "Delete saved card for {electorate}",
  clear: "Clear all",
  ask: "Delete all {count} saved cards?",
  confirm: "Yes, delete all",
  cancel: "Cancel",
} as const;
