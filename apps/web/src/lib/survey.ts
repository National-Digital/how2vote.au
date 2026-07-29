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
 * two in step. The question set and the option allowlist live in ./survey-questions (a leaf module
 * the ingestion Function imports directly, re-exported here) so the client and server can never
 * drift.
 *
 * The research SCHEMA and CONSENT versions live in ./research/consent.ts (the single source both the
 * client and the server read); this file re-exports RESEARCH_CONSENT_VERSION for its existing callers.
 */
import { RESEARCH_CONSENT_VERSION, RESEARCH_SCHEMA_VERSION } from "./research/consent";
import { researchEndpointUrl, transportInit } from "./research/transport-policy";
import { isNativeShell } from "./channel";
import { SITE_URL } from "./seo";

// Native shells serve the app from a local WebView origin, so research POSTs must target the
// canonical origin (the endpoints allow the shell origins by strict CORS allowlist); the web PWA
// uses same-origin relative paths. Nothing else about the request changes.
const RESEARCH_ORIGIN = isNativeShell ? SITE_URL : "";

export { RESEARCH_CONSENT_VERSION } from "./research/consent";

// The question set and its derived allowlists live in ./survey-questions — a LEAF module the
// Pages Functions can bundle (this file's transport half imports browser-only modules like
// ./channel, which the Functions bundler cannot resolve). Re-exported here so the client keeps a
// single import surface.
export {
  DEMOGRAPHIC_OPTIONS,
  SENSITIVE_DIMENSIONS,
  SURVEY,
  surveyFor,
  type SurveyAnswers,
  type SurveyQuestion,
} from "./survey-questions";

/** Same-origin research ingestion endpoints (Pages Functions). Relative, so they need no env var and
 *  stay within `connect-src 'self'`. A 404 (Functions not deployed) is swallowed below. The detailed
 *  Views record and the electorate tally go to SEPARATE endpoints as two independent requests that
 *  share no key — so the electorate never travels linked to the answer vector (de-identify before
 *  upload). The URLs and the outbound field allowlist / no-store transport are
 *  single-sourced in ./research/transport-policy. */
/** Issues the short-lived, single-use signed submission tokens. Called AFTER the
 *  client's age + consent gates; returns one token per unlinkable request (research + geography). */
const TOKEN_ENDPOINT = researchEndpointUrl("token", RESEARCH_ORIGIN);

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
 * @param challenge - optional anti-abuse challenge solution (the solved self-hosted proof-of-work
 *   payload from $lib/altcha), when the challenge layer is provisioned.
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
    await fetch(researchEndpointUrl(endpoint, RESEARCH_ORIGIN), transportInit(endpoint, payload));
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
