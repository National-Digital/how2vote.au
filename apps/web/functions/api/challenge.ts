/**
 * Anti-abuse challenge issuer — `POST /api/challenge` (Cloudflare Pages Function).
 *
 * Issues the self-hosted ALTCHA proof-of-work challenge the client solves before submitting to the
 * research token endpoint or the forms endpoint (see src/lib/research/challenge.ts for the whole
 * mechanism). ONE issuer serves every channel (web, iOS, Android, F-Droid) and every purpose — the
 * purpose is signed into the challenge, so a solution can only be spent where it was issued for.
 *
 * Issuance is deliberately cheap for the server (randomness + one HMAC — no key derivation; the
 * solver pays the derivation cost), sits behind the same edge rate-limit + Bot Fight Mode as the
 * other /api routes, and is stateless: nothing about the request is read beyond the body, no cookie
 * is issued, no IP is read, nothing is stored (the challenge is self-contained and HMAC-signed).
 *
 * When no HMAC secret is provisioned the endpoint is inert (204): the client then submits without a
 * challenge, and the receiving endpoint's verifier decides (inert pass-through in non-production;
 * fail-closed refusal in production).
 */

import {
  CHALLENGE_PURPOSES,
  issueChallenge,
  type ChallengePurpose,
} from "../../src/lib/research/challenge";

interface Env {
  ALTCHA_HMAC_SECRET?: string;
}
type PagesFunction<E> = (context: { request: Request; env: E }) => Response | Promise<Response>;

const MAX_BODY_BYTES = 1024;

const noContent = (): Response => new Response(null, { status: 204 });
const refused = (): Response => new Response(null, { status: 403 });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return refused();

  let purpose: ChallengePurpose;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return refused();
    const parsed: unknown = JSON.parse(text);
    const candidate =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).purpose
        : undefined;
    if (!CHALLENGE_PURPOSES.includes(candidate as ChallengePurpose)) return refused();
    purpose = candidate as ChallengePurpose;
  } catch {
    return refused();
  }

  // Challenge layer not provisioned → inert. The receiving endpoint's verifier then decides
  // (pass-through in non-production, refusal in production).
  const secret = env.ALTCHA_HMAC_SECRET;
  if (!secret) return noContent();

  const challenge = await issueChallenge(purpose, secret);
  return new Response(JSON.stringify({ challenge }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
