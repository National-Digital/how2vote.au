import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NativeStorage from "./native-storage";

/**
 * native-storage.ts, evaluated as a NATIVE build.
 *
 * The durable mirror exists because WebKit evicts WebView localStorage; the hazard is that a restore
 * cannot tell an eviction from a deletion the user asked for. Both look like "missing from
 * localStorage", so a naive heal resurrects cleared data — and once healed the key is live again, so
 * no later prune removes it. These tests pin the three defences: the eligibility bit is never
 * mirrored, deletions write through, and the backup pass prunes before it writes.
 *
 * Every case has to run on a native channel. On the web every accessor is null, so an assertion that
 * "nothing was resurrected" would pass without the code doing anything at all.
 */
const CAPACITOR = "Capacitor";
const AGE_KEY = "how2vote:age-ok:v1";
const QUIZ_KEY = "how2vote:quiz:v2:2025";
const SAVED_KEY = "how2vote:saved:v1";

/** Records every Preferences operation in order, so the prune-before-write ordering is assertable. */
type Ops = { op: "set" | "remove"; key: string }[];

function installBridge(initial: Record<string, string>): { store: Map<string, string>; ops: Ops } {
  const store = new Map(Object.entries(initial));
  const ops: Ops = [];
  (globalThis as Record<string, unknown>)[CAPACITOR] = {
    Plugins: {
      Preferences: {
        get: ({ key }: { key: string }) => Promise.resolve({ value: store.get(key) ?? null }),
        set: ({ key, value }: { key: string; value: string }) => {
          ops.push({ op: "set", key });
          store.set(key, value);
          return Promise.resolve();
        },
        remove: ({ key }: { key: string }) => {
          ops.push({ op: "remove", key });
          store.delete(key);
          return Promise.resolve();
        },
        keys: () => Promise.resolve({ keys: [...store.keys()] }),
      },
    },
  };
  return { store, ops };
}

function installLocalStorage(initial: Record<string, string>): Map<string, string> {
  const map = new Map(Object.entries(initial));
  (globalThis as Record<string, unknown>).localStorage = {
    get length(): number {
      return map.size;
    },
    key: (i: number): string | null => [...map.keys()][i] ?? null,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => void map.set(k, v),
    removeItem: (k: string): void => void map.delete(k),
    clear: (): void => map.clear(),
  };
  return map;
}

async function load(): Promise<typeof NativeStorage> {
  vi.doMock("$env/dynamic/public", () => ({ env: { PUBLIC_DIST_CHANNEL: "android" } }));
  return import("./native-storage");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[CAPACITOR];
  delete (globalThis as Record<string, unknown>).localStorage;
  vi.doUnmock("$env/dynamic/public");
});

describe("the 18+ eligibility bit is outside the durable mirror", () => {
  it("is never written to Preferences, however long the session holds it", async () => {
    const { ops, store } = installBridge({});
    installLocalStorage({ [AGE_KEY]: "1", [QUIZ_KEY]: "{}" });
    const { backupToNative } = await load();

    await backupToNative();

    expect(store.has(AGE_KEY)).toBe(false);
    expect(ops.filter((o) => o.key === AGE_KEY && o.op === "set")).toHaveLength(0);
    // The durability the mirror does exist for is unaffected.
    expect(store.get(QUIZ_KEY)).toBe("{}");
  });

  it("is retired from Preferences if an earlier build mirrored it", async () => {
    const { store } = installBridge({ [AGE_KEY]: "1" });
    installLocalStorage({ [AGE_KEY]: "1" });
    const { backupToNative } = await load();

    await backupToNative();

    expect(store.has(AGE_KEY)).toBe(false);
  });

  it("is not healed on restore, so a minor's declaration cannot be undone", async () => {
    installBridge({ [AGE_KEY]: "1", [QUIZ_KEY]: "{}" });
    // The state right after declareMinor(): localStorage cleared, a stale durable copy still there.
    const local = installLocalStorage({});
    const { restoreFromNative } = await load();

    await restoreFromNative();

    expect(local.has(AGE_KEY)).toBe(false);
  });
});

describe("restore heals evictions only", () => {
  it("copies back a namespaced key that localStorage is missing", async () => {
    installBridge({ [QUIZ_KEY]: '{"answers":1}' });
    const local = installLocalStorage({});
    const { restoreFromNative } = await load();

    await restoreFromNative();

    expect(local.get(QUIZ_KEY)).toBe('{"answers":1}');
  });

  it("never clobbers a value the live session already holds", async () => {
    installBridge({ [QUIZ_KEY]: "stale" });
    const local = installLocalStorage({ [QUIZ_KEY]: "live" });
    const { restoreFromNative } = await load();

    await restoreFromNative();

    expect(local.get(QUIZ_KEY)).toBe("live");
  });

  it("ignores keys outside the how2vote namespace", async () => {
    installBridge({ "someone-elses:key": "x" });
    const local = installLocalStorage({});
    const { restoreFromNative } = await load();

    await restoreFromNative();

    expect(local.has("someone-elses:key")).toBe(false);
  });
});

describe("deletions write through to the durable copy", () => {
  it("removes the named namespaced keys", async () => {
    const { store } = installBridge({ [QUIZ_KEY]: "{}", [SAVED_KEY]: "[]" });
    installLocalStorage({});
    const { removeFromNative } = await load();

    await removeFromNative([QUIZ_KEY]);

    expect(store.has(QUIZ_KEY)).toBe(false);
    expect(store.has(SAVED_KEY)).toBe(true);
  });

  it("refuses a key outside the namespace, so it can never clear a foreign one", async () => {
    const { store } = installBridge({ "someone-elses:key": "x" });
    installLocalStorage({});
    const { removeFromNative } = await load();

    await removeFromNative(["someone-elses:key"]);

    expect(store.has("someone-elses:key")).toBe(true);
  });

  it("leaves nothing for a restore to resurrect after a clear", async () => {
    const { store } = installBridge({ [SAVED_KEY]: "[card]" });
    const local = installLocalStorage({ [SAVED_KEY]: "[card]" });
    const { removeFromNative, restoreFromNative } = await load();

    // What saved.clear() does: drop the local key, then write through.
    local.delete(SAVED_KEY);
    await removeFromNative([SAVED_KEY]);
    await restoreFromNative();

    expect(store.has(SAVED_KEY)).toBe(false);
    expect(local.has(SAVED_KEY)).toBe(false);
  });
});

describe("the backup pass prunes before it writes", () => {
  it("orders every remove ahead of every set, so a truncated pass still deletes", async () => {
    // An orphan to prune plus live keys to write: if writes came first, a pass cut short after the
    // first await would have re-mirrored kept data and left the orphan behind.
    const { ops } = installBridge({ [SAVED_KEY]: "orphan", [QUIZ_KEY]: "old" });
    installLocalStorage({ [QUIZ_KEY]: "new", "how2vote:theme": "dark" });
    const { backupToNative } = await load();

    await backupToNative();

    const lastRemove = ops.findLastIndex((o) => o.op === "remove");
    const firstSet = ops.findIndex((o) => o.op === "set");
    expect(lastRemove).toBeGreaterThanOrEqual(0);
    expect(firstSet).toBeGreaterThanOrEqual(0);
    expect(lastRemove).toBeLessThan(firstSet);
  });

  it("drops an orphan whose localStorage counterpart is gone", async () => {
    const { store } = installBridge({ [SAVED_KEY]: "orphan" });
    installLocalStorage({ [QUIZ_KEY]: "{}" });
    const { backupToNative } = await load();

    await backupToNative();

    expect(store.has(SAVED_KEY)).toBe(false);
    expect(store.get(QUIZ_KEY)).toBe("{}");
  });
});

describe("the web PWA is untouched", () => {
  it("does nothing at all when the channel is web", async () => {
    const { store } = installBridge({ [QUIZ_KEY]: "durable" });
    const local = installLocalStorage({});
    vi.doMock("$env/dynamic/public", () => ({ env: {} }));
    const { restoreFromNative, backupToNative, removeFromNative } =
      await import("./native-storage");

    await restoreFromNative();
    await backupToNative();
    await removeFromNative([QUIZ_KEY]);

    expect(local.size).toBe(0);
    expect(store.get(QUIZ_KEY)).toBe("durable");
  });
});
