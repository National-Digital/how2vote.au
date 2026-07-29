/**
 * Self-hosted anti-abuse challenge — ALTCHA v2 proof-of-work, verified entirely in-process.
 *
 * Poisoning / scripted-submission prevention has one live layer at the Cloudflare edge today: a
 * per-IP rate limit covering the POST /api/* routes (see the survey-abuse-controls record). There is
 * no managed bot-detection service in front of it, so that rule caps volume and this module prices
 * each submission; neither substitutes for the other.
 *
 * This module is the swappable in-app challenge layer used at token-issue time (and by the
 * self-hosted forms endpoint). The challenge is issued and verified by OUR OWN Pages Functions
 * using the open ALTCHA protocol (altcha-lib, MIT), so no third-party JavaScript, iframe or
 * verification call exists anywhere on the submission path (ADR-0017).
 *
 * How it works (one mechanism for EVERY channel — web, iOS, Android, F-Droid; never diverge it per
 * channel, because the verifier is server-side and one endpoint serves every client, so a weaker
 * challenge for one build would be weaker for all):
 *   1. `POST /api/challenge` issues an HMAC-signed challenge (functions/api/challenge.ts →
 *      issueChallenge below): random nonce + salt, a PBKDF2/SHA-256 cost, a short expiry and the
 *      signed `purpose` the solution may be spent on. Issuance derives no key — it is just
 *      randomness plus one HMAC, so it is far cheaper for the server than for the solver.
 *   2. The client brute-forces the counter until the derived key matches the required prefix
 *      (sub-second on a phone; runs only on submit, never on page load) and returns the
 *      base64-encoded `{challenge, solution}` payload as the `challenge` field.
 *   3. `AltchaVerifier` checks expiry + signature + re-derives the key ONCE, then burns the
 *      challenge nonce in the single-use nonce store so a solved challenge cannot be replayed.
 *
 * Privacy note: verification is pure computation in this process — no request to any provider, so
 * there is nowhere for a visitor's IP to be sent, consistent with the no-IP-storage promise.
 */

import { createChallenge, verifySolution } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/web/pbkdf2";
import type { Challenge, Payload } from "altcha-lib/types";
import { isProductionDeployment, type DeploymentEnv } from "./environment";
import {
  D1NonceStore,
  KvNonceStore,
  type D1NonceDatabase,
  type KVNamespace,
  type NonceStore,
} from "./nonce-store";

/** The one challenge shape this server issues and accepts (see the module comment). */
export const CHALLENGE_ALGORITHM = "PBKDF2/SHA-256";
/** PBKDF2 iterations per counter attempt. With the 1-byte key prefix (256 expected attempts, the
 *  altcha-lib default) the expected client work is ~2.6M iterations — about a second of WebCrypto
 *  in the background on a phone, imperceptible behind the submit state — while the server
 *  re-derives exactly once (~10k iterations) to verify. Raising this raises an attacker's cost
 *  linearly; it is the difficulty dial, tuned as high as stays invisible for a legitimate user. */
export const CHALLENGE_COST = 10_000;
/** Derived-key length in bytes (the altcha-lib default, pinned so the accepted shape is explicit). */
export const CHALLENGE_KEY_LENGTH = 32;
/** The required derived-key prefix — the actual proof-of-work target. A 1-byte ("00") prefix means
 *  ~256 expected derivations to solve. CRITICAL: altcha-lib's verifySolution does NOT check the
 *  prefix (it only re-derives the submitted counter and compares to the submitted key, both
 *  attacker-controlled), so the verifier below MUST enforce this itself — otherwise counter=0 with
 *  its honestly-derived key passes with zero work done. Pinned here and asserted at both issue and
 *  verify time so a challenge can never be minted or accepted at an easier difficulty. */
export const CHALLENGE_KEY_PREFIX = "00";
/** Largest counter the solver can submit (big-endian uint32, per the ALTCHA v2 protocol). Anything
 *  outside [0, 2^32) is not a value the solver could have produced, so reject it before deriving. */
const MAX_COUNTER = 0xffffffff;
/** Challenge validity window. Issued at submit time and solved within seconds; the window allows
 *  slow devices and a retry without letting a solved challenge live long. Also bounds how long the
 *  spent-nonce marker must be retained. */
export const CHALLENGE_TTL_SECONDS = 10 * 60;

/** What a solution may be spent on. The purpose is SIGNED into the challenge and checked by the
 *  verifier, so a challenge issued for one path can never be spent on another. These are payload
 *  purposes, not channels — every channel uses the identical mechanism and difficulty. */
export const CHALLENGE_PURPOSES = ["research", "contact", "feedback"] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

/** Reject grossly oversized `challenge` strings before base64/JSON work. A genuine payload is well
 *  under 2 KB. */
const MAX_SOLUTION_LENGTH = 8 * 1024;

/** Namespaces the burned challenge nonces inside the shared single-use store, so they can never
 *  collide with the submission-token nonces the ingestion endpoints burn in the same store. */
const NONCE_KEY_PREFIX = "altcha:";

/**
 * Issue a signed challenge for a purpose. Used by `POST /api/challenge` (and by tests). The expiry
 * is embedded in the signed parameters, so the verifier needs no clock state of its own.
 */
export function issueChallenge(purpose: ChallengePurpose, secret: string): Promise<Challenge> {
  return createChallenge({
    algorithm: CHALLENGE_ALGORITHM,
    cost: CHALLENGE_COST,
    keyLength: CHALLENGE_KEY_LENGTH,
    keyPrefix: CHALLENGE_KEY_PREFIX,
    deriveKey,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1_000),
    data: { purpose },
    hmacSignatureSecret: secret,
  });
}

/** Verifies an anti-abuse challenge solution. */
export interface ChallengeVerifier {
  /** Resolve true when the solution is valid (or when no challenge is configured). */
  verify(solution: string | null): Promise<boolean>;
  /** Whether a challenge is actually enforced (false = inert pass-through). */
  readonly enforced: boolean;
}

/** No challenge configured: pass through. The edge rate limit remains the only live defence.
 *  Used in NON-PRODUCTION only — see DenyAllVerifier for the production fail-closed counterpart. */
export class AllowAllVerifier implements ChallengeVerifier {
  readonly enforced = false;
  async verify(): Promise<boolean> {
    return true;
  }
}

/** Production fail-closed stand-in when the challenge layer is not fully provisioned (no secret, or
 *  no ATOMIC single-use store to burn solved challenges in): reject everything rather than accept
 *  without a working anti-abuse challenge. Never falls back to a pass-through in production. */
export class DenyAllVerifier implements ChallengeVerifier {
  readonly enforced = true;
  async verify(): Promise<boolean> {
    return false;
  }
}

/** Parse and shape-check the base64 `{challenge, solution}` payload; null on any mismatch. */
function decodePayload(solution: string): Payload | null {
  if (solution.length > MAX_SOLUTION_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(solution));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const payload = parsed as Record<string, unknown>;
  const challenge = payload.challenge as Record<string, unknown> | undefined;
  const sol = payload.solution as Record<string, unknown> | undefined;
  if (
    typeof challenge !== "object" ||
    challenge === null ||
    typeof challenge.signature !== "string" ||
    typeof challenge.parameters !== "object" ||
    challenge.parameters === null ||
    typeof sol !== "object" ||
    sol === null ||
    typeof sol.counter !== "number" ||
    typeof sol.derivedKey !== "string"
  ) {
    return null;
  }
  return payload as unknown as Payload;
}

/**
 * ALTCHA proof-of-work verification — self-hosted, in-process, single-use.
 *
 * Accepts ONLY the exact shape this server issues (algorithm/cost/keyLength pinned, expiry present,
 * purpose matching) — the HMAC signature already proves WE issued the challenge, so these checks are
 * belt-and-braces against a future issuance drift. On a verified solution the challenge nonce is
 * atomically burned in the nonce store, so each issued challenge is spendable exactly once. A null
 * store skips the burn and is permitted in NON-PRODUCTION only (the resolver returns DenyAll rather
 * than an unburnable verifier in production).
 */
export class AltchaVerifier implements ChallengeVerifier {
  readonly enforced = true;
  constructor(
    private readonly secret: string,
    private readonly purpose: ChallengePurpose,
    private readonly nonces: NonceStore | null,
  ) {}

  async verify(solution: string | null): Promise<boolean> {
    if (!solution) return false;
    const payload = decodePayload(solution);
    if (!payload) return false;
    const { challenge, solution: sol } = payload;
    const p = challenge.parameters;
    // Pin the ENTIRE accepted shape, difficulty included. keyPrefix is the difficulty and MUST be
    // pinned here: it is signed, but nothing downstream checks it, so an easier-prefix challenge
    // would otherwise be accepted. (The HMAC signature, verified below, proves we issued these
    // values; these checks are belt-and-braces against a future issuance drift.)
    if (
      p.algorithm !== CHALLENGE_ALGORITHM ||
      p.cost !== CHALLENGE_COST ||
      p.keyLength !== CHALLENGE_KEY_LENGTH ||
      p.keyPrefix !== CHALLENGE_KEY_PREFIX ||
      typeof p.expiresAt !== "number" ||
      p.data?.purpose !== this.purpose
    ) {
      return false;
    }
    // The counter must be a value the solver could have produced — a big-endian uint32. Reject
    // NaN/float/negative/oversized before deriving (setUint32 would silently alias them onto another
    // counter otherwise).
    if (!Number.isInteger(sol.counter) || sol.counter < 0 || sol.counter > MAX_COUNTER) {
      return false;
    }
    try {
      // Checks, in order: expiry, the HMAC signature over the parameters (tamper check), then one
      // key re-derivation to prove the submitted key really is the derivation of the submitted
      // counter. No network.
      const result = await verifySolution({
        challenge,
        solution: sol,
        deriveKey,
        hmacSignatureSecret: this.secret,
      });
      if (!result.verified) return false;
      // CRITICAL — the actual proof-of-work. verifySolution proves derivedKey == derive(counter) but
      // NOT that it hits the target prefix, so without this check counter=0 with its honest key
      // passes having done zero search. derivedKey is lowercase hex and keyPrefix is even-length hex,
      // so the string-prefix test is equivalent to the byte-prefix test.
      if (!sol.derivedKey.startsWith(CHALLENGE_KEY_PREFIX)) return false;
      // Single-use: burn the (signed, random) challenge nonce. `consume` is true exactly once, so a
      // captured solved challenge cannot be replayed inside its validity window. Inside the try so a
      // store error fails CLOSED (reject) rather than escaping as an unhandled 500.
      if (!this.nonces) return true;
      const ttl = p.expiresAt - Math.floor(Date.now() / 1_000);
      return await this.nonces.consume(NONCE_KEY_PREFIX + p.nonce, ttl);
    } catch {
      // Fail closed on any malformed input the shape check above did not anticipate, or a store error.
      return false;
    }
  }
}

/** Env fields the resolver reads (a slice of the Pages Function Env). Includes the deployment-signal
 *  fields so the resolver can fail closed in production without a separate argument, and the
 *  single-use store bindings so a solved challenge can be burned. */
export interface ChallengeEnv extends DeploymentEnv {
  ALTCHA_HMAC_SECRET?: string;
  RESEARCH_NONCES?: KVNamespace;
  RESEARCH_NONCES_DB?: D1NonceDatabase;
}

/** The single-use store for burned challenges: the atomic D1 store when provisioned (REQUIRED in
 *  production), else the non-atomic KV fallback (non-production only), else null (local dev). The
 *  same selection the ingestion endpoints make for token nonces. */
function challengeNonceStore(env: ChallengeEnv): NonceStore | null {
  if (env.RESEARCH_NONCES_DB) return new D1NonceStore(env.RESEARCH_NONCES_DB);
  return env.RESEARCH_NONCES ? new KvNonceStore(env.RESEARCH_NONCES) : null;
}

/**
 * Pick the challenge verifier from the environment: ALTCHA when `ALTCHA_HMAC_SECRET` is set AND the
 * challenge can be made single-use (in production that requires the ATOMIC D1 nonce store — with
 * only the raceable KV store, or none, production fails closed to DenyAll rather than accept a
 * replayable challenge). When the secret is NOT set the fallback depends on the deployment: a
 * NON-PRODUCTION build gets an inert pass-through so preview/local works without provisioning; a
 * PRODUCTION deployment gets a DenyAll verifier — it must not accept without an anti-abuse
 * challenge (fail closed).
 *
 * @param purpose - what the solution is being spent on; must match the purpose signed at issuance.
 * @param failClosedWhenUnset - override the production decision (defaults to isProductionDeployment).
 *   The endpoints pass this explicitly so it stays in step with their own fail-closed posture.
 */
export function resolveChallengeVerifier(
  env: ChallengeEnv,
  purpose: ChallengePurpose,
  failClosedWhenUnset: boolean = isProductionDeployment(env),
): ChallengeVerifier {
  const production = isProductionDeployment(env);
  if (env.ALTCHA_HMAC_SECRET) {
    if (production && !env.RESEARCH_NONCES_DB) return new DenyAllVerifier();
    return new AltchaVerifier(env.ALTCHA_HMAC_SECRET, purpose, challengeNonceStore(env));
  }
  return failClosedWhenUnset ? new DenyAllVerifier() : new AllowAllVerifier();
}
