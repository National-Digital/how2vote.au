/**
 * The research survey's wording, apart from its collection notice (`SurveyNotes.svelte`) and its
 * Terms acceptance (`SurveyTermsLabel.svelte`), which link: each piece with its values named, `{n}`
 * for one (filled with `$lib/template`). The survey page fills them, and the build renders each once,
 * its values marked, into `states/survey.html` for the iOS app to draw the same words from (ADR 0019
 * D4b).
 */
export const SURVEY_COPY = {
  ready: "Your result is ready.",
  archivedTitle: "Contribute to historical comparison research? Optional.",
  liveTitle: "Help improve the research? Optional.",
  archivedConsent:
    "I am at least {age} and consent to National Digital collecting the answers and optional survey information I choose to provide for the historical and cross-election research purposes described above and in the Privacy Policy.",
  liveConsent:
    "I confirm I am {age} or older and consent to National Digital collecting the information described above for these research purposes.",
  sensitiveConsent:
    "Optional, and not required to take part: I also consent to being asked, and to providing, the more sensitive categories — trade union membership, Aboriginal or Torres Strait Islander origin, religion, and sexual orientation. Leave this unticked to contribute without them.",
  contribute: "Contribute my answers and continue",
  skipPlan: "Skip research and build my voting plan",
  skipComparison: "Skip research and see my comparison",
  prefer: "Prefer not to say",
  progress: "Survey progress",
} as const;
