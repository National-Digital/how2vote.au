import { describe, expect, it } from "vitest";
import {
  readCodePolicy,
  scanForbiddenReads,
  scanRequestLogging,
  verdict,
} from "./check-research-transport.mjs";

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
});
