/**
 * Submission-token issuer — `POST /api/research/token` (Cloudflare Pages Function).
 * See registry.ts / token.ts.
 *
 * The client calls this ONLY after its age + consent gates, to obtain the short-lived, single-use
 * signed tokens the ingestion endpoints require. Before issuing, the server independently checks that:
 *   - the election is a VALID, OPEN election in the signed registry;
 *   - the schema version is current;
 *   - the consent version is one the server currently ACCEPTS (server-enforced consent — a
 *     stale/unknown/future consent version is refused here, so a client on old wording cannot obtain a
 *     token at all);
 *   - the anti-abuse challenge (the self-hosted ALTCHA proof-of-work) passes when configured.
 *
 * It returns TWO tokens — one per unlinkable request (the detailed record and the electorate ping) —
 * each with its own nonce, so consuming them cannot relink the two. Tokens are minted only when a
 * signing secret is configured; otherwise the endpoint is inert (204) and the ingestion endpoints
 * accept on registry validation + the edge rate-limit alone.
 *
 * This endpoint issues NO cookie, reads NO IP, and stores nothing about the request.
 */

import {
  RESEARCH_SCHEMA_VERSION,
  TOKEN_TTL_SECONDS,
  isAcceptedConsentVersion,
} from "../../../src/lib/research/consent";
import { isElectionOpen } from "../../../src/lib/research/registry";
import { newNonce, signToken, type TokenClaims } from "../../../src/lib/research/token";
import { resolveChallengeVerifier, type ChallengeEnv } from "../../../src/lib/research/challenge";
import { preflightResponse, withCors } from "../../../src/lib/research/cors";

/** ChallengeEnv carries ALTCHA_HMAC_SECRET, the single-use store bindings and the deployment
 *  marker read by isProductionDeployment(). In production the anti-abuse challenge fails closed:
 *  with the challenge layer unprovisioned, resolveChallengeVerifier returns a DenyAll verifier
 *  instead of a pass-through, so no token is minted without a challenge. */
interface Env extends ChallengeEnv {
  RESEARCH_TOKEN_SECRET?: string;
}
type PagesFunction<E> = (context: { request: Request; env: E }) => Response | Promise<Response>;

const MAX_BODY_BYTES = 4 * 1024;

const noContent = (): Response => new Response(null, { status: 204 });
const refused = (): Response => new Response(null, { status: 403 });

// Preflight for the native shells' cross-origin POST (strict allowlist; see cors.ts). The token
// response body must be readable cross-origin, so its 200 (and every refusal) carries the same
// strict ACAO via the wrapper below.
export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  preflightResponse(request);

export const onRequestPost: PagesFunction<Env> = async (ctx) =>
  withCors(await handlePost(ctx), ctx.request);

const handlePost: PagesFunction<Env> = async ({ request, env }) => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return refused();

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return refused();
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return refused();
    body = parsed as Record<string, unknown>;
  } catch {
    return refused();
  }

  const electionId = typeof body.electionId === "string" ? body.electionId : "";
  const schemaVersion = body.schemaVersion;
  const consentVersion = typeof body.consentVersion === "string" ? body.consentVersion : "";
  const challenge = typeof body.challenge === "string" ? body.challenge : null;

  // Server-enforced gates (independent of the client): registry, schema, accepted consent version.
  if (!isElectionOpen(electionId)) return refused();
  if (schemaVersion !== RESEARCH_SCHEMA_VERSION) return refused();
  if (!isAcceptedConsentVersion(consentVersion)) return refused();

  // Anti-abuse challenge (self-hosted ALTCHA proof-of-work, single-use). In non-production it is
  // inert unless the challenge secret is configured; in PRODUCTION it fails closed — with the
  // challenge layer unprovisioned the resolver returns a DenyAll verifier, so a token is never
  // minted without a challenge.
  const verifier = resolveChallengeVerifier(env, "research");
  if (!(await verifier.verify(challenge))) return refused();

  // Integrity layer not provisioned → inert. The ingestion endpoints then stand on registry
  // validation + the edge rate-limit, and this endpoint mints nothing.
  const secret = env.RESEARCH_TOKEN_SECRET;
  if (!secret) return noContent();

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const base = {
    electionId,
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    // Bind to the consent version the client asserted — already verified above to be one the server
    // ACCEPTS (not stale/unknown/future), and the value the contribution will carry, so the ingestion
    // endpoint's token↔contribution consent match holds even across a multi-version transition window.
    consentVersion,
    issuedAt: now,
    expiresAt,
  } satisfies Omit<TokenClaims, "purpose" | "nonce">;

  const [research, geography] = await Promise.all([
    signToken({ ...base, purpose: "research", nonce: newNonce() }, secret),
    signToken({ ...base, purpose: "geography", nonce: newNonce() }, secret),
  ]);

  return new Response(JSON.stringify({ tokens: { research, geography }, expiresAt }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
