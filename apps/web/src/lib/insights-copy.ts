/**
 * The Insights page's wording, apart from its lead (`InsightsLead.svelte`, which links): each piece
 * with its values named, `{n}` for one (filled with `$lib/template`). The page fills them, and the
 * build renders each once, its values marked, into `states/insights.html` for the iOS app to draw
 * the same words from (ADR 0019 D4b).
 */
export const INSIGHTS_COPY = {
  top: "Insights",
  back: "Back to start",
  title: "What the numbers say",
  elections: "Choose an election",
  cohorts: "Show responses by when they were collected",
  regions: "Choose a region",
  national: "Australia",
  failed: "Insights aren't available right now. Please try again later.",
  loading: "Loading…",
  updated: "{election} · updated {date} · {count} responses",
  withheld:
    "Not enough responses in this group yet to show without identifying individuals — try “All responses”, or check back later.",
  parties: "How party match lines up with who people are",
  bar: "{label}: {pct}% of {shown} shown responses",
  of: "of {shown} shown responses",
  propositions: "How respondents answered each issue",
  agree: "Agree",
  neutral: "Neutral",
  disagree: "Disagree",
  split: "Agree {agree}%, neutral {neutral}%, disagree {disagree}%, of {shown} shown responses",
  tally: "Agree {agree}% · Neutral {neutral}% · Disagree {disagree}% · of {shown} shown",
  footnote:
    "Percentages are of responses shown in each group, after small groups are withheld, so they may not cover every response received. Because the sample is people who chose to use this tool, it is not a representative poll. Responses are grouped by when they were collected and never combined across those groups without saying so.",
  upcoming:
    "The {election} is newly open for comparisons — no survey responses have been collected yet. Results appear here, as privacy-protected aggregates, once enough people contribute.",
  empty:
    "Not enough responses yet to show anything without identifying individuals. Check back after more people have built their comparisons.",
  closedTitle: "Insights are closed for election day",
  closed: "Check back after polls close nationally, from {time}.",
  closedTime: "8 pm AEST",
} as const;
