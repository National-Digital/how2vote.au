/**
 * Geography tally endpoint — `POST /api/research/geography` (Cloudflare Pages Function).
 * See ADR-0006 (D2).
 *
 * The electorate is de-identified BEFORE upload by never travelling with the answer vector: the
 * detailed record goes to `/api/research`, and the electorate comes HERE on its own request that
 * shares no key with it. This endpoint accepts ONLY an election id + electorate and increments an
 * aggregate running tally (`geography_count`) — no answers, no demographics, no state, no date, no
 * per-person row, and nothing linking a tally back to a Views record. An incrementing integer, not a
 * second per-person row, is what breaks the linkage (see migration 0001).
 *
 * Like the Views endpoint it stores no identifier (CF-Connecting-IP is never read) and always replies
 * 204 with no body, so it reveals nothing and cannot be probed. The browser posts fire-and-forget.
 */

import { RESEARCH_SCHEMA_VERSION } from "../../../src/lib/research/consent";
import { isElectionOpen } from "../../../src/lib/research/registry";
import { verifyToken } from "../../../src/lib/research/token";
import { isProductionDeployment } from "../../../src/lib/research/environment";
import {
  D1NonceStore,
  KvNonceStore,
  type D1NonceDatabase,
  type KVNamespace,
  type NonceStore,
} from "../../../src/lib/research/nonce-store";

// Minimal slice of the D1 / Pages Functions types we use (see research.ts for the rationale).
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface Env {
  RESEARCH_DB: D1Database;
  /** Explicit deployment marker read by isProductionDeployment() (see research.ts / environment.ts). */
  RESEARCH_ENVIRONMENT?: string;
  /** See research.ts — when set, a valid single-use `geography`-purpose token is REQUIRED. In
   *  production it is mandatory (the endpoint refuses 503 when it is unset). */
  RESEARCH_TOKEN_SECRET?: string;
  /** See research.ts — required in production (the pipeline never runs without the challenge). */
  ALTCHA_HMAC_SECRET?: string;
  /** Non-atomic KV nonce store; usable in non-production only. */
  RESEARCH_NONCES?: KVNamespace;
  /** Atomic D1 nonce store, mirroring research.ts. Preferred when bound and REQUIRED in production
   *  (a raceable KV store fails closed there). SEPARATE from RESEARCH_DB. */
  RESEARCH_NONCES_DB?: D1NonceDatabase;
}
type PagesFunction<E> = (context: { request: Request; env: E }) => Response | Promise<Response>;

/** Must match survey.ts GeographyPayload.schemaVersion; a stale client on another version is dropped. */
const SCHEMA_VERSION = RESEARCH_SCHEMA_VERSION;

/** AEC division names: letters plus space, hyphen, apostrophe (e.g. Eden-Monaro, O'Connor). */
const ELECTORATE_SHAPE = /^[A-Za-z][A-Za-z' -]{1,39}$/;

const MAX_BODY_BYTES = 1024; // election id + division name only
const noContent = (): Response => new Response(null, { status: 204 });
/** Fail-closed reply used in PRODUCTION when a mandatory integrity control is missing (see
 *  research.ts). Body-free like every other reply. */
const serviceUnavailable = (): Response => new Response(null, { status: 503 });

export function cleanElectorate(v: unknown): string | null {
  return typeof v === "string" && ELECTORATE_SHAPE.test(v) ? v : null;
}

export interface GeoSubmission {
  electionId: string;
  electorate: string;
}

/** Parses and sanitises the request body, or returns null if it is not a usable geography ping. */
export function clean(body: unknown): GeoSubmission | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.schemaVersion !== SCHEMA_VERSION) return null;
  const electionId =
    typeof b.electionId === "string" && b.electionId.length > 0 && b.electionId.length <= 32
      ? b.electionId
      : null;
  const electorate = cleanElectorate(b.electorate);
  if (!electionId || !electorate) return null;
  return { electionId, electorate };
}

export async function store(db: D1Database, s: GeoSubmission): Promise<void> {
  await db
    .prepare(
      `INSERT INTO geography_count (election_id, electorate, submissions) VALUES (?, ?, 1)
       ON CONFLICT(election_id, electorate) DO UPDATE SET submissions = submissions + 1`,
    )
    .bind(s.electionId, s.electorate)
    .run();
}

/** The single-use nonce store, mirroring research.ts: the atomic D1 store when RESEARCH_NONCES_DB is
 *  bound (race-free — REQUIRED in production), otherwise the non-atomic KV store, otherwise null. */
function nonceStore(env: Env): NonceStore | null {
  if (env.RESEARCH_NONCES_DB) return new D1NonceStore(env.RESEARCH_NONCES_DB);
  return env.RESEARCH_NONCES ? new KvNonceStore(env.RESEARCH_NONCES) : null;
}

/**
 * The geography token gate — the electorate ping's own single-use token (its own nonce, so it stays
 * separate from the detailed record). In NON-PRODUCTION it is inert when no signing secret is
 * configured; in PRODUCTION a missing secret NEVER accepts (fails closed — the onRequestPost gate
 * refuses first, this returns false as defence in depth). Otherwise a valid, single-use,
 * `geography`-purpose token bound to this election is REQUIRED, and production additionally REQUIRES
 * the atomic D1 nonce store (a raceable KV store fails closed). Exported for tests.
 */
export async function acceptToken(env: Env, token: unknown, electionId: string): Promise<boolean> {
  const production = isProductionDeployment(env);
  const secret = env.RESEARCH_TOKEN_SECRET;
  if (!secret) return !production;
  const verified = await verifyToken(token, secret, {
    electionId,
    schemaVersion: SCHEMA_VERSION,
    purpose: "geography",
  });
  if (!verified.ok) return false;
  if (production && !env.RESEARCH_NONCES_DB) return false;
  const nonces = nonceStore(env);
  if (!nonces) return false;
  const ttl = Math.max(60, verified.claims.expiresAt - Math.floor(Date.now() / 1000));
  return nonces.consume(verified.claims.nonce, ttl);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return noContent();

  // PRODUCTION fail-closed gate (mirrors research.ts): refuse (503) if any mandatory integrity control
  // is missing rather than silently dropping (204). Non-production keeps the inert behaviour below.
  if (isProductionDeployment(env)) {
    if (
      !env.RESEARCH_DB ||
      !env.RESEARCH_TOKEN_SECRET ||
      !env.ALTCHA_HMAC_SECRET ||
      !env.RESEARCH_NONCES_DB
    ) {
      return serviceUnavailable();
    }
  }

  if (!env.RESEARCH_DB) return noContent();

  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return noContent();
    const body = JSON.parse(text) as Record<string, unknown>;
    const submission = clean(body);
    if (!submission) return noContent();
    // Registry gate: only a valid, open election accepts a geography tally.
    if (!isElectionOpen(submission.electionId)) return noContent();
    // Token gate (its own nonce — unlinkable from the detailed record).
    if (!(await acceptToken(env, body.token, submission.electionId))) return noContent();
    await store(env.RESEARCH_DB, submission);
  } catch {
    // Swallow everything: malformed JSON, DB hiccup — the response is uniform regardless.
  }
  return noContent();
};
