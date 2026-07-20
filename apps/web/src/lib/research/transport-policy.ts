/**
 * Research transport policy — the SINGLE, enforceable source of the in-transit invariants for the
 * research ingestion path (PIA §5/§6, threat-model T6).
 *
 * The research contribution is the one moment a device-derived profile exists off-device: for the
 * milliseconds of a single `POST`. This module encodes, as executable invariants, exactly how that
 * request may travel — so a caller cannot accidentally weaken it:
 *
 *  - TLS-ONLY: contributions travel only over an encrypted origin. The endpoints are same-origin
 *    relative paths, so the request inherits the page's HTTPS origin; the edge additionally forces
 *    HTTPS + HSTS (see infra/providers/cloudflare/transport-policy.json, deploy-verified).
 *  - NO-STORE: every request is issued with `cache: "no-store"` and `credentials: "omit"` — nothing
 *    about a contribution is cached, and no cookie or credential is ever attached.
 *  - FIELD ALLOWLIST: only an explicit set of fields is ever put on the wire, per endpoint. The
 *    projection is FAIL-CLOSED — any key not on the allowlist is dropped before serialisation, so a
 *    future caller that adds a field cannot leak it. Critically (accurate wording): the raw answer
 *    labels/weights are NOT transmitted — only the DEVICE-DERIVED per-proposition STANCE (and the
 *    top-party match) are — and each proposition is itself projected to `{id, stance}` so a stray raw
 *    label/weight on a proposition object is stripped too.
 *  - NO IP/UA READ, NO BODY/URL LOGGING: the server never reads `CF-Connecting-IP`, the user agent or
 *    any forwarding header, and never logs the request body or full URL. Those are server-side
 *    invariants of the Pages Functions; they are declared here (FORBIDDEN_REQUEST_READS) and enforced
 *    by the static scan in scripts/check-research-transport.mjs and the no-log invariant of the
 *    endpoints themselves.
 *
 * This is a LEAF module (it imports only ./consent, itself a leaf), so it can be pulled into the
 * browser bundle for the outbound projection. The server-side invariants are documented and statically
 * enforced rather than imported, because the Pages Functions must not depend on app-only code paths.
 */

import { RESEARCH_SCHEMA_VERSION } from "./consent";

/** The three same-origin research ingestion routes. Relative, so they stay within `connect-src 'self'`
 *  and inherit the page's (HTTPS, in production) origin. */
export const RESEARCH_ENDPOINTS = {
  research: "/api/research",
  geography: "/api/research/geography",
  token: "/api/research/token",
} as const;

export type ResearchEndpointName = keyof typeof RESEARCH_ENDPOINTS;

/**
 * The exact set of TOP-LEVEL fields permitted on the wire for each endpoint — the executable form of
 * the payload contracts in survey.ts (ResearchPayload / GeographyPayload / the token request). Any key
 * not listed here is dropped by projectAllowlisted() before the body is serialised (fail-closed).
 *
 * Note what is deliberately ABSENT from `research`: `answers`, `points`, `important`/weights (the raw
 * vector never leaves the device), `electorate` (split onto the separate geography request), and any
 * identifier. `propositions` carries only the device-derived stances, projected to `{id, stance}`.
 */
export const TRANSMITTABLE_FIELDS: Record<ResearchEndpointName, readonly string[]> = {
  research: [
    "schemaVersion",
    "electionId",
    "timetable",
    "state",
    "match",
    "propositions",
    "demographics",
    "dataVersion",
    "appVersion",
    "consentVersion",
    "token",
  ],
  geography: ["schemaVersion", "electionId", "electorate", "token"],
  token: ["schemaVersion", "electionId", "consentVersion", "challenge"],
} as const;

/** Each transmitted proposition is projected to exactly these keys — the device-derived stance, never
 *  a raw answer label, points value or importance weight. */
export const TRANSMITTABLE_PROPOSITION_FIELDS = ["id", "stance"] as const;

/**
 * Request attributes the ingestion path must NEVER read or log. Declared here as the single source and
 * enforced by the static scan (scripts/check-research-transport.mjs) over the ingestion Functions and
 * the client transport, and mirrored by the infra edge policy (no request-body logging at the edge).
 */
export const FORBIDDEN_REQUEST_READS = [
  "CF-Connecting-IP",
  "X-Forwarded-For",
  "X-Real-IP",
  "True-Client-IP",
  "User-Agent",
] as const;

/**
 * The transport invariants, frozen. `verifyTransportInit()` and the guards assert these values so the
 * policy cannot be silently weakened.
 */
export const RESEARCH_TRANSPORT_POLICY = Object.freeze({
  schemaVersion: RESEARCH_SCHEMA_VERSION,
  /** Contributions travel only over an encrypted origin (edge-forced HTTPS + HSTS). */
  tlsOnly: true,
  /** Fetch cache mode — nothing about a contribution is cached. */
  cache: "no-store",
  /** No cookie or credential is ever attached to a research request. */
  credentials: "omit",
  /** The response is a uniform 204 with no body; requests are fire-and-forget. */
  method: "POST",
  contentType: "application/json",
} as const);

/**
 * Project an outbound payload down to only the allowlisted top-level fields for its endpoint, dropping
 * `undefined` values and (for the detailed record) projecting each proposition to `{id, stance}`.
 * FAIL-CLOSED: a key absent from the allowlist is never copied, so it can never reach the wire.
 */
export function projectAllowlisted(
  endpoint: ResearchEndpointName,
  payload: unknown,
): Record<string, unknown> {
  const allow = TRANSMITTABLE_FIELDS[endpoint];
  const out: Record<string, unknown> = {};
  if (typeof payload !== "object" || payload === null) return out;
  const p = payload as Record<string, unknown>;
  for (const key of allow) {
    if (!(key in p)) continue;
    const value = p[key];
    if (value === undefined) continue;
    if (key === "propositions" && Array.isArray(value)) {
      out[key] = value.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        const projected: Record<string, unknown> = {};
        for (const f of TRANSMITTABLE_PROPOSITION_FIELDS) {
          if (f in e) projected[f] = e[f];
        }
        return projected;
      });
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The RequestInit every research POST must use: no-store, no credentials, JSON body containing ONLY
 * the allowlisted projection of `payload`. Centralising this means no caller can issue a research
 * request that caches, attaches a credential, or carries a non-allowlisted field.
 */
export function transportInit(endpoint: ResearchEndpointName, payload: unknown): RequestInit {
  return {
    method: RESEARCH_TRANSPORT_POLICY.method,
    headers: { "content-type": RESEARCH_TRANSPORT_POLICY.contentType },
    body: JSON.stringify(projectAllowlisted(endpoint, payload)),
    cache: RESEARCH_TRANSPORT_POLICY.cache,
    credentials: RESEARCH_TRANSPORT_POLICY.credentials,
    keepalive: true,
  };
}

/**
 * Assert a RequestInit honours the transport policy (used by the unit tests). Pure → `{ok, errors}`.
 */
export function verifyTransportInit(init: RequestInit | undefined): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!init || typeof init !== "object") {
    return { ok: false, errors: ["transport init: missing"] };
  }
  if (init.cache !== "no-store") errors.push('transport init: cache must be "no-store"');
  if (init.credentials !== "omit") errors.push('transport init: credentials must be "omit"');
  if (init.method !== "POST") errors.push("transport init: method must be POST");
  return { ok: errors.length === 0, errors };
}
