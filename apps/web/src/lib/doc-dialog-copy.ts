/**
 * The labels of a document opened over a page (`DocDialog.svelte`): its close button's accessible
 * name, `{title}` for the document's, and its closing button. The build renders the close button's
 * name into `states/survey.html`, for the iOS app's sheet over the survey's gate (ADR 0019 D4j).
 */
export const DOC_DIALOG_COPY = {
  close: "Close {title}",
  done: "Done",
} as const;
