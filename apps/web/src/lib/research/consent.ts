/**
 * Centralised research collection versioning — the SINGLE source of truth for the research payload
 * schema version and the consent-notice version, read by BOTH the client (survey.ts) and the
 * server-side Pages Functions (functions/api/research*). Centralising these here means the UI, the
 * ingestion validator and the submission-token binding can never disagree about which schema/consent
 * version is current.
 *
 * This module is a LEAF — it imports nothing, so it can be pulled into the Cloudflare Pages Function
 * bundle and the browser bundle alike without dragging in app-only dependencies.
 */

/** Current research payload schema (survey.ts ResearchPayload / GeographyPayload). The research
 *  schema is v1; a client on any other number is dropped. */
export const RESEARCH_SCHEMA_VERSION = 1;

/**
 * Version of the research consent text + collection notice a participant agrees to. Recorded in
 * aggregate (`consent_count`) so we can show exactly what was consented to. Bump on any
 * material change to the consent wording or the collection notice. This is the ONE place the value
 * is defined; survey.ts re-exports it for backward-compatible imports.
 */
export const RESEARCH_CONSENT_VERSION = "2026-07.2";

/**
 * The consent-notice versions the server still ACCEPTS a contribution under, newest first. Today
 * only the current version is accepted; if a future bump keeps older wording valid for a transition
 * window, add it here. A contribution whose consent version is not in this set is dropped — this is
 * how the server rejects STALE (retired), UNKNOWN (never issued) and FUTURE (not-yet-published)
 * consent versions. Keep newest-first so `[0]` is the current version.
 */
export const ACCEPTED_CONSENT_VERSIONS: readonly string[] = [RESEARCH_CONSENT_VERSION];

/** The three client-derived proposition stances (survey.ts). Centralised so the client, the
 *  ingestion validator and the registry share one list. */
export const STANCES = ["agree", "neutral", "disagree"] as const;

/** How long an issued submission token is valid (seconds). Short-lived: it need only survive the
 *  moment between the consent gate and the fire-and-forget submit. Also bounds how long the spent
 *  nonce is retained. */
export const TOKEN_TTL_SECONDS = 300;

/** Consent-version tag shape: `YYYY-MM` with an optional `.N` minor, e.g. `2026-07` or `2026-07.2`. */
const CONSENT_VERSION_SHAPE = /^(\d{4})-(\d{2})(?:\.(\d+))?$/;

/** How the server classifies an incoming consent version relative to the accepted set. */
export type ConsentVerdict = "accepted" | "stale" | "unknown" | "future" | "malformed";

/** Parse a consent version into a comparable [year, month, minor] tuple, or null if malformed. */
function parseConsentVersion(v: string): [number, number, number] | null {
  const m = CONSENT_VERSION_SHAPE.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])];
}

/** Order two parsed consent versions (lexicographic over year, month, minor). */
function compareConsentVersion(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Classify a client-supplied consent version. A malformed or non-string value is `"malformed"`; an
 * accepted version is `"accepted"`; otherwise it is compared against the newest accepted version and
 * reported as `"future"` (newer than anything we have published — a forgery/anomaly signal) or
 * `"stale"` (older than the newest accepted version). A well-formed value that is neither is
 * `"unknown"`. Only `"accepted"` should ever be stored.
 */
export function classifyConsentVersion(v: unknown): ConsentVerdict {
  if (typeof v !== "string") return "malformed";
  const parsed = parseConsentVersion(v);
  if (parsed === null) return "malformed";
  if (ACCEPTED_CONSENT_VERSIONS.includes(v)) return "accepted";

  const acceptedParsed = ACCEPTED_CONSENT_VERSIONS.map(parseConsentVersion).filter(
    (p): p is [number, number, number] => p !== null,
  );
  if (acceptedParsed.length === 0) return "unknown";
  const newest = acceptedParsed.reduce((max, p) => (compareConsentVersion(p, max) > 0 ? p : max));
  if (compareConsentVersion(parsed, newest) > 0) return "future";
  return "stale";
}

/** Convenience: is this consent version one the server will store a contribution under? */
export function isAcceptedConsentVersion(v: unknown): boolean {
  return classifyConsentVersion(v) === "accepted";
}
