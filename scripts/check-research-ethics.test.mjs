import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractConsentVersion,
  extractStringSet,
  extractSurveyKeys,
  normalisePageText,
  parseIsoDate,
  verdict,
} from "./check-research-ethics.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const REGISTER = JSON.parse(read("docs/research/standards-register.json"));
const SURVEY_SRC = read("apps/web/src/lib/survey.ts");
const CONSENT_SRC = read("apps/web/src/lib/research/consent.ts");
const STATS_SRC = read("packages/data-pipeline/src/stats.ts");
const PAGE_PATHS = [
  "apps/web/src/routes/insights/+page.svelte",
  "apps/web/src/routes/privacy/+page.svelte",
  "apps/web/src/routes/survey/+page.svelte",
  "apps/web/src/routes/terms/+page.svelte",
];
const PAGES = Object.fromEntries(PAGE_PATHS.map((p) => [p, read(p)]));

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));
const clone = (o) => JSON.parse(JSON.stringify(o));

const baseInput = () => ({
  register: REGISTER,
  surveySensitive: extractStringSet(SURVEY_SRC, "SENSITIVE_DIMENSIONS"),
  statsSensitive: extractStringSet(STATS_SRC, "SENSITIVE_DIMENSIONS"),
  surveyKeys: extractSurveyKeys(SURVEY_SRC),
  consentVersion: extractConsentVersion(CONSENT_SRC),
  surveyPageText: PAGES["apps/web/src/routes/survey/+page.svelte"],
  pages: PAGES,
});

describe("verdict — real committed register + sources + pages", () => {
  it("passes on the real register bound to the real survey/stats/pages", () => {
    const res = verdict(baseInput());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("source extractors", () => {
  it("reads SENSITIVE_DIMENSIONS from both survey.ts and stats.ts and they agree", () => {
    const s = extractStringSet(SURVEY_SRC, "SENSITIVE_DIMENSIONS");
    const t = extractStringSet(STATS_SRC, "SENSITIVE_DIMENSIONS");
    expect(s).not.toBeNull();
    expect(s).toEqual(t);
    expect(s).toContain("indigenous");
  });

  it("reads every survey question key incl. indigenous", () => {
    const keys = extractSurveyKeys(SURVEY_SRC);
    expect(keys.has("indigenous")).toBe(true);
    expect(keys.has("age")).toBe(true);
  });

  it("reads RESEARCH_CONSENT_VERSION matching the register", () => {
    expect(extractConsentVersion(CONSENT_SRC)).toBe(REGISTER.consentVersion);
  });
});

describe("verdict — prefer-not-to-say", () => {
  it("fails if appliesToEverySensitiveItem is not true", () => {
    const register = clone(REGISTER);
    register.preferNotToSay.appliesToEverySensitiveItem = false;
    expect(hasError(verdict({ ...baseInput(), register }), "appliesToEverySensitiveItem")).toBe(
      true,
    );
  });

  it("fails if sensitiveItems drift from survey.ts SENSITIVE_DIMENSIONS", () => {
    const res = verdict({ ...baseInput(), surveySensitive: ["age", "gender"] });
    expect(hasError(res, "survey.ts SENSITIVE_DIMENSIONS")).toBe(true);
  });

  it("fails if sensitiveItems drift from stats.ts SENSITIVE_DIMENSIONS", () => {
    const res = verdict({ ...baseInput(), statsSensitive: ["age"] });
    expect(hasError(res, "stats.ts SENSITIVE_DIMENSIONS")).toBe(true);
  });

  it("fails if a sensitive item is not a real survey question", () => {
    const register = clone(REGISTER);
    register.preferNotToSay.sensitiveItems = [...register.preferNotToSay.sensitiveItems, "salary"];
    // also drift the survey/stats sensitive sets to match so the mismatch under test is the key one
    const res = verdict({
      ...baseInput(),
      register,
      surveySensitive: register.preferNotToSay.sensitiveItems,
      statsSensitive: register.preferNotToSay.sensitiveItems,
    });
    expect(hasError(res, 'sensitive item "salary" is not a survey question key')).toBe(true);
  });

  it("fails if the survey page loses the generic prefer-not-to-say control", () => {
    const res = verdict({
      ...baseInput(),
      surveyPageText: "<button onclick={skip}>Skip research and build my voting plan</button>",
    });
    expect(hasError(res, "generic prefer-not-to-say control")).toBe(true);
  });
});

describe("verdict — voluntariness", () => {
  it("fails if researchNeverRequiredForCoreUse is not true", () => {
    const register = clone(REGISTER);
    register.voluntariness.researchNeverRequiredForCoreUse = false;
    expect(hasError(verdict({ ...baseInput(), register }), "researchNeverRequiredForCoreUse")).toBe(
      true,
    );
  });

  it("fails if the survey Skip button becomes disabled/gated", () => {
    const gated =
      'function skip(){ goto("/card"); }\n<button disabled={!consented} onclick={skip}>Skip research and build my voting plan</button>' +
      '\n<button onclick={() => choose(current.key, "")}>Prefer not to say</button>{/each}';
    const res = verdict({ ...baseInput(), surveyPageText: gated });
    expect(hasError(res, "Skip button is disabled")).toBe(true);
  });

  it("fails if there is no skip() to the core output", () => {
    const noSkip =
      '<button onclick={contribute}>Contribute</button>\n<button onclick={() => choose(current.key, "")}>Prefer not to say</button>{/each}';
    const res = verdict({ ...baseInput(), surveyPageText: noSkip });
    expect(hasError(res, "skip() navigating to the core output")).toBe(true);
  });
});

describe("verdict — AIATSIS applicability", () => {
  it("fails if the register denies Indigenous collection while the survey collects it", () => {
    const register = clone(REGISTER);
    register.indigenousStatusCollected = false;
    expect(hasError(verdict({ ...baseInput(), register }), "does not match the survey")).toBe(true);
  });

  it("requires AIATSIS evidence when Indigenous status is collected", () => {
    const register = clone(REGISTER);
    const aiatsis = register.standards.find((s) => s.id === "AIATSIS-CODE");
    aiatsis.evidence = [];
    expect(
      hasError(verdict({ ...baseInput(), register }), "Indigenous data-governance evidence"),
    ).toBe(true);
  });
});

describe("verdict — standards structure + evidence ratchet", () => {
  it("fails when a required standard family is missing", () => {
    const register = clone(REGISTER);
    register.standards = register.standards.filter((s) => s.id !== "NATIONAL-STATEMENT-2025");
    expect(hasError(verdict({ ...baseInput(), register }), "missing required standard")).toBe(true);
  });

  it("fails closed if a standard is marked implemented with pending evidence (ethics stays pending)", () => {
    const register = clone(REGISTER);
    const ns = register.standards.find((s) => s.id === "NATIONAL-STATEMENT-2025");
    ns.status = "implemented";
    ns.evidence[0].status = "pending"; // implemented cannot rest on pending evidence
    expect(
      hasError(verdict({ ...baseInput(), register }), "requires all evidence current/not-required"),
    ).toBe(true);
  });

  it("fails when evidence is expired", () => {
    const register = clone(REGISTER);
    register.standards.find((s) => s.id === "AIATSIS-CODE").evidence[0].status = "expired";
    expect(hasError(verdict({ ...baseInput(), register }), "expired")).toBe(true);
  });

  it("fails when current evidence lacks a reviewer/dates", () => {
    const register = clone(REGISTER);
    const ev = register.standards.find((s) => s.id === "AIATSIS-CODE").evidence[0];
    ev.status = "current";
    delete ev.reviewer;
    delete ev.approvedAt;
    delete ev.expiresAt;
    const res = verdict({ ...baseInput(), register });
    expect(hasError(res, "current evidence needs a reviewer")).toBe(true);
  });
});

describe("verdict — consent-version binding", () => {
  it("fails when the register consentVersion lags survey.ts", () => {
    const res = verdict({ ...baseInput(), consentVersion: "9999-01.9" });
    expect(hasError(res, "RESEARCH_CONSENT_VERSION")).toBe(true);
  });
});

describe("verdict — page binding (Insights warnings + consent statements)", () => {
  it("fails when an Insights warning is absent from the page", () => {
    const register = clone(REGISTER);
    register.insightsWarnings[0].text = "this sentence is not on the insights page";
    expect(hasError(verdict({ ...baseInput(), register }), "drift")).toBe(true);
  });

  it("fails when a required consent statement is absent from its page", () => {
    const register = clone(REGISTER);
    register.requiredStatements[0].text = "this consent sentence is nowhere in the app";
    expect(hasError(verdict({ ...baseInput(), register }), "drift")).toBe(true);
  });

  it("fails when a required consent concern is uncovered", () => {
    const register = clone(REGISTER);
    register.requiredStatements = register.requiredStatements.filter(
      (s) => s.concern !== "no-withdrawal",
    );
    expect(hasError(verdict({ ...baseInput(), register }), '"no-withdrawal" concern')).toBe(true);
  });
});

describe("verdict — top-level guards", () => {
  it("fails on a non-object register", () => {
    expect(verdict({ register: null }).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("normalisePageText strips tags/entities and collapses whitespace", () => {
    expect(normalisePageText("<p>a\n  &amp;   <strong>b</strong>&nbsp;c</p>")).toBe("a & b c");
  });
  it("parseIsoDate accepts ISO dates and rejects junk", () => {
    expect(parseIsoDate("2026-07-16")).toBeTypeOf("number");
    expect(parseIsoDate("nope")).toBeNull();
  });
});
