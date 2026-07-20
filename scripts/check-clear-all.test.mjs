import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  verdict,
  verifyCacheNamespace,
  verifyClearAllModule,
  verifyStorageNamespace,
} from "./check-clear-all.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => ({ path: rel, text: readFileSync(new URL(rel, root), "utf8") });
const has = (errors, needle) => errors.some((e) => e.includes(needle));

const GOOD_MODULE = {
  path: "local-data.ts",
  text: `
    export const STORAGE_KEY_PREFIX = "how2vote:";
    export const CACHE_NAME_PREFIX = "how2vote-";
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORAGE_KEY_PREFIX)) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(STORAGE_KEY_PREFIX)) sessionStorage.removeItem(k);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(CACHE_NAME_PREFIX)).map((n) => caches.delete(n)));
  `,
};

describe("verifyClearAllModule", () => {
  it("passes on a module that declares both prefixes and sweeps every area", () => {
    expect(verifyClearAllModule(GOOD_MODULE)).toEqual([]);
  });

  it("flags a module that forgets to sweep the caches", () => {
    const text = GOOD_MODULE.text.replace(/const names[\s\S]*$/, "");
    expect(has(verifyClearAllModule({ path: "m.ts", text }), "enumerate the Cache Storage")).toBe(
      true,
    );
  });

  it("flags a module that never touches sessionStorage", () => {
    const text = GOOD_MODULE.text.replace(
      /for \(const k of Object.keys\(sessionStorage\)[^\n]*\n/,
      "",
    );
    expect(has(verifyClearAllModule({ path: "m.ts", text }), "sessionStorage")).toBe(true);
  });

  it("flags a wrong prefix constant", () => {
    const text = GOOD_MODULE.text.replace('"how2vote:"', '"h2v:"');
    expect(has(verifyClearAllModule({ path: "m.ts", text }), "STORAGE_KEY_PREFIX")).toBe(true);
  });

  it("fails closed when the module cannot be read", () => {
    expect(has(verifyClearAllModule(null), "could not read")).toBe(true);
  });
});

describe("verifyStorageNamespace", () => {
  it("passes on direct literals, KEY consts and key-builders under the namespace", () => {
    const sources = [
      { path: "a.ts", text: 'localStorage.getItem("how2vote:age-ok:v1");' },
      { path: "b.ts", text: 'const KEY = "how2vote:saved:v1";\nlocalStorage.setItem(KEY, x);' },
      {
        path: "c.ts",
        text: 'const KEY_PREFIX = "how2vote:quiz:v2:";\nconst key = (id) => KEY_PREFIX + id;\nlocalStorage.removeItem(key(id));',
      },
      // Cross-file import: the const lives in one file, the call in another.
      { path: "reg.ts", text: 'export const CONSENT_STORAGE_KEY = "how2vote:consent:v1";' },
      { path: "use.ts", text: "localStorage.getItem(CONSENT_STORAGE_KEY);" },
    ];
    expect(verifyStorageNamespace(sources)).toEqual([]);
  });

  it("flags a raw literal key outside the namespace", () => {
    expect(
      has(
        verifyStorageNamespace([{ path: "a.ts", text: 'localStorage.setItem("theme", x);' }]),
        'outside the "how2vote:" namespace',
      ),
    ).toBe(true);
  });

  it("flags a KEY const bound outside the namespace", () => {
    expect(
      has(
        verifyStorageNamespace([
          { path: "a.ts", text: 'const KEY = "prefs:theme";\nlocalStorage.setItem(KEY, x);' },
        ]),
        'outside the "how2vote:" namespace',
      ),
    ).toBe(true);
  });

  it("flags a key it cannot resolve (fail closed)", () => {
    expect(
      has(
        verifyStorageNamespace([{ path: "a.ts", text: "localStorage.setItem(computeKey(), x);" }]),
        "cannot resolve",
      ),
    ).toBe(true);
  });

  it("ignores localStorage keys mentioned only in comments", () => {
    expect(
      verifyStorageNamespace([
        { path: "a.ts", text: '// localStorage.setItem("former:key", x) — removed\nconst y = 1;' },
      ]),
    ).toEqual([]);
  });
});

describe("verifyCacheNamespace", () => {
  it("passes when the cache name is a prefixed template literal", () => {
    expect(
      verifyCacheNamespace({
        path: "sw.ts",
        text: "const CACHE = `how2vote-${version}`;\ncaches.open(CACHE);",
      }),
    ).toEqual([]);
  });

  it("flags a cache name outside the namespace", () => {
    expect(
      has(
        verifyCacheNamespace({ path: "sw.ts", text: "const CACHE = `assets-${version}`;" }),
        'outside the "how2vote-" namespace',
      ),
    ).toBe(true);
  });

  it("flags a stray caches.open on an unprefixed literal", () => {
    expect(
      has(
        verifyCacheNamespace({
          path: "sw.ts",
          text: 'const CACHE = `how2vote-${v}`;\ncaches.open("scratch");',
        }),
        'opens a cache "scratch"',
      ),
    ).toBe(true);
  });

  it("fails closed when the service worker cannot be read", () => {
    expect(has(verifyCacheNamespace(undefined), "could not read")).toBe(true);
  });
});

describe("real committed artefacts — smoke test", () => {
  // The stores that hold every on-device key today, plus the clear-all module and the service worker.
  const storageSources = [
    "apps/web/src/lib/quiz.svelte.ts",
    "apps/web/src/lib/saved.svelte.ts",
    "apps/web/src/lib/terms.svelte.ts",
    "apps/web/src/lib/election.svelte.ts",
    "apps/web/src/lib/theme.svelte.ts",
    "apps/web/src/lib/age.svelte.ts",
    "apps/web/src/lib/privacy/registry.ts",
    "apps/web/src/lib/privacy/consent.svelte.ts",
    "apps/web/src/lib/privacy/local-data.ts",
  ].map(read);

  it("the committed sources satisfy every clear-all invariant", () => {
    const result = verdict({
      clearAllModule: read("apps/web/src/lib/privacy/local-data.ts"),
      storageSources,
      serviceWorker: read("apps/web/src/service-worker.ts"),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
