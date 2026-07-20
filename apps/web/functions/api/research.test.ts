import { describe, expect, it, vi } from "vitest";

// Pin an explicitly un-suspended control plane so these ingestion-logic tests are independent of the
// live kill-switch state (research intake is currently live after the 2026-07-19 sign-off; a future
// re-suspension must not turn these logic tests red). The fail-closed closed-intake behaviour is
// asserted in src/lib/research/registry.test.ts. Digest is the empty-suspensions plane's digest.
vi.mock("../../../../data/governance/control-plane.json", () => ({
  default: {
    schemaVersion: 1,
    suspensions: [],
    integrity: "sha256-284295c891854ce87d99ec3e98e66f48d542cba2008375a321497ac11d21b8ce",
  },
}));
import {
  acceptToken,
  classifyContext,
  cohortFor,
  clean,
  cleanState,
  collectionPeriod,
  increments,
  onRequestPost,
  store,
} from "./research";
import { registryEntry } from "../../src/lib/research/registry";
import { newNonce, signToken, type TokenClaims } from "../../src/lib/research/token";
import { RESEARCH_CONSENT_VERSION } from "../../src/lib/research/consent";

/** A minimal valid v3 contribution body; individual tests override fields as needed. The raw
 *  answer vector never appears here (derived on device — ADR-0008), and the electorate is NOT part
 *  of this endpoint (it goes to /api/research/geography). */
const base = () => ({
  schemaVersion: 1,
  electionId: "2025",
  dataVersion: "2025-05-01",
  appVersion: "2.1.0",
  state: "NSW",
  consentVersion: "2026-07.2",
  timetable: {
    declarationOfNominations: "2025-04-11T12:00:00+10:00",
    pollsCloseAt: "2025-05-03T20:00:00+10:00",
    returnOfWrits: "2025-06-12T23:59:59+10:00",
  },
  match: "australian_labor_party",
  propositions: [
    { id: 1, stance: "agree" },
    { id: 2, stance: "disagree" },
  ],
  demographics: { age: "25–34", religion: "Christian" },
});

describe("cleanState", () => {
  it("uppercases a valid state/territory code", () => {
    expect(cleanState("qld")).toBe("QLD");
    expect(cleanState("NSW")).toBe("NSW");
  });
  it("rejects anything off the eight-code allowlist", () => {
    expect(cleanState("XX")).toBeNull();
    expect(cleanState("Queensland")).toBeNull();
    expect(cleanState("")).toBeNull();
    expect(cleanState(42)).toBeNull();
    expect(cleanState(null)).toBeNull();
  });
});

describe("collectionPeriod", () => {
  it("buckets an instant into its AEST calendar quarter", () => {
    expect(collectionPeriod(new Date("2026-07-14T00:00:00Z"))).toBe("2026-Q3");
    expect(collectionPeriod(new Date("2025-01-01T05:00:00Z"))).toBe("2025-Q1");
    expect(collectionPeriod(new Date("2025-10-15T12:00:00Z"))).toBe("2025-Q4");
  });
  it("shifts to AEST at a UTC quarter boundary", () => {
    // 31 Dec 2025 23:00 UTC is 1 Jan 2026 09:00 AEST → next year, Q1.
    expect(collectionPeriod(new Date("2025-12-31T23:00:00Z"))).toBe("2026-Q1");
  });
});

describe("classifyContext — AEC timetable boundaries (no magic-number offsets)", () => {
  const t = base().timetable;
  it("classifies each stage relative to the AEC milestones", () => {
    expect(classifyContext(new Date("2025-04-01T00:00:00Z"), t)).toBe("pre-declaration");
    expect(classifyContext(new Date("2025-04-30T00:00:00Z"), t)).toBe("live");
    expect(classifyContext(new Date("2025-05-20T00:00:00Z"), t)).toBe("post-election");
    expect(classifyContext(new Date("2026-07-14T00:00:00Z"), t)).toBe("historical");
  });
  it("is 'unknown' when the timetable is missing or unparseable", () => {
    expect(classifyContext(new Date(), null)).toBe("unknown");
    expect(classifyContext(new Date(), {})).toBe("unknown");
    expect(classifyContext(new Date(), { declarationOfNominations: "not-a-date" })).toBe("unknown");
  });
});

describe("cohortFor — placeholder elections report their provisional lifecycle stage", () => {
  it("classifies a scheduled election from its AEC timetable", () => {
    // 2025 is a real, timetabled election — historical by now.
    expect(cohortFor(new Date("2026-07-19T00:00:00Z"), "2025")).toBe("historical");
  });
  it("reports the provisional stage for the timetable-less 'next' placeholder", () => {
    // "next" ships with provisionalStage "pending" and no timetable — the cohort is that stage, not
    // "unknown", so a pending wave never mixes with a later provisional/drawn one (series break).
    expect(cohortFor(new Date(), "next")).toBe("pending");
  });
  it("is 'unknown' for an id that is neither timetabled nor a placeholder", () => {
    expect(cohortFor(new Date(), "no-such-election")).toBe("unknown");
  });
});

describe("clean", () => {
  it("returns null for non-object bodies", () => {
    expect(clean(null)).toBeNull();
    expect(clean("string")).toBeNull();
    expect(clean(42)).toBeNull();
  });

  it("accepts and normalises a valid contribution", () => {
    const out = clean({ ...base(), state: "qld" });
    expect(out).not.toBeNull();
    expect(out!.stateCode).toBe("QLD");
    expect(out!.electionId).toBe("2025");
    expect(out!.match).toBe("australian_labor_party");
    expect(out!.demographics.age).toBe("25–34");
    expect(out!.propositions).toEqual([
      { id: 1, stance: "agree" },
      { id: 2, stance: "disagree" },
    ]);
    // No per-request date is parsed at all; the coarsest time is the collection quarter.
    expect("createdDay" in (out as object)).toBe(false);
    // Consent provenance + collection cohort are recorded (in aggregate, at store time).
    expect(out!.consentVersion).toBe("2026-07.2");
    expect(out!.collectionPeriod).toMatch(/^\d{4}-Q[1-4]$/);
    expect(out!.cohort).toBe("historical");
  });

  it("does not carry an electorate field (it is a separate endpoint)", () => {
    const out = clean({ ...base(), electorate: "Bennelong" });
    expect(out).not.toBeNull();
    expect("electorate" in (out as object)).toBe(false);
  });

  it("requires electionId, dataVersion, appVersion and a valid consentVersion", () => {
    expect(clean({ ...base(), electionId: "" })).toBeNull();
    expect(clean({ ...base(), dataVersion: undefined })).toBeNull();
    expect(clean({ ...base(), appVersion: 5 })).toBeNull();
    expect(clean({ ...base(), consentVersion: undefined })).toBeNull();
    expect(clean({ ...base(), consentVersion: "not a version!" })).toBeNull();
  });

  it("classifies the cohort from the SERVER-SIDE timetable, ignoring the request body", () => {
    // Removing (or forging) the body timetable cannot force a cohort: the server looks the election's
    // timetable up by id, so a known election still classifies from real boundaries.
    const { timetable, ...rest } = base();
    void timetable;
    expect(clean(rest)!.cohort).not.toBe("unknown");
  });

  it("records an unknown cohort for an unknown election id (no server-side timetable)", () => {
    expect(clean({ ...base(), electionId: "9999" })!.cohort).toBe("unknown");
  });

  it("accepts a null match (all-skips contribution) but rejects an off-shape one", () => {
    expect(clean({ ...base(), match: null })!.match).toBeNull();
    expect(clean({ ...base(), match: "DROP TABLE" })).toBeNull();
    expect(clean({ ...base(), match: "Labor Party" })).toBeNull(); // spaces/case = not a slug
    expect(clean({ ...base(), match: 42 })).toBeNull();
    expect(clean({ ...base(), match: undefined })).toBeNull();
  });

  it("rejects an old raw-vector payload even if it claims the current schema number", () => {
    // A stale pre-counters client body: answers array, no match/propositions. The version check
    // alone would pass (it also said 3 once); the missing `match` key must reject it.
    const stale = {
      schemaVersion: 1,
      electionId: "2025",
      dataVersion: "2025-05-01",
      appVersion: "1.0.0",
      state: "NSW",
      electorate: "Bennelong",
      answers: [{ id: 1, points: 5, important: true }],
      demographics: { age: "25–34" },
    };
    expect(clean(stale)).toBeNull();
  });

  it("nulls an off-list state rather than storing it", () => {
    const out = clean({ ...base(), state: "XX" });
    expect(out).not.toBeNull();
    expect(out!.stateCode).toBeNull();
  });

  it("keeps only allowlisted demographic values and drops unknown keys", () => {
    const out = clean({
      ...base(),
      demographics: { age: "25–34", gender: "not-an-option", hacker: "x" },
    });
    expect(out!.demographics.age).toBe("25–34");
    expect(out!.demographics.gender).toBeNull();
    expect("hacker" in out!.demographics).toBe(false);
  });

  it("filters malformed propositions and deduplicates ids", () => {
    const out = clean({
      ...base(),
      propositions: [
        { id: 1, stance: "agree" }, // ok
        { id: 1, stance: "disagree" }, // duplicate id — dropped
        { id: 0, stance: "agree" }, // id must be > 0
        { id: 2, stance: "strongly agree" }, // not a stance
        { id: 3, stance: 5 }, // not a string
        { id: 2.5, stance: "neutral" }, // non-integer id
        "nope", // not an object
      ],
    });
    expect(out!.propositions).toEqual([{ id: 1, stance: "agree" }]);
  });

  it("rejects a padded proposition array over the cap", () => {
    const propositions = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, stance: "agree" }));
    expect(clean({ ...base(), propositions })).toBeNull();
  });

  it("rejects a body whose schemaVersion is absent or not current", () => {
    const { schemaVersion, ...withoutVersion } = base();
    void schemaVersion;
    expect(clean(withoutVersion)).toBeNull();
    expect(clean({ ...base(), schemaVersion: 5 })).toBeNull(); // stale in-flight raw-vector client
    expect(clean({ ...base(), schemaVersion: "1" })).toBeNull();
  });

  it("tolerates missing demographics and propositions on an otherwise valid contribution", () => {
    const { demographics, propositions, ...rest } = base();
    void demographics;
    void propositions;
    const out = clean(rest);
    expect(out).not.toBeNull();
    expect(out!.propositions).toEqual([]);
    expect(out!.demographics.age).toBeNull();
  });
});

describe("increments — the estimand registry, executable (ADR-0008)", () => {
  it("produces ONLY counter increments — no per-person write of any kind", () => {
    const incs = increments(clean(base())!);
    const tables = new Set(incs.map((i) => i.tbl));
    expect(tables).toEqual(
      new Set([
        "consent_count",
        "collection_period_count",
        "proposition_count",
        "response_total",
        "weighting_frame_count",
        "demographic_count",
        "proposition_party_count",
      ]),
    );
  });

  it("keys every time-varying counter by the collection cohort", () => {
    const incs = increments(clean(base())!);
    for (const inc of incs) {
      if (inc.tbl === "consent_count") continue; // consent provenance is cohort-independent
      expect(inc.keys[1], `${inc.tbl} must key cohort`).toBe("historical");
    }
  });

  it("KEY RULE: sensitive dimensions are national-only; non-sensitive keep the state", () => {
    const incs = increments(clean(base())!);
    const demo = incs.filter((i) => i.tbl === "demographic_count");
    // age (non-sensitive) keys the contributor's state…
    expect(demo.find((i) => i.keys[3] === "age")!.keys).toEqual([
      "2025",
      "historical",
      "NSW",
      "age",
      "25–34",
      "australian_labor_party",
    ]);
    // …religion (sensitive) is stored with the national sentinel, never the state.
    expect(demo.find((i) => i.keys[3] === "religion")!.keys).toEqual([
      "2025",
      "historical",
      "",
      "religion",
      "Christian",
      "australian_labor_party",
    ]);
  });

  it("an unscored contribution (null match) tallies no opinion-keyed counter", () => {
    const incs = increments(clean({ ...base(), match: null, propositions: [] })!);
    const tables = incs.map((i) => i.tbl);
    expect(tables).toContain("consent_count");
    expect(tables).toContain("collection_period_count");
    expect(tables).not.toContain("response_total");
    expect(tables).not.toContain("demographic_count");
    expect(tables).not.toContain("weighting_frame_count");
    expect(tables).not.toContain("proposition_party_count");
  });

  it("builds the weighting frame from cohort × state × age × gender with '' for non-response", () => {
    const incs = increments(clean({ ...base(), demographics: { age: "25–34" } })!);
    const frame = incs.find((i) => i.tbl === "weighting_frame_count");
    expect(frame!.keys).toEqual(["2025", "historical", "NSW", "25–34", ""]);
  });

  it("crosses each stance with the match for proposition_party_count", () => {
    const incs = increments(clean(base())!);
    const cross = incs.filter((i) => i.tbl === "proposition_party_count");
    expect(cross).toEqual([
      {
        tbl: "proposition_party_count",
        keys: ["2025", "historical", 1, "agree", "australian_labor_party"],
      },
      {
        tbl: "proposition_party_count",
        keys: ["2025", "historical", 2, "disagree", "australian_labor_party"],
      },
    ]);
  });
});

/**
 * A fake D1 that records every prepared statement and its binds, so we can assert the
 * aggregate-only write shape without a real database.
 */
function fakeDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  let batches = 0;
  const statement = (sql: string) => ({
    bind(...values: unknown[]) {
      calls.push({ sql, binds: values });
      return this;
    },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: unknown[]) => {
      batches += 1;
      return statements.map(() => ({}));
    },
  };
  return { db, calls, batchCount: () => batches };
}

describe("store — aggregate-only, atomic, no per-request bundle (ADR-0008)", () => {
  it("issues only counter UPSERTs — never an INSERT into a per-person table", async () => {
    const { db, calls } = fakeDb();
    await store(db as never, clean(base())!);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.sql).not.toMatch(/INSERT INTO submission\b/);
      expect(c.sql).not.toMatch(/submission_answer/);
      expect(c.sql).toMatch(/ON CONFLICT/);
    }
  });

  it("writes NO delta log and NO per-request/day bundle at rest", async () => {
    const { db, calls } = fakeDb();
    await store(db as never, clean(base())!);
    // A per-cell-per-day delta store would let a rare cell be regrouped into a person record.
    for (const c of calls) {
      expect(c.sql).not.toMatch(/counter_delta/);
      expect(c.sql).not.toMatch(/DELETE/);
    }
    // No bound value is a per-request date/timestamp — the coarsest time is the collection quarter.
    for (const c of calls) {
      for (const b of c.binds) {
        expect(typeof b === "string" ? b : "").not.toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
    }
  });

  it("never touches the geography counter (that is a separate endpoint)", async () => {
    const { db, calls } = fakeDb();
    await store(db as never, clean(base())!);
    expect(calls.some((c) => /geography_count/.test(c.sql))).toBe(false);
  });

  it("applies the whole contribution as ONE atomic batch", async () => {
    const { db, batchCount } = fakeDb();
    await store(db as never, clean(base())!);
    expect(batchCount()).toBe(1);
  });
});

// Registry + token integration

const SECRET = "test-token-secret";
const entry = registryEntry("2025")!;
const realParty = [...entry.parties][0];
const realProps = [...entry.propositionIds].slice(0, 2);

/** A body whose values are all in the 2025 registry (base() uses placeholder proposition ids). */
const registryBody = () => ({
  ...base(),
  match: realParty,
  propositions: realProps.map((id) => ({ id, stance: "agree" })),
});

/** A tiny KV honouring get/put for the single-use nonce store. */
function fakeKv() {
  const map = new Map<string, string>();
  return {
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function tokenClaims(overrides: Partial<TokenClaims> = {}): TokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    electionId: "2025",
    schemaVersion: 1,
    consentVersion: RESEARCH_CONSENT_VERSION,
    purpose: "research",
    nonce: newNonce(),
    issuedAt: now,
    expiresAt: now + 300,
    ...overrides,
  };
}

async function post(body: unknown, env: Record<string, unknown>): Promise<Response> {
  const request = new Request("https://how2vote.au/api/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Default to a NON-production deployment (inert token layer) unless a case sets the marker: a bound
  // RESEARCH_DB with no marker is otherwise treated as production and fails closed (503).
  return onRequestPost({ request, env: { RESEARCH_ENVIRONMENT: "test", ...env } } as never);
}

/** A fake ATOMIC D1 nonce store (RESEARCH_NONCES_DB): the first insert of a nonce reports
 *  changes === 1, every replay reports 0 — the race-free single-use production requires. */
function fakeNonceDb() {
  const seen = new Set<string>();
  const make = (
    binds: unknown[] = [],
  ): { bind: (...v: unknown[]) => unknown; binds: unknown[] } => ({
    bind: (...values: unknown[]) => make(values),
    binds,
  });
  return {
    prepare: () => make(),
    batch: async (statements: { binds: unknown[] }[]) => {
      const insert = statements[statements.length - 1];
      const nonce = String(insert.binds[0]);
      const first = !seen.has(nonce);
      if (first) seen.add(nonce);
      return statements.map((_s, i) =>
        i === statements.length - 1 ? { meta: { changes: first ? 1 : 0 } } : {},
      );
    },
  };
}

describe("onRequestPost — registry gate", () => {
  it("stores an all-in-registry contribution when the integrity layer is inert (no secret)", async () => {
    const { db, calls } = fakeDb();
    const res = await post(registryBody(), { RESEARCH_DB: db });
    expect(res.status).toBe(204);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("drops a contribution to an unknown election", async () => {
    const { db, calls } = fakeDb();
    await post({ ...registryBody(), electionId: "1901" }, { RESEARCH_DB: db });
    expect(calls.length).toBe(0);
  });

  it("drops an out-of-registry party match", async () => {
    const { db, calls } = fakeDb();
    await post({ ...registryBody(), match: "not_a_real_party" }, { RESEARCH_DB: db });
    expect(calls.length).toBe(0);
  });

  it("drops an out-of-registry proposition id", async () => {
    const { db, calls } = fakeDb();
    await post(
      { ...registryBody(), propositions: [{ id: 99999999, stance: "agree" }] },
      { RESEARCH_DB: db },
    );
    expect(calls.length).toBe(0);
  });

  it("drops a stale/unknown consent version even if well-shaped", async () => {
    const { db, calls } = fakeDb();
    await post({ ...registryBody(), consentVersion: "2099-01" }, { RESEARCH_DB: db });
    expect(calls.length).toBe(0);
  });

  it("drops an over-large body before parsing", async () => {
    const { db, calls } = fakeDb();
    const request = new Request("https://how2vote.au/api/research", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(9 * 1024) },
      body: JSON.stringify(registryBody()),
    });
    await onRequestPost({ request, env: { RESEARCH_DB: db } } as never);
    expect(calls.length).toBe(0);
  });
});

describe("acceptToken — single-use signed token gate", () => {
  const bind = { electionId: "2025", consentVersion: RESEARCH_CONSENT_VERSION };

  it("is inert (accepts) in NON-production when no signing secret is configured", async () => {
    // Non-production only: a bound RESEARCH_DB with no marker would be production and fail closed.
    expect(await acceptToken({ RESEARCH_ENVIRONMENT: "test" } as never, undefined, bind)).toBe(
      true,
    );
  });

  it("accepts a valid token once, then REJECTS the replay (nonce consumed)", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    const token = await signToken(tokenClaims(), SECRET);
    expect(await acceptToken(env, token, bind)).toBe(true);
    expect(await acceptToken(env, token, bind)).toBe(false);
  });

  it("rejects a missing / forged token", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    expect(await acceptToken(env, undefined, bind)).toBe(false);
    expect(await acceptToken(env, "garbage.sig", bind)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(tokenClaims({ issuedAt: now - 600, expiresAt: now - 1 }), SECRET);
    expect(await acceptToken(env, token, bind)).toBe(false);
  });

  it("rejects a token bound to a different election / consent version", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    const wrongElection = await signToken(tokenClaims({ electionId: "2019" }), SECRET);
    expect(await acceptToken(env, wrongElection, bind)).toBe(false);
    const wrongConsent = await signToken(tokenClaims({ consentVersion: "2099-01" }), SECRET);
    expect(await acceptToken(env, wrongConsent, bind)).toBe(false);
  });

  it("rejects a geography-purpose token on the research endpoint", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    const geo = await signToken(tokenClaims({ purpose: "geography" }), SECRET);
    expect(await acceptToken(env, geo, bind)).toBe(false);
  });

  it("FAILS CLOSED when the secret is set but no nonce store is bound", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET } as never;
    const token = await signToken(tokenClaims(), SECRET);
    expect(await acceptToken(env, token, bind)).toBe(false);
  });
});

describe("onRequestPost — end-to-end with the token layer enabled", () => {
  it("stores a contribution carrying a valid token, then drops its replay", async () => {
    const kv = fakeKv();
    const token = await signToken(tokenClaims(), SECRET);
    const first = fakeDb();
    await post(
      { ...registryBody(), token },
      { RESEARCH_DB: first.db, RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: kv },
    );
    expect(first.calls.length).toBeGreaterThan(0);

    const second = fakeDb();
    await post(
      { ...registryBody(), token },
      { RESEARCH_DB: second.db, RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: kv },
    );
    expect(second.calls.length).toBe(0); // replay dropped
  });

  it("drops a token-less contribution when the layer is enabled", async () => {
    const { db, calls } = fakeDb();
    await post(registryBody(), {
      RESEARCH_DB: db,
      RESEARCH_TOKEN_SECRET: SECRET,
      RESEARCH_NONCES: fakeKv(),
    });
    expect(calls.length).toBe(0);
  });
});

// —— PRODUCTION fail-closed behaviour (was fail-open) ——————————————————————————————
// In production the endpoint must REFUSE (503) rather than silently drop (204) or accept unverified
// when any mandatory integrity control is missing, and acceptToken must never accept just because the
// secret is absent. These assert the NEW fail-closed contract.

describe("acceptToken — PRODUCTION fails closed", () => {
  const bind = { electionId: "2025", consentVersion: RESEARCH_CONSENT_VERSION };
  const prod = { RESEARCH_ENVIRONMENT: "production" };

  it("does NOT accept just because the signing secret is missing (was fail-open → now closed)", async () => {
    expect(await acceptToken({ ...prod } as never, undefined, bind)).toBe(false);
  });

  it("rejects when only the non-atomic KV nonce store is available (atomic D1 required)", async () => {
    const token = await signToken(tokenClaims(), SECRET);
    const env = { ...prod, RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    expect(await acceptToken(env, token, bind)).toBe(false);
  });

  it("accepts a valid token with the atomic D1 nonce store, then rejects its replay", async () => {
    const nonceDb = fakeNonceDb();
    const token = await signToken(tokenClaims(), SECRET);
    const env = { ...prod, RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES_DB: nonceDb } as never;
    expect(await acceptToken(env, token, bind)).toBe(true);
    expect(await acceptToken(env, token, bind)).toBe(false);
  });
});

describe("onRequestPost — PRODUCTION integrity gate (503, never a silent 204)", () => {
  const prod = { RESEARCH_ENVIRONMENT: "production" };

  it("refuses (503) when the token signing secret is missing", async () => {
    const { db, calls } = fakeDb();
    const res = await post(registryBody(), {
      ...prod,
      RESEARCH_DB: db,
      TURNSTILE_RESEARCH_SECRET: "cf",
      RESEARCH_NONCES_DB: fakeNonceDb(),
    });
    expect(res.status).toBe(503);
    expect(calls.length).toBe(0);
  });

  it("refuses (503) when Turnstile is not configured", async () => {
    const { db, calls } = fakeDb();
    const res = await post(registryBody(), {
      ...prod,
      RESEARCH_DB: db,
      RESEARCH_TOKEN_SECRET: SECRET,
      RESEARCH_NONCES_DB: fakeNonceDb(),
    });
    expect(res.status).toBe(503);
    expect(calls.length).toBe(0);
  });

  it("refuses (503) when only the raceable KV nonce store is available", async () => {
    const { db, calls } = fakeDb();
    const res = await post(registryBody(), {
      ...prod,
      RESEARCH_DB: db,
      RESEARCH_TOKEN_SECRET: SECRET,
      TURNSTILE_RESEARCH_SECRET: "cf",
      RESEARCH_NONCES: fakeKv(),
    });
    expect(res.status).toBe(503);
    expect(calls.length).toBe(0);
  });

  it("stores a fully-provisioned production contribution, then drops the replay", async () => {
    const nonceDb = fakeNonceDb();
    const token = await signToken(tokenClaims(), SECRET);
    const common = {
      ...prod,
      RESEARCH_TOKEN_SECRET: SECRET,
      TURNSTILE_RESEARCH_SECRET: "cf",
      RESEARCH_NONCES_DB: nonceDb,
    };
    const first = fakeDb();
    const r1 = await post({ ...registryBody(), token }, { ...common, RESEARCH_DB: first.db });
    expect(r1.status).toBe(204);
    expect(first.calls.length).toBeGreaterThan(0);

    const second = fakeDb();
    await post({ ...registryBody(), token }, { ...common, RESEARCH_DB: second.db });
    expect(second.calls.length).toBe(0); // replay dropped (nonce consumed)
  });
});
