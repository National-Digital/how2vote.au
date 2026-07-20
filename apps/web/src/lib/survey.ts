/**
 * The optional research survey. Demographics are non-scoring and never influence the
 * card. Answers are posted fire-and-forget to the same-origin research endpoint (`/api/research`, a
 * Cloudflare Pages Function backed by D1 — see ADR-0007). Because the
 * endpoint is same-origin there is no third-party origin and no CSP change; if it is unavailable or
 * the network fails, the card is entirely unaffected. "Prefer not to say" is available on every
 * question and stores nothing for it.
 *
 * The question set is designed for third-party research reuse: every categorical answer is an exact
 * union of an Australian Bureau of Statistics category (Census / ABS standards) so responses can be
 * benchmarked and post-stratified against Census and AEC data, and the political items follow the
 * Australian Election Study (AES) conventions so they can be compared against that instrument. The
 * exact wordings, options and concordances are the codebook at docs/research/codebook.md — keep the
 * two in step. This file is the single source of truth for the option allowlist: the ingestion
 * Function imports `DEMOGRAPHIC_OPTIONS` from here so the client and server can never drift.
 *
 * The research SCHEMA and CONSENT versions live in ./research/consent.ts (the single source both the
 * client and the server read); this file re-exports RESEARCH_CONSENT_VERSION for its existing callers.
 */
import { RESEARCH_CONSENT_VERSION, RESEARCH_SCHEMA_VERSION } from "./research/consent";
import { RESEARCH_ENDPOINTS, transportInit } from "./research/transport-policy";

export { RESEARCH_CONSENT_VERSION } from "./research/consent";

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

/** Same-origin research ingestion endpoints (Pages Functions). Relative, so they need no env var and
 *  stay within `connect-src 'self'`. A 404 (Functions not deployed) is swallowed below. The detailed
 *  Views record and the electorate tally go to SEPARATE endpoints as two independent requests that
 *  share no key — so the electorate never travels linked to the answer vector (de-identify before
 *  upload). The URLs and the outbound field allowlist / no-store transport are
 *  single-sourced in ./research/transport-policy. */
/** Issues the short-lived, single-use signed submission tokens. Called AFTER the
 *  client's age + consent gates; returns one token per unlinkable request (research + geography). */
const TOKEN_ENDPOINT = RESEARCH_ENDPOINTS.token;

/** The AEC timetable boundaries the server needs to classify the collection context. All
 *  public build-time facts from the election registry — never personal data. Sent so the SERVER can
 *  classify against its own trusted clock rather than trusting the client's; a null trio ⇒ unknown. */
export type ResearchTimetable = {
  declarationOfNominations: string;
  pollsCloseAt: string;
  returnOfWrits: string;
} | null;

/** Client-derived reading of one answered proposition: points 4/5 → agree, 3 → neutral,
 *  1/2 → disagree. Skips (0) are omitted from the payload entirely. */
export type Stance = "agree" | "neutral" | "disagree";

export function stanceOf(points: number): Stance | null {
  if (points === 4 || points === 5) return "agree";
  if (points === 3) return "neutral";
  if (points === 1 || points === 2) return "disagree";
  return null;
}

/**
 * Research payload, schemaVersion 1 (ADR-0008). The research schema is v1: the server accepts only
 * THIS shape, and any other payload also fails field validation (no `match`, no `propositions`).
 *
 * The raw answer vector and importance weights NEVER leave the device: the client derives the
 * top-party match (engine `topPartyMatch`, the same scoring the card shows) and a stance per
 * answered proposition, and the server only ever increments aggregate counters from these. No
 * per-person record exists anywhere at rest.
 */
export type ResearchPayload = {
  schemaVersion: 1;
  /** Election the answers were given for (e.g. "2025"), from the election store. */
  electionId: string;
  /** The election's AEC timetable boundaries, so the server can classify collection context. */
  timetable: ResearchTimetable;
  state: string | null;
  /** Top-party match key derived on device, or null when nothing scored (all skips). */
  match: string | null;
  /** One stance per ANSWERED proposition; skipped propositions are absent. */
  propositions: { id: number; stance: Stance }[];
  demographics: Record<string, string>;
  dataVersion: string;
  appVersion: string;
  /** Version of the consent text the participant agreed to (RESEARCH_CONSENT_VERSION). */
  consentVersion: string;
  /** Short-lived single-use signed submission token. Present when the integrity layer
   *  is provisioned server-side; omitted otherwise (the server then accepts on registry validation +
   *  edge rate-limit alone). */
  token?: string;
};

/** A geography tally ping: election + electorate only, nothing else — no results, no demographics,
 *  no state, no date. Sent as its own request, designed not to be linkable to anything else. */
export type GeographyPayload = {
  schemaVersion: 1;
  electionId: string;
  electorate: string;
  /** A SEPARATE submission token from the detailed record's (its own nonce), so the two requests
   *  stay unlinkable while both being integrity-gated. */
  token?: string;
};

/** The tokens the issue endpoint returns: one per unlinkable request. */
export type ResearchTokens = { research: string; geography: string };

/**
 * Request the short-lived, single-use signed submission tokens. MUST be called only after the client's
 * age + consent gates. Returns the tokens when the server's integrity layer is provisioned, or `null`
 * when it is not (the server then validates on the registry + edge rate-limit alone) or on any error —
 * research is optional and must never block the card.
 *
 * @param challenge - optional anti-abuse challenge solution (e.g. a Turnstile token), when configured.
 */
export async function requestResearchToken(
  electionId: string,
  challenge?: string,
): Promise<ResearchTokens | null> {
  try {
    // Routed through the transport policy: no-store, no credentials, allowlisted fields only.
    const res = await fetch(
      TOKEN_ENDPOINT,
      transportInit("token", {
        schemaVersion: RESEARCH_SCHEMA_VERSION,
        electionId,
        consentVersion: RESEARCH_CONSENT_VERSION,
        challenge: challenge ?? null,
      }),
    );
    if (!res.ok) return null; // 204 (inert) or 4xx (rejected) → proceed without a token
    const body = (await res.json()) as { tokens?: ResearchTokens };
    const t = body.tokens;
    return t && typeof t.research === "string" && typeof t.geography === "string" ? t : null;
  } catch {
    return null;
  }
}

async function post(endpoint: "research" | "geography", payload: unknown): Promise<void> {
  try {
    // transportInit enforces the in-transit policy: no-store, no credentials, and a
    // fail-closed field allowlist so only the device-derived record — never the raw answer vector or
    // the electorate — can reach the wire.
    await fetch(RESEARCH_ENDPOINTS[endpoint], transportInit(endpoint, payload));
  } catch {
    // Deliberately ignored — research is optional and must never affect the card.
  }
}

/**
 * Posts the detailed research record (answer vector + demographics + state, NO electorate)
 * fire-and-forget. Called ONLY after an explicit opt-in consent + 18+ confirmation on the survey
 * screen — never automatically, never on skip, never on tab-close. Never throws and never blocks
 * the card.
 */
export async function submitResearch(payload: ResearchPayload): Promise<void> {
  await post("research", payload);
}

/**
 * Posts the electorate tally as a SEPARATE, unlinkable request. Same opt-in gate as the
 * Views record; skipped when there is no electorate. Fire-and-forget.
 */
export async function submitGeography(payload: GeographyPayload): Promise<void> {
  await post("geography", payload);
}
