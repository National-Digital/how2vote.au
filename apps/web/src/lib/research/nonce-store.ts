/**
 * Single-use nonce store for research submission tokens.
 *
 * A signed token proves authenticity and carries its own expiry; this store is the ONE piece of
 * server state that makes it single-use — it records that a nonce has been spent so a captured token
 * cannot be replayed within its short validity window. It is deliberately PAYLOAD-FREE: it holds only
 * the opaque random nonce (a key) with a self-expiring TTL — no election, no answers, no demographics,
 * no IP, no timestamp finer than the TTL, nothing that ties a nonce to a person or a contribution.
 * That keeps the aggregate-only guarantee intact (the nonce store is NOT the D1 research database and
 * is never joined to it).
 *
 * The interface is provider-neutral so the backing store is swappable. `D1NonceStore` is the
 * race-free store REQUIRED in production (the ingestion endpoints refuse a production write when only
 * the non-atomic KV store is available — see nonceStore() and the production gate in
 * functions/api/research.ts). `KvNonceStore` is the non-atomic fallback, usable in non-production
 * only. `MemoryNonceStore` backs the tests.
 */

/** Records spent nonces; the contract is "consume returns true exactly once per nonce". */
export interface NonceStore {
  /**
   * Atomically mark a nonce as consumed. Returns `true` if this was the FIRST time the nonce was
   * seen (accept the submission) and `false` if it had already been consumed (a replay — reject).
   * `ttlSeconds` bounds how long the spent marker is retained; it must cover the token's remaining
   * lifetime so a replay inside the validity window is always caught.
   */
  consume(nonce: string, ttlSeconds: number): Promise<boolean>;
}

/** The slice of the Cloudflare Workers KV API we use. */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Never retain a spent-nonce marker for less than this (KV's own minimum TTL is 60s). */
const MIN_TTL_SECONDS = 60;

/**
 * Cloudflare KV-backed store. KV is eventually consistent, so a burst of truly simultaneous replays
 * of the SAME token could in principle both read "absent" before either writes; that residual risk
 * is covered in depth by the short token lifetime plus the live edge rate limit.
 * For the ordinary capture-and-replay case (any measurable time apart) this is exact.
 */
export class KvNonceStore implements NonceStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly prefix = "nonce:",
  ) {}

  async consume(nonce: string, ttlSeconds: number): Promise<boolean> {
    const key = this.prefix + nonce;
    if (await this.kv.get(key)) return false;
    await this.kv.put(key, "1", {
      expirationTtl: Math.max(MIN_TTL_SECONDS, Math.ceil(ttlSeconds)),
    });
    return true;
  }
}

/** The slice of the Cloudflare D1 API the atomic nonce store uses. */
export interface D1NonceResult {
  meta?: { changes?: number };
}
export interface D1NonceStatement {
  bind(...values: unknown[]): D1NonceStatement;
}
export interface D1NonceDatabase {
  prepare(query: string): D1NonceStatement;
  batch(statements: D1NonceStatement[]): Promise<D1NonceResult[]>;
}

/**
 * D1-backed store — the race-free implementation, REQUIRED in production. It is active when the
 * dedicated `RESEARCH_NONCES_DB` D1 binding is provisioned; in production the ingestion endpoints
 * refuse (503) when it is absent (see nonceStore() and the production gate in
 * functions/api/research.ts), so a raceable KV store never backs a production write. Unlike KV
 * (eventually consistent, so a get-then-put race can let a token replay inside the propagation
 * window), a single
 * `INSERT … ON CONFLICT(nonce) DO NOTHING` is atomic: exactly one insert of a given nonce reports
 * `changes === 1`; every concurrent replay conflicts and reports `0`. Single-use is therefore exact
 * even under simultaneous distributed replays.
 *
 * This MUST be a SEPARATE D1 database from the research store (its own binding): the research DB is
 * aggregate-only by construction (check-aggregate-only.mjs allowlists exactly the counter tables), so
 * the nonce table cannot live there. The store stays payload-free — an opaque nonce key + an expiry
 * integer only — so it never ties a nonce to a person or a contribution. Each call self-provisions the
 * table, prunes expired markers, and consumes the nonce, all in one atomic batch.
 */
export class D1NonceStore implements NonceStore {
  constructor(private readonly db: D1NonceDatabase) {}

  async consume(nonce: string, ttlSeconds: number): Promise<boolean> {
    const ttl = Math.max(MIN_TTL_SECONDS, Math.ceil(ttlSeconds));
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + ttl;
    const results = await this.db.batch([
      this.db.prepare(
        "CREATE TABLE IF NOT EXISTS used_nonce (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)",
      ),
      this.db.prepare("DELETE FROM used_nonce WHERE expires_at < ?").bind(nowSec),
      this.db
        .prepare(
          "INSERT INTO used_nonce (nonce, expires_at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING",
        )
        .bind(nonce, expiresAt),
    ]);
    // The INSERT is the last statement; changes === 1 means this was the first use of the nonce.
    return (results[results.length - 1]?.meta?.changes ?? 0) === 1;
  }
}

/** In-memory store for tests (and any single-instance runtime). Not for multi-instance production. */
export class MemoryNonceStore implements NonceStore {
  private readonly seen = new Set<string>();

  async consume(nonce: string, _ttlSeconds?: number): Promise<boolean> {
    void _ttlSeconds;
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    return true;
  }
}
