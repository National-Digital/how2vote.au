import { describe, expect, it, vi } from "vitest";

// Pin an explicitly un-suspended control plane so these ingestion-logic tests are independent of the
// live kill-switch state (research intake is currently live after the 2026-07-19 sign-off; a future
// re-suspension must not turn these logic tests red). The fail-closed closed-intake behaviour is
// asserted in src/lib/research/registry.test.ts.
vi.mock("../../../../../data/governance/control-plane.json", () => ({
  default: {
    schemaVersion: 1,
    suspensions: [],
    integrity: "sha256-284295c891854ce87d99ec3e98e66f48d542cba2008375a321497ac11d21b8ce",
  },
}));
import { acceptToken, clean, cleanElectorate, onRequestPost, store } from "./geography";
import { newNonce, signToken, type TokenClaims } from "../../../src/lib/research/token";

const base = () => ({ schemaVersion: 1, electionId: "2025", electorate: "Bennelong" });

describe("cleanElectorate", () => {
  it("accepts real division-name shapes", () => {
    expect(cleanElectorate("Bennelong")).toBe("Bennelong");
    expect(cleanElectorate("Eden-Monaro")).toBe("Eden-Monaro");
    expect(cleanElectorate("O'Connor")).toBe("O'Connor");
  });
  it("rejects off-shape or unsafe values", () => {
    expect(cleanElectorate("<script>alert(1)</script>")).toBeNull();
    expect(cleanElectorate("A")).toBeNull(); // too short
    expect(cleanElectorate("x".repeat(41))).toBeNull(); // too long
    expect(cleanElectorate("Robertson; DROP TABLE")).toBeNull();
    expect(cleanElectorate(123)).toBeNull();
  });
});

describe("clean", () => {
  it("accepts a valid geography ping", () => {
    const out = clean(base());
    expect(out).toEqual({ electionId: "2025", electorate: "Bennelong" });
  });
  it("rejects non-objects, a wrong schema version, and off-shape values", () => {
    expect(clean(null)).toBeNull();
    expect(clean({ ...base(), schemaVersion: 5 })).toBeNull();
    expect(clean({ ...base(), electorate: "not a division!" })).toBeNull();
    expect(clean({ ...base(), electionId: "" })).toBeNull();
  });
  it("carries no field other than election id + electorate", () => {
    const out = clean({ ...base(), state: "NSW", answers: [{ id: 1 }] }) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["electionId", "electorate"]);
  });
});

function fakeDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind(...values: unknown[]) {
        calls.push({ sql, binds: values });
        return this;
      },
      run: async () => ({}),
    }),
  };
  return { db, calls };
}

describe("store", () => {
  it("increments the aggregate counter for (election, electorate) and nothing else", async () => {
    const { db, calls } = fakeDb();
    await store(db as never, { electionId: "2025", electorate: "Bennelong" });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO geography_count/);
    expect(calls[0].sql).toMatch(/ON CONFLICT/);
    expect(calls[0].binds).toEqual(["2025", "Bennelong"]);
  });
});

// —— Registry + token integration ——————————————————————————————————————

const SECRET = "test-token-secret";

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

function geoClaims(overrides: Partial<TokenClaims> = {}): TokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    electionId: "2025",
    schemaVersion: 1,
    consentVersion: "2026-07.2",
    purpose: "geography",
    nonce: newNonce(),
    issuedAt: now,
    expiresAt: now + 300,
    ...overrides,
  };
}

async function post(body: unknown, env: Record<string, unknown>): Promise<Response> {
  const request = new Request("https://how2vote.au/api/research/geography", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Default to a NON-production deployment (inert layer) unless a case sets the marker; a bound
  // RESEARCH_DB with no marker is otherwise treated as production and fails closed (503).
  return onRequestPost({ request, env: { RESEARCH_ENVIRONMENT: "test", ...env } } as never);
}

/** Fake ATOMIC D1 nonce store (RESEARCH_NONCES_DB): first insert reports changes === 1, replay 0. */
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
  it("stores a valid ping to an open election when the layer is inert", async () => {
    const { db, calls } = fakeDb();
    await post(base(), { RESEARCH_DB: db });
    expect(calls.length).toBe(1);
  });

  it("drops a ping to an unknown election", async () => {
    const { db, calls } = fakeDb();
    await post({ ...base(), electionId: "1901" }, { RESEARCH_DB: db });
    expect(calls.length).toBe(0);
  });
});

describe("acceptToken — geography single-use token", () => {
  it("is inert without a secret", async () => {
    expect(await acceptToken({} as never, undefined, "2025")).toBe(true);
  });

  it("accepts a valid geography token once, rejects the replay", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    const token = await signToken(geoClaims(), SECRET);
    expect(await acceptToken(env, token, "2025")).toBe(true);
    expect(await acceptToken(env, token, "2025")).toBe(false);
  });

  it("rejects a research-purpose token on the geography endpoint (unlinkable tokens)", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    const research = await signToken(geoClaims({ purpose: "research" }), SECRET);
    expect(await acceptToken(env, research, "2025")).toBe(false);
  });

  it("fails closed when the secret is set but no nonce store is bound", async () => {
    const env = { RESEARCH_TOKEN_SECRET: SECRET } as never;
    const token = await signToken(geoClaims(), SECRET);
    expect(await acceptToken(env, token, "2025")).toBe(false);
  });

  it("drops a token-less ping end-to-end when the layer is enabled", async () => {
    const { db, calls } = fakeDb();
    await post(base(), {
      RESEARCH_DB: db,
      RESEARCH_TOKEN_SECRET: SECRET,
      RESEARCH_NONCES: fakeKv(),
    });
    expect(calls.length).toBe(0);
  });
});

// —— PRODUCTION fail-closed behaviour (mirrors research.ts) ————————————————————————

describe("acceptToken — PRODUCTION fails closed", () => {
  const prod = { RESEARCH_ENVIRONMENT: "production" };

  it("does NOT accept just because the signing secret is missing (was fail-open → now closed)", async () => {
    expect(await acceptToken({ ...prod } as never, undefined, "2025")).toBe(false);
  });

  it("rejects when only the non-atomic KV nonce store is available (atomic D1 required)", async () => {
    const token = await signToken(geoClaims(), SECRET);
    const env = { ...prod, RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES: fakeKv() } as never;
    expect(await acceptToken(env, token, "2025")).toBe(false);
  });

  it("accepts a valid token with the atomic D1 nonce store, then rejects its replay", async () => {
    const nonceDb = fakeNonceDb();
    const token = await signToken(geoClaims(), SECRET);
    const env = { ...prod, RESEARCH_TOKEN_SECRET: SECRET, RESEARCH_NONCES_DB: nonceDb } as never;
    expect(await acceptToken(env, token, "2025")).toBe(true);
    expect(await acceptToken(env, token, "2025")).toBe(false);
  });
});

describe("onRequestPost — PRODUCTION integrity gate (503, never a silent 204)", () => {
  const prod = { RESEARCH_ENVIRONMENT: "production" };

  it("refuses (503) when a mandatory integrity control is missing", async () => {
    const { db, calls } = fakeDb();
    // Missing Turnstile secret.
    const res = await post(base(), {
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
    const res = await post(base(), {
      ...prod,
      RESEARCH_DB: db,
      RESEARCH_TOKEN_SECRET: SECRET,
      TURNSTILE_RESEARCH_SECRET: "cf",
      RESEARCH_NONCES: fakeKv(),
    });
    expect(res.status).toBe(503);
    expect(calls.length).toBe(0);
  });

  it("stores a fully-provisioned production ping, then drops the replay", async () => {
    const nonceDb = fakeNonceDb();
    const token = await signToken(geoClaims(), SECRET);
    const common = {
      ...prod,
      RESEARCH_TOKEN_SECRET: SECRET,
      TURNSTILE_RESEARCH_SECRET: "cf",
      RESEARCH_NONCES_DB: nonceDb,
    };
    const first = fakeDb();
    const r1 = await post({ ...base(), token }, { ...common, RESEARCH_DB: first.db });
    expect(r1.status).toBe(204);
    expect(first.calls.length).toBe(1);

    const second = fakeDb();
    await post({ ...base(), token }, { ...common, RESEARCH_DB: second.db });
    expect(second.calls.length).toBe(0); // replay dropped
  });
});
