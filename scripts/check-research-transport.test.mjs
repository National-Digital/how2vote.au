import { readFileSync, readdirSync } from "node:fs";
import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUNCTION_FILES,
  SHARED_REQUEST_MODULES,
  readCodePolicy,
  scanForbiddenReads,
  scanRequestLogging,
  verdict,
} from "./check-research-transport.mjs";

const repoFile = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const clone = (o) => JSON.parse(JSON.stringify(o));

const TRANSPORT_POLICY_TS = `
  export const RESEARCH_ENDPOINTS = {
    research: "/api/research",
    geography: "/api/research/geography",
    token: "/api/research/token",
  } as const;
  export const FORBIDDEN_REQUEST_READS = ["CF-Connecting-IP", "X-Forwarded-For", "User-Agent"] as const;
  export const RESEARCH_TRANSPORT_POLICY = Object.freeze({
    cache: "no-store",
    credentials: "omit",
  });
`;

const INFRA = {
  ingestionRoutes: ["/api/research", "/api/research/geography", "/api/research/token"],
  requiredEdgeSettings: {
    alwaysUseHttps: true,
    minTlsVersion: "1.2",
    hsts: { enabled: true },
    requestBodyLogging: false,
    logpushIncludesRequestBody: false,
    cacheIngestionResponses: false,
  },
  forbiddenRequestReads: ["CF-Connecting-IP", "X-Forwarded-For", "User-Agent"],
};

const GOOD_SURVEY = `
  import { RESEARCH_ENDPOINTS, transportInit } from "./research/transport-policy";
  await fetch(RESEARCH_ENDPOINTS[endpoint], transportInit(endpoint, payload));
`;

const CLEAN_FUNCTION = {
  path: "functions/api/research.ts",
  text: `
    // CF-Connecting-IP is never read here.
    export const onRequestPost = async ({ request }) => {
      const text = await request.text();
      return new Response(null, { status: 204 });
    };
  `,
};

const base = () => ({
  ingestionFiles: [CLEAN_FUNCTION, { path: "survey.ts", text: GOOD_SURVEY }],
  functionFiles: [CLEAN_FUNCTION],
  surveyText: GOOD_SURVEY,
  transportPolicyText: TRANSPORT_POLICY_TS,
  infraPolicy: clone(INFRA),
});

describe("scanForbiddenReads", () => {
  it("detects a real IP header read but not a comment", () => {
    const hits = scanForbiddenReads(
      [
        { path: "a.ts", text: `const ip = request.headers.get("CF-Connecting-IP");` },
        { path: "b.ts", text: `// we never call .get("cf-connecting-ip")` },
        { path: "c.ts", text: `const x = request.ip;` },
      ],
      ["CF-Connecting-IP"],
    );
    expect(hits.map((h) => h.path).sort()).toEqual(["a.ts", "c.ts"]);
  });
});

describe("scanRequestLogging", () => {
  it("detects a console call in a Function", () => {
    const hits = scanRequestLogging([{ path: "f.ts", text: `console.log(request)` }]);
    expect(hits).toHaveLength(1);
  });
  it("ignores a console call inside a comment", () => {
    const hits = scanRequestLogging([{ path: "f.ts", text: `// console.log(request)` }]);
    expect(hits).toHaveLength(0);
  });
});

describe("readCodePolicy", () => {
  it("extracts endpoints, cache, credentials and forbidden reads", () => {
    const p = readCodePolicy(TRANSPORT_POLICY_TS);
    expect(p.endpoints.research).toBe("/api/research");
    expect(p.cache).toBe("no-store");
    expect(p.credentials).toBe("omit");
    expect(p.forbiddenReads).toContain("CF-Connecting-IP");
  });
});

describe("verdict", () => {
  it("passes on a clean, consistent set", () => {
    expect(verdict(base())).toEqual({ ok: true, errors: [] });
  });

  it("fails if a Function reads the client IP", () => {
    const input = base();
    const bad = {
      path: "functions/api/research.ts",
      text: `const ip = request.headers.get("CF-Connecting-IP");`,
    };
    input.functionFiles = [bad];
    input.ingestionFiles = [bad, { path: "survey.ts", text: GOOD_SURVEY }];
    expect(verdict(input).errors.some((e) => /forbidden request attribute/.test(e))).toBe(true);
  });

  it("fails if a Function logs (any console call)", () => {
    const input = base();
    const bad = { path: "functions/api/research.ts", text: `console.error(await request.text())` };
    input.functionFiles = [bad];
    input.ingestionFiles = [bad, { path: "survey.ts", text: GOOD_SURVEY }];
    expect(verdict(input).errors.some((e) => /must log nothing/.test(e))).toBe(true);
  });

  it("fails if the client hand-rolls a fetch init", () => {
    const input = base();
    input.surveyText = `await fetch(url, { method: "POST", body: JSON.stringify(payload) });`;
    input.ingestionFiles = [CLEAN_FUNCTION, { path: "survey.ts", text: input.surveyText }];
    const r = verdict(input);
    expect(r.errors.some((e) => /hand-rolls a fetch init/.test(e))).toBe(true);
  });

  it("fails a weak edge setting (request-body logging enabled)", () => {
    const input = base();
    input.infraPolicy.requiredEdgeSettings.requestBodyLogging = true;
    expect(verdict(input).errors.some((e) => /requestBodyLogging/.test(e))).toBe(true);
  });

  it("fails when HTTPS is not forced", () => {
    const input = base();
    input.infraPolicy.requiredEdgeSettings.alwaysUseHttps = false;
    expect(verdict(input).errors.some((e) => /alwaysUseHttps/.test(e))).toBe(true);
  });

  it("fails when infra omits a code endpoint route", () => {
    const input = base();
    input.infraPolicy.ingestionRoutes = ["/api/research"];
    expect(verdict(input).errors.some((e) => /ingestionRoutes missing/.test(e))).toBe(true);
  });

  it("catches a forbidden read introduced in a shared request-path module", () => {
    const input = base();
    const bad = {
      path: "apps/web/src/lib/research/cors.ts",
      text: `export const h = (request) => request.headers.get("CF-Connecting-IP");`,
    };
    input.functionFiles = [CLEAN_FUNCTION, bad];
    input.ingestionFiles = [...input.functionFiles, { path: "survey.ts", text: GOOD_SURVEY }];
    expect(
      verdict(input).errors.some(
        (e) => /research\/cors\.ts/.test(e) && /forbidden request attribute/.test(e),
      ),
    ).toBe(true);
  });

  it("catches a log introduced in a shared request-path module", () => {
    const input = base();
    const bad = {
      path: "apps/web/src/lib/research/cors.ts",
      text: `export const h = (request) => { console.warn(request.url); };`,
    };
    input.functionFiles = [CLEAN_FUNCTION, bad];
    input.ingestionFiles = [...input.functionFiles, { path: "survey.ts", text: GOOD_SURVEY }];
    expect(
      verdict(input).errors.some((e) => /research\/cors\.ts/.test(e) && /must log nothing/.test(e)),
    ).toBe(true);
  });
});

// Coverage of the scanned set itself: the CLI can only prove an invariant about files it reads, so a
// request-path module left off the list is a blind spot the verdict tests above cannot detect.
describe("scanned set", () => {
  const scanned = [...FUNCTION_FILES, ...SHARED_REQUEST_MODULES];

  it("includes every Pages Function under functions/api", () => {
    // Enumerated from disk, so a new endpoint cannot escape the scan by simply not being listed.
    const dir = new URL("../apps/web/functions/", import.meta.url);
    const onDisk = readdirSync(dir, { recursive: true })
      .map((p) => `apps/web/functions/${String(p).split(sep).join("/")}`)
      .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
    expect(onDisk.length).toBeGreaterThan(0);
    expect(scanned.filter((p) => p.startsWith("apps/web/functions/")).sort()).toEqual(
      onDisk.sort(),
    );
  });

  it("includes every shared module a scanned Function imports that touches the Request", () => {
    const required = new Set();
    for (const fn of FUNCTION_FILES) {
      const text = repoFile(fn);
      for (const m of text.matchAll(/from\s+["'](?:\.\.\/)+src\/(lib\/[^"']+)["']/g)) {
        const rel = `apps/web/src/${m[1]}.ts`;
        // Only modules that see the Request can read a header or log about one.
        if (/\bRequest\b|\.headers\b/.test(repoFile(rel))) required.add(rel);
      }
    }
    expect(required.size).toBeGreaterThan(0);
    for (const rel of required) expect(scanned).toContain(rel);
  });

  it("the real request-path files are clean under both scans", () => {
    const files = scanned.map((p) => ({ path: p, text: repoFile(p) }));
    expect(
      scanForbiddenReads(files, ["CF-Connecting-IP", "X-Forwarded-For", "User-Agent"]),
    ).toEqual([]);
    expect(scanRequestLogging(files)).toEqual([]);
  });
});
