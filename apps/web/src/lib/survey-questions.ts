/**
 * The survey question set and its derived allowlists — a LEAF module (imports nothing), so the
 * Cloudflare Pages Functions can bundle it. The ingestion Function and the research registry
 * import `DEMOGRAPHIC_OPTIONS` / `SENSITIVE_DIMENSIONS` from HERE (not from ./survey, whose
 * transport half imports browser-only modules like $lib/channel that the Functions bundler cannot
 * resolve); the client keeps importing everything via ./survey, which re-exports this module, so
 * the client UI and the server still can never drift.
 *
 * Question design notes (ABS/AES concordances, codebook coupling) are in ./survey's module
 * docstring; the exact wordings and options here are the codebook at docs/research/codebook.md —
 * keep the two in step.
 */

export type SurveyAnswers = Record<string, string>;

export type SurveyQuestion = {
  key: string;
  label: string;
  options: readonly string[];
  /** A short helper line shown under the question (e.g. scale endpoints). */
  note?: string;
  /** When this returns true for the answers gathered so far, the question is not shown. */
  skipWhen?: (answers: SurveyAnswers) => boolean;
};

/** House first-preference party options, shared by the past-vote and vote-intention questions. */
const PARTIES = [
  "Labor",
  "Liberal/National Coalition",
  "Greens",
  "One Nation",
  "Independent or other",
] as const;

/**
 * The 20 questions, in the order they are asked: four blocks of rising sensitivity — about you, your
 * household, culture and identity, then politics — with the two vote questions last. Options are
 * election-independent (only the past-vote *label* names a specific election, filled in by
 * `surveyFor`), so the stored value set is stable across the 2019/2022/2025 toggle.
 */
export const SURVEY: readonly SurveyQuestion[] = [
  // — About you —
  {
    key: "age",
    label: "Your age group",
    options: ["18–24", "25–34", "35–44", "45–54", "55–64", "65–74", "75+"],
  },
  {
    key: "gender",
    label: "How do you describe your gender?",
    options: ["Man or male", "Woman or female", "Non-binary", "I use a different term"],
  },
  {
    key: "education",
    label: "Your highest level of education",
    options: [
      "Year 11 or below",
      "Year 12",
      "Certificate (incl. trade)",
      "Diploma or advanced diploma",
      "Bachelor degree",
      "Postgraduate degree",
    ],
  },
  {
    key: "work",
    label: "Which best describes your work situation?",
    options: [
      "Working full-time",
      "Working part-time or casual",
      "Unemployed, looking for work",
      "Retired",
      "Studying, not working",
      "Home duties, caring or other",
    ],
  },
  { key: "union_member", label: "Are you a member of a trade union?", options: ["Yes", "No"] },

  // — Your household —
  {
    key: "household_size",
    label: "Including you, how many people live in your household?",
    options: ["1", "2", "3", "4", "5 or more"],
  },
  {
    key: "children",
    label: "Do you have children under 18 living with you?",
    options: ["Yes", "No"],
  },
  {
    key: "tenure",
    label: "Your home is…",
    options: ["Owned outright", "Owned with a mortgage", "Rented", "Other arrangement"],
  },
  {
    key: "income",
    label: "Your household's total yearly income, before tax",
    options: [
      "Under $52,000",
      "$52,000–$104,000",
      "$104,000–$156,000",
      "$156,000–$208,000",
      "Over $208,000",
    ],
  },
  {
    key: "financial",
    label: "Compared with 12 months ago, is your household financially…",
    options: ["Better off", "About the same", "Worse off"],
  },

  // — Culture and identity —
  {
    key: "birthplace",
    label: "Where were you born?",
    options: ["Australia", "Overseas, mainly English-speaking country", "Overseas, other country"],
  },
  {
    key: "language",
    label: "Do you speak a language other than English at home?",
    options: ["Yes", "No"],
  },
  {
    key: "indigenous",
    label: "Are you of Aboriginal or Torres Strait Islander origin?",
    options: ["No", "Yes, Aboriginal", "Yes, Torres Strait Islander", "Yes, both"],
  },
  {
    key: "religion",
    label: "Your religion",
    options: ["No religion", "Christian", "Muslim", "Hindu", "Buddhist", "Sikh", "Other religion"],
  },
  {
    key: "attendance",
    label: "How often do you attend religious services?",
    options: ["Never", "Rarely", "A few times a year", "Monthly or more", "Weekly or more"],
    // Religiosity only makes sense for people with a religion; the AES routes the same way.
    skipWhen: (a) => a.religion === "No religion",
  },
  {
    key: "orientation",
    label: "How do you describe your sexual orientation?",
    options: ["Straight (heterosexual)", "Gay or lesbian", "Bisexual", "I use a different term"],
  },

  // — Politics —
  {
    key: "politics_scale",
    label: "In politics, where would you place yourself?",
    note: "0 = left · 10 = right",
    options: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  },
  {
    key: "party_id",
    label: "Do you usually think of yourself as…",
    options: [...PARTIES, "Another party", "No party"],
  },
  {
    key: "past_vote",
    // Label is election-dependent; surveyFor() names the relevant election.
    label: "At the last federal election, who did you vote for in the House of Representatives?",
    options: [...PARTIES, "Didn't vote", "Couldn't vote"],
  },
  {
    key: "vote_intention",
    label: "If the election were held today, who would you vote for?",
    options: [...PARTIES, "Undecided"],
  },
  {
    // Only asked for a historical election (see surveyFor). For a current election the two questions
    // above already capture recent and current intent; adding this would be redundant. It exists as
    // its own key/column so the "next election" timeframe is never merged with the others.
    key: "vote_next",
    label:
      "Which party would you currently be most likely to vote for at the next federal election?",
    options: [...PARTIES, "Undecided"],
  },
];

/** Federal election that preceded each election id, for the past-vote question's wording. */
const PREVIOUS_ELECTION: Record<string, string> = {
  "2025": "2022",
  "2022": "2019",
  "2019": "2016",
};

/**
 * The survey tailored to the election being compared. A contribution to a HISTORICAL election is a
 * retrospective view expressed today, so the political questions must be framed as three distinct,
 * unambiguous variables and never merged:
 *
 *  - HISTORICAL (`isArchived`): `past_vote` asks who they voted for IN that election; `vote_intention`
 *    asks who they would choose if that election's ballot were presented TODAY; and `vote_next` (shown
 *    only here) asks about the NEXT federal election.
 *  - CURRENT/LIVE: `past_vote` names the election that preceded this one; `vote_intention` is current
 *    intent ("if held today"); `vote_next` is not shown (it would duplicate current intent).
 *
 * Everything else is identical to `SURVEY`, so the stored value set is stable across the toggle.
 */
export function surveyFor(
  electionId: string,
  opts: { isArchived?: boolean; year?: number } = {},
): SurveyQuestion[] {
  const { isArchived = false, year } = opts;
  const pastLabel =
    isArchived && year
      ? `Which party, if any, did you vote for in the ${year} federal election?`
      : (() => {
          const prev = PREVIOUS_ELECTION[electionId];
          return prev
            ? `In the ${prev} federal election, who did you vote for in the House of Representatives?`
            : "At the last federal election, who did you vote for in the House of Representatives?";
        })();
  const intentionLabel =
    isArchived && year
      ? `If the ${year} candidates and ballot were presented to you today, who would you currently be most likely to vote for?`
      : "If the election were held today, who would you vote for?";

  return SURVEY.filter((q) => q.key !== "vote_next" || isArchived).map((q) => {
    if (q.key === "past_vote") return { ...q, label: pastLabel };
    if (q.key === "vote_intention") return { ...q, label: intentionLabel };
    return q;
  });
}

/**
 * Allowlist of valid stored values per demographic key, derived from `SURVEY`. The ingestion
 * Function imports this to validate submissions, so the client UI and the server can never disagree
 * about what is storable — anything off this list is dropped, never stored.
 */
export const DEMOGRAPHIC_OPTIONS: Record<string, readonly string[]> = Object.fromEntries(
  SURVEY.map((q) => [q.key, q.options]),
);

/**
 * Demographic dimensions that are sensitive information under the Privacy Act 1988 (Cth):
 * union membership; racial/ethnic origin (birthplace, language, Indigenous origin); religion
 * (incl. attendance); sexual orientation; political opinion (the five politics items). The
 * ingestion Function stores counter rows for these dimensions NATIONAL-ONLY — never keyed by
 * state — per the key rule in docs/research/analysis-plan.md (no opinion × sensitive attribute ×
 * sub-national geography in one counter). Keep in step with SENSITIVE_DIMENSIONS in
 * packages/data-pipeline/src/stats.ts.
 */
export const SENSITIVE_DIMENSIONS: ReadonlySet<string> = new Set([
  "union_member",
  "birthplace",
  "language",
  "indigenous",
  "religion",
  "attendance",
  "orientation",
  "politics_scale",
  "party_id",
  "past_vote",
  "vote_intention",
  "vote_next",
]);
