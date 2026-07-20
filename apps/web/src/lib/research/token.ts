/**
 * Short-lived, single-use SIGNED research submission token.
 *
 * The token is issued by `/api/research/token` ONLY after the client's age + consent gates and a
 * passing anti-abuse challenge, and must accompany every research / geography contribution. It is a
 * compact `<payload>.<signature>` string, HMAC-SHA256 signed with a server-only secret
 * (`RESEARCH_TOKEN_SECRET`, never in the repo). The signature makes it unforgeable; the embedded
 * `expiresAt` makes it short-lived; the embedded random `nonce` makes it single-use (the ingestion
 * endpoint consumes the nonce exactly once via a payload-free store); and the embedded
 * `electionId` / `schemaVersion` / `consentVersion` / `purpose` BIND it so a token minted for one
 * election/consent version/endpoint cannot be replayed against another.
 *
 * Everything here is pure and runtime-agnostic (WebCrypto only) so it runs identically in the Worker
 * and under vitest. No PII is ever placed in a token — only the binding facts above and two
 * timestamps.
 */

/** What a submission token authorises. Separate purposes keep the detailed-record request and the
 *  electorate ping UNLINKABLE: each carries its own token with its own nonce. */
export type TokenPurpose = "research" | "geography";

/** The signed claims. All are non-sensitive binding facts + timestamps (epoch seconds). */
export interface TokenClaims {
  electionId: string;
  schemaVersion: number;
  consentVersion: string;
  purpose: TokenPurpose;
  /** Random, single-use — consumed exactly once by the ingestion endpoint. */
  nonce: string;
  /** Epoch seconds the token was issued. */
  issuedAt: number;
  /** Epoch seconds the token stops being valid. */
  expiresAt: number;
}

/** Why a token was rejected — surfaced to tests and (as a coarse label) to anomaly metrics. */
export type TokenRejection =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "not-yet-valid"
  | "election-mismatch"
  | "schema-mismatch"
  | "consent-mismatch"
  | "purpose-mismatch";

export type VerifyResult =
  { ok: true; claims: TokenClaims } | { ok: false; reason: TokenRejection };

/** Small clock-skew tolerance (seconds) for the not-yet-valid check across the issuer/verifier. */
const CLOCK_SKEW_SECONDS = 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(text: string): Uint8Array {
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

/** Constant-time comparison of two byte arrays (avoids leaking the signature via timing). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A cryptographically-random nonce (single-use marker). */
export function newNonce(): string {
  return crypto.randomUUID();
}

/** Sign a set of claims into a `<payload>.<signature>` token. */
export async function signToken(claims: TokenClaims, secret: string): Promise<string> {
  if (!secret) throw new Error("signToken: a signing secret is required");
  const payload = base64urlEncode(encoder.encode(JSON.stringify(claims)));
  const signature = base64urlEncode(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

function isTokenClaims(value: unknown): value is TokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.electionId === "string" &&
    typeof c.schemaVersion === "number" &&
    typeof c.consentVersion === "string" &&
    (c.purpose === "research" || c.purpose === "geography") &&
    typeof c.nonce === "string" &&
    c.nonce.length > 0 &&
    typeof c.issuedAt === "number" &&
    Number.isFinite(c.issuedAt) &&
    typeof c.expiresAt === "number" &&
    Number.isFinite(c.expiresAt)
  );
}

/** What the verifier requires the token to be bound to. `consentVersion` is checked only when
 *  supplied (the geography ping carries no consent, so it binds election/schema/purpose only). */
export interface TokenExpectations {
  electionId: string;
  schemaVersion: number;
  purpose: TokenPurpose;
  consentVersion?: string;
  /** Epoch seconds; defaults to now. Injectable for deterministic tests. */
  nowSeconds?: number;
}

/**
 * Verify a token: signature, expiry, not-yet-valid, then the binding facts. Returns the decoded
 * claims on success (the caller still consumes the nonce for single-use), or a rejection reason.
 * Never throws.
 */
export async function verifyToken(
  token: unknown,
  secret: string,
  expect: TokenExpectations,
): Promise<VerifyResult> {
  if (!secret || typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: "malformed" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1 || token.indexOf(".", dot + 1) !== -1) {
    return { ok: false, reason: "malformed" };
  }
  const payload = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let expectedSig: Uint8Array;
  let provided: Uint8Array;
  try {
    expectedSig = await hmac(secret, payload);
    provided = base64urlDecode(providedSig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(provided, expectedSig)) return { ok: false, reason: "bad-signature" };

  let claims: unknown;
  try {
    claims = JSON.parse(decoder.decode(base64urlDecode(payload)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isTokenClaims(claims)) return { ok: false, reason: "malformed" };

  const now = expect.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.issuedAt > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "not-yet-valid" };
  if (claims.expiresAt <= now) return { ok: false, reason: "expired" };

  if (claims.purpose !== expect.purpose) return { ok: false, reason: "purpose-mismatch" };
  if (claims.electionId !== expect.electionId) return { ok: false, reason: "election-mismatch" };
  if (claims.schemaVersion !== expect.schemaVersion)
    return { ok: false, reason: "schema-mismatch" };
  if (expect.consentVersion !== undefined && claims.consentVersion !== expect.consentVersion) {
    return { ok: false, reason: "consent-mismatch" };
  }

  return { ok: true, claims };
}
