/**
 * Research ingestion endpoint — `POST /api/research` (Cloudflare Pages Function).
 * See ADR-0008 (aggregate counters) and docs/research/analysis-plan.md (estimand registry).
 *
 * Only ever called after an explicit, opt-in consent + 18+ confirmation on the client (survey.ts);
 * there is no automatic upload.
 *
 * Contract, in order of importance:
 *  - AGGREGATE-ONLY storage: no per-person row is ever written. The client derives the top-party
 *    match and per-proposition stances on device (payload v3 — the raw answer vector and weights
 *    never reach this endpoint); every write here is an UPSERT that increments a counter keyed
 *    only by the values listed in the analysis plan. Nothing at rest ties one person's attributes
 *    together; a leak of the database exposes only counts.
 *  - KEY RULE (analysis-plan.md): no counter keys an opinion value (party match / stance)
 *    together with a sensitive attribute AND a sub-national geography. Counter rows for the
 *    SENSITIVE_DIMENSIONS are stored national-only (state key = '').
 *  - SEPARATED geography: this endpoint receives NO electorate at all — the electorate
 *    is de-identified before upload by being sent on a SEPARATE request to
 *    `/api/research/geography` (see research/geography.ts), which shares no key with this one.
 *  - Collection cohort: every counter that could vary over time is keyed by the cohort
 *    in which the contribution was collected, so retrospective contributions to a historical
 *    election are never silently combined with contemporaneous ones. The context is classified
 *    HERE, from this server's trusted clock against the AEC timetable boundaries the client
 *    supplies (public facts) — not trusted from the client. Cohort-keyed counters also make the
 *    per-cohort k-anonymity suppression in the stats generator exact.
 *  - Records the consent text version the participant agreed to, in aggregate (consent_count;
 *    A payload without a valid consent version is dropped entirely.
 *  - Stores NO identifiers and emits NO telemetry: no IP (CF-Connecting-IP is never read), no
 *    cookie, no device id, and NO timestamp finer than a calendar quarter anywhere in the store
 *    (`collection_period_count`). No per-request date is even parsed. No logging or exception
 *    reporting of any part of the request — the in-flight payload is the one place a profile
 *    momentarily exists, and it must not be copied into any log (PIA). Values
 *    are allowlist/shape-validated; anything off-list is dropped, never stored.
 *  - NO per-request bundle at rest: the contribution's counter increments are applied as one
 *    atomic D1 batch and nothing records that they came from the same request — no delta log, no
 *    insertion-order key, no shared token. This is deliberate: any per-cell-per-time delta store
 *    (however short-lived) would let a rare cell on a quiet day be regrouped into a temporary
 *    person-level record, which contradicts the aggregate-only guarantee. Poisoning is handled by
 *    PREVENTION at the infra layer (Cloudflare rate limit + Bot Fight Mode on this route) and
 *    detection via Cloudflare request analytics — not by an in-database delta the design forbids.
 *    See ADR-0008 "Integrity without a person-reconstructable delta log".
 *  - Stale clients cannot write: any schemaVersion but the current one is dropped, and the older
 *    raw-vector payload shapes also fail field validation (no `match`/`propositions`).
 *  - Always responds 204 with no body — a uniform reply reveals nothing and cannot be probed.
 *    Malformed input is accepted-then-ignored rather than error-reported.
 *  - The card never depends on this: the browser posts fire-and-forget.
 */

import { DEMOGRAPHIC_OPTIONS, SENSITIVE_DIMENSIONS } from "../../src/lib/survey-questions";
import { RESEARCH_SCHEMA_VERSION, STANCES as STANCE_LIST } from "../../src/lib/research/consent";
import { checkAgainstRegistry } from "../../src/lib/research/registry";
import { verifyToken } from "../../src/lib/research/token";
import { provisionalStageFor, timetableFor } from "../../src/lib/research/timetables";
import { isProductionDeployment } from "../../src/lib/research/environment";
import {
  D1NonceStore,
  KvNonceStore,
  type D1NonceDatabase,
  type KVNamespace,
  type NonceStore,
} from "../../src/lib/research/nonce-store";

// Minimal slice of the D1 / Pages Functions types we use, inlined to avoid a workers-types dependency
// in the web app's typecheck. Wrangler bundles this file with its own runtime types at deploy.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
interface Env {
  RESEARCH_DB: D1Database;
  /** Explicit deployment marker read by isProductionDeployment(); "production" forces the fail-closed
   *  posture below even before the RESEARCH_DB inference. Set in wrangler.toml for deployed builds. */
  RESEARCH_ENVIRONMENT?: string;
  /** HMAC secret for the submission-token integrity layer. When set, a valid single-use token is
   *  REQUIRED (fail-closed); when unset the layer is inert in non-production, but a PRODUCTION
   *  deployment REFUSES (503) rather than accepting unverified. Never committed — a Cloudflare secret. */
  RESEARCH_TOKEN_SECRET?: string;
  /** HMAC secret for the self-hosted ALTCHA anti-abuse challenge verified at the token endpoint. Not
   *  read here, but its presence is required in production: the ingestion endpoint refuses (503) when
   *  it is unset so the pipeline never runs without the challenge the tokens depend on. */
  ALTCHA_HMAC_SECRET?: string;
  /** Payload-free KV store of spent nonces (single-use enforcement). The non-atomic (get-then-put)
   *  store; usable in non-production only — production REQUIRES the atomic D1 store below. */
  RESEARCH_NONCES?: KVNamespace;
  /** Payload-free D1 database (SEPARATE from RESEARCH_DB) for atomic single-use nonce enforcement.
   *  Preferred over KV when bound — INSERT … ON CONFLICT is race-free where KV get-then-put is not.
   *  REQUIRED in production (a raceable KV store fails closed there). Kept out of the aggregate-only
   *  research DB so its nonce table never joins the counter schema. */
  RESEARCH_NONCES_DB?: D1NonceDatabase;
}
type PagesFunction<E> = (context: { request: Request; env: E }) => Response | Promise<Response>;

/** Allowed demographic keys → allowed values, derived from the single SURVEY definition in
 *  src/lib/survey.ts (imported, so the client UI and this validator can never drift). Any value not
 *  on its key's list is dropped, never stored. */
const DEMOGRAPHICS: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(DEMOGRAPHIC_OPTIONS).map(([key, options]) => [key, new Set(options)]),
);
const DEMOGRAPHIC_KEYS = Object.keys(DEMOGRAPHICS);

/** Current payload schema — the single source is survey.ts / research/consent.ts. The research
 *  schema is v1: a client on any other number is dropped here, and a raw-vector body that says 1
 *  still fails field validation (no `match`, no `propositions`), so it can never write. */
const SCHEMA_VERSION = RESEARCH_SCHEMA_VERSION;

/** The eight AU states/territories; the dataset mixes cases ("QLD"/"Qld"), so match uppercased. */
const STATES = new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);

/** The collection-context (cohort) labels. The first four + unknown mirror `electionStage` in
 *  `@how2vote/data-schema`, classified here against this server's clock (the trustworthy "when"). A
 *  placeholder election with no AEC timetable instead reports its provisional lifecycle stage
 *  (pending | provisional | drawn), so a pre-lock wave is never mixed with a post-lock one — a
 *  deliberate series break (docs/research/analysis-plan.md). */
type CollectionContext =
  | "pre-declaration"
  | "live"
  | "post-election"
  | "historical"
  | "unknown"
  | "pending"
  | "provisional"
  | "drawn";

/** Party keys are our own dataset slugs (e.g. "australian_labor_party"). Shape-checked only — the
 *  Function has no dataset; a junk slug creates a counter row that is never published (it is below
 *  k and outside the dataset's party order — the generator drops it). */
const PARTY_SHAPE = /^[a-z0-9_]{1,64}$/;

/** Consent notice versions are short tags set in survey.ts (RESEARCH_CONSENT_VERSION). */
const CONSENT_SHAPE = /^[\w.-]{1,32}$/;

const STANCES = new Set<string>(STANCE_LIST);

const MAX_BODY_BYTES = 8 * 1024; // a valid contribution is well under 2 KB
const MAX_PROPOSITIONS = 200; // guards against a padded payload; the real question set is ~50

const noContent = (): Response => new Response(null, { status: 204 });
/** Fail-closed reply used in PRODUCTION when a mandatory integrity control is missing: an explicit
 *  refusal (503), never a silent 204 and never a fail-open accept. Body-free like every other reply so
 *  it still reveals nothing about the request. */
const serviceUnavailable = (): Response => new Response(null, { status: 503 });

export interface CleanContribution {
  electionId: string;
  consentVersion: string;
  collectionPeriod: string;
  cohort: CollectionContext;
  stateCode: string | null;
  match: string | null;
  demographics: Record<string, string | null>;
  propositions: { id: number; stance: string }[];
}

export function cleanState(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const code = v.toUpperCase();
  return STATES.has(code) ? code : null;
}

/**
 * The AEST (Canberra) calendar quarter of an instant — the coarse collection period tallied per
 * cohort (no timestamp finer than this reaches a long-lived counter). Federal-election reporting
 * uses the AEC's Canberra reference zone; a few hours' skew at a quarter boundary is immaterial to
 * a quarter bucket, so a fixed +10h shift (no daylight-saving handling) is sufficient and
 * deterministic.
 */
export function collectionPeriod(now: Date): string {
  const aest = new Date(now.getTime() + 10 * 60 * 60 * 1000);
  const quarter = Math.floor(aest.getUTCMonth() / 3) + 1;
  return `${aest.getUTCFullYear()}-Q${quarter}`;
}

/**
 * Classify WHEN a contribution was collected relative to the election's AEC timetable, using this
 * server's clock against the authoritative boundary instants looked up SERVER-SIDE from the election
 * id (never trusted from the request body — a hostile client could otherwise stamp poison into any
 * cohort). Mirrors `electionStage` in `@how2vote/data-schema`. Any missing/unparseable boundary ⇒
 * "unknown" rather than a guess.
 */
export function classifyContext(now: Date, timetable: unknown): CollectionContext {
  if (typeof timetable !== "object" || timetable === null) return "unknown";
  const t = timetable as Record<string, unknown>;
  const decl =
    typeof t.declarationOfNominations === "string" ? Date.parse(t.declarationOfNominations) : NaN;
  const close = typeof t.pollsCloseAt === "string" ? Date.parse(t.pollsCloseAt) : NaN;
  const ret = typeof t.returnOfWrits === "string" ? Date.parse(t.returnOfWrits) : NaN;
  if (Number.isNaN(decl) || Number.isNaN(close) || Number.isNaN(ret)) return "unknown";
  const n = now.getTime();
  if (n < decl) return "pre-declaration";
  if (n < close) return "live";
  if (n < ret) return "post-election";
  return "historical";
}

/**
 * The collection cohort for an election id, looked up server-side (never trusted from the request
 * body). A scheduled election is classified from its AEC timetable; a placeholder election with no
 * timetable reports its provisional lifecycle stage instead, so a pending wave (questions in flight)
 * and a provisional wave (questions locked) stay separate counter series.
 */
export function cohortFor(now: Date, electionId: string): CollectionContext {
  const timetable = timetableFor(electionId);
  if (timetable) return classifyContext(now, timetable);
  return provisionalStageFor(electionId) ?? "unknown";
}

/** Parses and sanitises the request body, or returns null if it is not a usable contribution. */
export function clean(body: unknown): CleanContribution | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const str = (v: unknown, max = 120): string | null =>
    typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

  if (b.schemaVersion !== SCHEMA_VERSION) return null;

  const electionId = str(b.electionId, 32);
  // Required for the wave stamp even though not stored per-person: a payload without them is not
  // a current client and is dropped, like a version mismatch.
  const dataVersion = str(b.dataVersion, 32);
  const appVersion = str(b.appVersion, 32);
  if (!electionId || !dataVersion || !appVersion) return null;

  // Consent provenance is mandatory: no valid consent version, no tally of any kind.
  const consentVersion =
    typeof b.consentVersion === "string" && CONSENT_SHAPE.test(b.consentVersion)
      ? b.consentVersion
      : null;
  if (!consentVersion) return null;

  const match = b.match === null ? null : typeof b.match === "string" ? b.match : undefined;
  if (match === undefined) return null;
  if (match !== null && !PARTY_SHAPE.test(match)) return null;

  const rawPropositions = Array.isArray(b.propositions) ? b.propositions : [];
  if (rawPropositions.length > MAX_PROPOSITIONS) return null;
  const seen = new Set<number>();
  const propositions: { id: number; stance: string }[] = [];
  for (const p of rawPropositions) {
    if (typeof p !== "object" || p === null) continue;
    const o = p as Record<string, unknown>;
    const id = o.id;
    const stance = o.stance;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    if (typeof stance !== "string" || !STANCES.has(stance)) continue;
    seen.add(id);
    propositions.push({ id, stance });
  }

  const demographics: Record<string, string | null> = {};
  const rawDemo =
    typeof b.demographics === "object" && b.demographics !== null
      ? (b.demographics as Record<string, unknown>)
      : {};
  for (const key of DEMOGRAPHIC_KEYS) {
    const value = rawDemo[key];
    demographics[key] = typeof value === "string" && DEMOGRAPHICS[key].has(value) ? value : null;
  }

  const now = new Date();
  return {
    electionId,
    consentVersion,
    collectionPeriod: collectionPeriod(now),
    // Server-side lookup by election id — the client-supplied b.timetable is deliberately ignored so
    // it cannot choose which cohort its contribution lands in. A placeholder election reports its
    // provisional lifecycle stage as the cohort (pending/provisional/drawn).
    cohort: cohortFor(now, electionId),
    stateCode: cleanState(b.state),
    match,
    demographics,
    propositions,
  };
}

/** One counter increment: which table, and the values of its key columns, in column order. */
export type Increment = { tbl: string; keys: (string | number)[] };

/** UPSERT per counter table. Static SQL only — key VALUES are always bound, never interpolated. */
const COUNTER_SQL: Record<string, string> = {
  response_total: `INSERT INTO response_total (election_id, cohort, state_code, responses) VALUES (?,?,?,1)
     ON CONFLICT(election_id, cohort, state_code) DO UPDATE SET responses = responses + 1`,
  demographic_count: `INSERT INTO demographic_count (election_id, cohort, state_code, dimension, bucket, party, n) VALUES (?,?,?,?,?,?,1)
     ON CONFLICT(election_id, cohort, state_code, dimension, bucket, party) DO UPDATE SET n = n + 1`,
  proposition_count: `INSERT INTO proposition_count (election_id, cohort, proposition_id, stance, n) VALUES (?,?,?,?,1)
     ON CONFLICT(election_id, cohort, proposition_id, stance) DO UPDATE SET n = n + 1`,
  proposition_party_count: `INSERT INTO proposition_party_count (election_id, cohort, proposition_id, stance, party, n) VALUES (?,?,?,?,?,1)
     ON CONFLICT(election_id, cohort, proposition_id, stance, party) DO UPDATE SET n = n + 1`,
  weighting_frame_count: `INSERT INTO weighting_frame_count (election_id, cohort, state_code, age, gender, n) VALUES (?,?,?,?,?,1)
     ON CONFLICT(election_id, cohort, state_code, age, gender) DO UPDATE SET n = n + 1`,
  consent_count: `INSERT INTO consent_count (election_id, consent_version, n) VALUES (?,?,1)
     ON CONFLICT(election_id, consent_version) DO UPDATE SET n = n + 1`,
  collection_period_count: `INSERT INTO collection_period_count (election_id, cohort, period, n) VALUES (?,?,?,1)
     ON CONFLICT(election_id, cohort, period) DO UPDATE SET n = n + 1`,
};

/**
 * The full set of counter increments one contribution produces — the executable form of the
 * estimand registry (analysis-plan.md E1–E8; E6 geography lives on its own endpoint). Exported so
 * the tests can pin the key rule.
 */
export function increments(c: CleanContribution): Increment[] {
  const out: Increment[] = [];
  const state = c.stateCode ?? "";

  // E7/E8 — the consent-version and per-cohort collection-period records, for every valid
  // contribution.
  out.push({ tbl: "consent_count", keys: [c.electionId, c.consentVersion] });
  out.push({
    tbl: "collection_period_count",
    keys: [c.electionId, c.cohort, c.collectionPeriod],
  });

  // E3 — proposition support, per cohort, national only.
  for (const p of c.propositions) {
    out.push({ tbl: "proposition_count", keys: [c.electionId, c.cohort, p.id, p.stance] });
  }

  // The opinion-keyed counters exist only for scored contributions (match derived on device).
  if (c.match !== null) {
    // E1 — denominators; the dashboard gate counts scored responses per cohort, as the per-cohort
    // suppression pipeline always has.
    out.push({ tbl: "response_total", keys: [c.electionId, c.cohort, state] });

    // E5 — the weighting frame: joint age × gender × state per cohort, NO opinion columns
    // ('' = no answer). Cohorts are analysed separately, so each needs its own frame.
    out.push({
      tbl: "weighting_frame_count",
      keys: [c.electionId, c.cohort, state, c.demographics.age ?? "", c.demographics.gender ?? ""],
    });

    // E2 — party × ONE demographic, per cohort. KEY RULE: sensitive dimensions are national-only.
    for (const dim of DEMOGRAPHIC_KEYS) {
      const bucket = c.demographics[dim];
      if (bucket === null) continue;
      const stateKey = SENSITIVE_DIMENSIONS.has(dim) ? "" : state;
      out.push({
        tbl: "demographic_count",
        keys: [c.electionId, c.cohort, stateKey, dim, bucket, c.match],
      });
    }

    // E4 — proposition stance × party, per cohort, national only.
    for (const p of c.propositions) {
      out.push({
        tbl: "proposition_party_count",
        keys: [c.electionId, c.cohort, p.id, p.stance, c.match],
      });
    }
  }

  return out;
}

/**
 * Applies a contribution as ONE atomic D1 batch of counter UPSERTs — either fully tallied or
 * absent, so a partial write cannot leave the counters inconsistent. Nothing records that these
 * increments came from the same request: no delta row, no insertion-order key, no shared token.
 * That is the point — a per-request bundle at rest (even short-lived) would be a temporary
 * person-level record (see the header and ADR-0008).
 */
export async function store(db: D1Database, c: CleanContribution): Promise<void> {
  const statements = increments(c).map((inc) => db.prepare(COUNTER_SQL[inc.tbl]).bind(...inc.keys));
  await db.batch(statements);
}

/** The single-use nonce store, kept payload-free: the atomic D1 store when a dedicated
 * RESEARCH_NONCES_DB binding is provisioned, otherwise the KV store (the default today), otherwise
 * null. */
function nonceStore(env: Env): NonceStore | null {
  // Prefer the atomic D1 store when its dedicated RESEARCH_NONCES_DB binding is provisioned (race-free
  // single-use — REQUIRED in production). Otherwise the non-atomic KV store, allowed in non-production
  // only. Null when neither is bound — with the token secret set, a null store fails closed below.
  if (env.RESEARCH_NONCES_DB) return new D1NonceStore(env.RESEARCH_NONCES_DB);
  return env.RESEARCH_NONCES ? new KvNonceStore(env.RESEARCH_NONCES) : null;
}

/**
 * The submission-token gate. In NON-PRODUCTION, when no signing secret is configured the layer is
 * inert (returns true) and the endpoint stands on registry validation + the edge rate-limit. In
 * PRODUCTION a missing secret NEVER accepts — it fails closed (the onRequestPost gate refuses first,
 * and this returns false as defence in depth). When a secret IS configured a valid, single-use,
 * correctly-bound token is REQUIRED: a missing/forged/expired/replayed token, an absent nonce store,
 * or (in production) only the non-atomic KV store fails closed (false → drop). Exported for tests.
 */
export async function acceptToken(
  env: Env,
  token: unknown,
  bind: { electionId: string; consentVersion: string },
): Promise<boolean> {
  const production = isProductionDeployment(env);
  const secret = env.RESEARCH_TOKEN_SECRET;
  // Integrity layer not provisioned: inert in non-production, but a production deployment must NOT
  // accept without a verified token, so fail closed.
  if (!secret) return !production;
  const verified = await verifyToken(token, secret, {
    electionId: bind.electionId,
    schemaVersion: SCHEMA_VERSION,
    consentVersion: bind.consentVersion,
    purpose: "research",
  });
  if (!verified.ok) return false;
  // Production REQUIRES the atomic D1 nonce store: a raceable KV get-then-put cannot guarantee
  // single-use under concurrent replays, so reject rather than accept with it.
  if (production && !env.RESEARCH_NONCES_DB) return false;
  const nonces = nonceStore(env);
  if (!nonces) return false; // secret set but no nonce store — cannot enforce single-use → fail closed
  const ttl = Math.max(60, verified.claims.expiresAt - Math.floor(Date.now() / 1000));
  return nonces.consume(verified.claims.nonce, ttl);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Cheap guards before touching the body or the database.
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return noContent();

  // PRODUCTION fail-closed gate: refuse (503) rather than silently drop (204) or accept unverified if
  // any mandatory integrity control is missing — the signing secret, the anti-abuse challenge secret,
  // the ATOMIC nonce store, or the research database. Non-production (local/preview) keeps the inert
  // behaviour below so dev works without secrets.
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
    // Re-check the actual size: a chunked request carries no content-length header.
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return noContent();
    const body = JSON.parse(text) as Record<string, unknown>;
    const contribution = clean(body);
    if (!contribution) return noContent();

    // Registry gate: drop any contribution to an unknown/closed election, a mismatched schema, an
    // unaccepted (stale/unknown/future) consent version, or carrying an out-of-registry party match
    // or proposition id (poisoning prevention).
    const registry = checkAgainstRegistry({
      electionId: contribution.electionId,
      schemaVersion: SCHEMA_VERSION,
      consentVersion: contribution.consentVersion,
      match: contribution.match,
      propositionIds: contribution.propositions.map((p) => p.id),
    });
    if (!registry.ok) return noContent();

    // Token gate: short-lived, single-use, bound to this election + consent version.
    const ok = await acceptToken(env, body.token, {
      electionId: contribution.electionId,
      consentVersion: contribution.consentVersion,
    });
    if (!ok) return noContent();

    await store(env.RESEARCH_DB, contribution);
  } catch {
    // Swallow everything: malformed JSON, DB hiccup — the response is uniform regardless, and
    // nothing about the request may reach a log or error reporter (see header).
  }
  return noContent();
};
