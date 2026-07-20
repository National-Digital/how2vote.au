import { describe, expect, it } from "vitest";
import { D1NonceStore, KvNonceStore, MemoryNonceStore, type KVNamespace } from "./nonce-store";

describe("MemoryNonceStore — single-use", () => {
  it("consumes a nonce exactly once (replay returns false)", async () => {
    const store = new MemoryNonceStore();
    expect(await store.consume("abc", 300)).toBe(true);
    expect(await store.consume("abc", 300)).toBe(false);
    expect(await store.consume("abc", 300)).toBe(false);
  });

  it("treats distinct nonces independently", async () => {
    const store = new MemoryNonceStore();
    expect(await store.consume("a", 300)).toBe(true);
    expect(await store.consume("b", 300)).toBe(true);
  });
});

/** A tiny in-memory KV honouring get/put, recording the TTL used. */
function fakeKv() {
  const map = new Map<string, string>();
  const ttls: number[] = [];
  const kv: KVNamespace = {
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value, options) {
      map.set(key, value);
      if (options?.expirationTtl !== undefined) ttls.push(options.expirationTtl);
    },
  };
  return { kv, ttls, map };
}

describe("KvNonceStore — payload-free single-use over KV", () => {
  it("consumes once and rejects a replay", async () => {
    const { kv } = fakeKv();
    const store = new KvNonceStore(kv);
    expect(await store.consume("n1", 300)).toBe(true);
    expect(await store.consume("n1", 300)).toBe(false);
  });

  it("stores ONLY the prefixed nonce key and nothing else (payload-free)", async () => {
    const { kv, map } = fakeKv();
    const store = new KvNonceStore(kv);
    await store.consume("n1", 300);
    expect([...map.keys()]).toEqual(["nonce:n1"]);
    expect(map.get("nonce:n1")).toBe("1"); // no payload, just a marker
  });

  it("floors the retention TTL to KV's 60s minimum", async () => {
    const { kv, ttls } = fakeKv();
    const store = new KvNonceStore(kv);
    await store.consume("n1", 5);
    await store.consume("n2", 900);
    expect(ttls).toEqual([60, 900]);
  });
});

/** A tiny fake D1 honouring the used_nonce table with atomic INSERT … ON CONFLICT semantics. */
function fakeD1() {
  const rows = new Map<string, number>(); // nonce -> expires_at
  const db = {
    prepare(query: string) {
      const q = query.trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          bound = values;
          return stmt;
        },
        async run() {
          if (q.startsWith("CREATE TABLE")) return { meta: { changes: 0 } };
          if (q.startsWith("DELETE")) {
            const cutoff = bound[0] as number;
            for (const [k, exp] of rows) if (exp < cutoff) rows.delete(k);
            return { meta: { changes: 0 } };
          }
          // INSERT … ON CONFLICT DO NOTHING
          const [nonce, expiresAt] = bound as [string, number];
          if (rows.has(nonce)) return { meta: { changes: 0 } };
          rows.set(nonce, expiresAt);
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run: () => Promise<{ meta: { changes: number } }> }>) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
  return { db, rows };
}

describe("D1NonceStore — atomic single-use", () => {
  it("consumes a nonce exactly once (replay returns false)", async () => {
    const { db } = fakeD1();
    const store = new D1NonceStore(db as never);
    expect(await store.consume("tok", 300)).toBe(true);
    expect(await store.consume("tok", 300)).toBe(false);
    expect(await store.consume("tok", 300)).toBe(false);
  });

  it("treats distinct nonces independently", async () => {
    const { db } = fakeD1();
    const store = new D1NonceStore(db as never);
    expect(await store.consume("a", 300)).toBe(true);
    expect(await store.consume("b", 300)).toBe(true);
  });

  it("records the nonce with an expiry so it can be pruned", async () => {
    const { db, rows } = fakeD1();
    const store = new D1NonceStore(db as never);
    await store.consume("x", 300);
    expect(rows.has("x")).toBe(true);
    expect(rows.get("x")).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
