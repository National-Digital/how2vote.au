/**
 * Self-hosted contact/feedback intake — `POST /api/forms` (Cloudflare Pages Function).
 *
 * Replaces Formspree: both forms now post to OUR OWN origin, protected by the same self-hosted
 * ALTCHA proof-of-work challenge as the research path (src/lib/research/challenge.ts), and the
 * message is RELAYED as a transactional email to the project inbox via Cloudflare's Email Sending
 * REST API — this endpoint is a pure relay and STORES NOTHING (no database, no KV, no log of the
 * body), so the aggregate-only privacy posture is unchanged: the only place a message exists after
 * the response is the recipient mailbox, exactly as with any email.
 *
 * Privacy/transport invariants (mirrors the research ingestion path):
 *   - no cookie is issued, no IP or user agent is read, the body is never logged;
 *   - the ONLY outbound call is to api.cloudflare.com (the vendor registry's allowlisted egress
 *     host, enforced by scripts/check-vendor-registry.mjs);
 *   - the sender's email address is used solely as the Reply-To of the relayed mail (validated
 *     to a single header-safe token so it cannot inject headers), never stored here.
 *
 * Fail-closed posture (mirrors the token endpoint): in PRODUCTION the endpoint refuses (503) when
 * the challenge layer or the email relay is unprovisioned, and refuses (403) any submission whose
 * challenge does not verify. In NON-PRODUCTION it accepts inertly (204, nothing sent) when the
 * relay is unprovisioned, so local dev and previews work without secrets.
 */

import { resolveChallengeVerifier, type ChallengeEnv } from "../../src/lib/research/challenge";
import { isProductionDeployment } from "../../src/lib/research/environment";

interface Env extends ChallengeEnv {
  /** Cloudflare API token scoped to Email Sending only (a Cloudflare SECRET, never committed). */
  EMAIL_API_TOKEN?: string;
  /** Cloudflare account id the Email Sending API is called under (injected at deploy; the repo is
   *  public, so it is not committed even though it is not strictly secret). */
  EMAIL_ACCOUNT_ID?: string;
  /** Envelope sender for the relayed mail — an address on a domain onboarded to Email Sending. */
  FORMS_FROM_ADDRESS?: string;
  /** The project inbox the relayed mail is delivered to. */
  FORMS_DELIVERY_ADDRESS?: string;
}
type PagesFunction<E> = (context: { request: Request; env: E }) => Response | Promise<Response>;

const MAX_BODY_BYTES = 16 * 1024;
/** Field caps — generous for a human, hostile to a payload mule. */
const MAX_MESSAGE_LENGTH = 5_000;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_PAGE_LENGTH = 300;

const FORM_KINDS = ["contact", "feedback"] as const;
type FormKind = (typeof FORM_KINDS)[number];

const accepted = (): Response => new Response(null, { status: 204 });
const refused = (): Response => new Response(null, { status: 403 });
const invalid = (): Response => new Response(null, { status: 400 });
const serviceUnavailable = (): Response => new Response(null, { status: 503 });
const relayFailed = (): Response => new Response(null, { status: 502 });

/** One header-safe token with a single at-sign: enough to be a usable Reply-To, and impossible to
 *  smuggle a CR/LF or a second header through. Anything else is relayed inside the body text only. */
const REPLY_TO_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed string field, empty → undefined, hard-capped; null when present but not a string. */
function field(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? null : trimmed;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return invalid();

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return invalid();
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return invalid();
    body = parsed as Record<string, unknown>;
  } catch {
    return invalid();
  }

  const kind = body.kind as FormKind;
  if (!FORM_KINDS.includes(kind)) return invalid();
  const message = field(body.message, MAX_MESSAGE_LENGTH);
  const name = field(body.name, MAX_NAME_LENGTH);
  const email = field(body.email, MAX_EMAIL_LENGTH);
  const page = field(body.page, MAX_PAGE_LENGTH);
  if (!message || name === null || email === null || page === null) return invalid();

  const production = isProductionDeployment(env);

  // PRODUCTION fail-closed gate: never run the forms relay without the anti-abuse challenge and a
  // provisioned email relay — refuse (503) rather than silently dropping messages.
  if (production) {
    if (
      !env.ALTCHA_HMAC_SECRET ||
      !env.RESEARCH_NONCES_DB ||
      !env.EMAIL_API_TOKEN ||
      !env.EMAIL_ACCOUNT_ID ||
      !env.FORMS_FROM_ADDRESS ||
      !env.FORMS_DELIVERY_ADDRESS
    ) {
      return serviceUnavailable();
    }
  }

  // Anti-abuse challenge — the SAME self-hosted verifier as the research path, purpose-bound to
  // this form kind and single-use (the solved challenge is burned atomically).
  const challenge = typeof body.challenge === "string" ? body.challenge : null;
  const verifier = resolveChallengeVerifier(env, kind);
  if (!(await verifier.verify(challenge))) return refused();

  // Relay unprovisioned in NON-PRODUCTION → inert accept (nothing sent), so dev works secret-free.
  if (
    !env.EMAIL_API_TOKEN ||
    !env.EMAIL_ACCOUNT_ID ||
    !env.FORMS_FROM_ADDRESS ||
    !env.FORMS_DELIVERY_ADDRESS
  ) {
    return accepted();
  }

  // Compose a plain-text relay. User input appears ONLY in the body text (and, when it is a
  // header-safe address, as Reply-To) — the subject and addresses are ours.
  const lines = [
    `New ${kind} message via how2vote.au`,
    "",
    ...(name ? [`Name: ${name}`] : []),
    ...(email ? [`Email: ${email}`] : []),
    ...(page ? [`Page: ${page}`] : []),
    "",
    "Message:",
    message,
  ];
  const replyTo = email && REPLY_TO_PATTERN.test(email) ? email : undefined;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.EMAIL_ACCOUNT_ID}/email/sending/send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.EMAIL_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: { address: env.FORMS_FROM_ADDRESS, name: "how2vote.au forms" },
          to: [env.FORMS_DELIVERY_ADDRESS],
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject: `how2vote ${kind}`,
          text: lines.join("\n"),
        }),
      },
    );
    if (!res.ok) return relayFailed();
  } catch {
    // Relay unreachable: surface a retryable failure — never pretend a message was delivered.
    return relayFailed();
  }

  return accepted();
};
