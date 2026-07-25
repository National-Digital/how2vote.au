import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hostAllowed, hostsInText, verdict } from "./check-vendor-registry.mjs";

const REGISTRY = JSON.parse(
  readFileSync(
    new URL("../apps/web/src/lib/privacy/third-party-services.json", import.meta.url),
    "utf8",
  ),
);
const EXPENDITURE = JSON.parse(
  readFileSync(new URL("../docs/legal/electoral-expenditure.json", import.meta.url), "utf8"),
);
const SVELTE_CONFIG = readFileSync(
  new URL("../apps/web/svelte.config.js", import.meta.url),
  "utf8",
);

const NOW = Date.parse("2026-07-15T00:00:00Z");
const clone = (v) => JSON.parse(JSON.stringify(v));
const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));
const opts = (extra = {}) => ({
  now: NOW,
  expenditure: EXPENDITURE,
  svelteConfig: SVELTE_CONFIG,
  ...extra,
});

describe("verdict — real committed registry", () => {
  it("passes with the real registry, expenditure and svelte config", () => {
    const res = verdict(REGISTRY, opts());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("fails closed on non-object input", () => {
    expect(verdict(null, opts()).ok).toBe(false);
    expect(verdict([], opts()).ok).toBe(false);
  });
});

describe("verdict — infrastructure vendors", () => {
  it("requires Cloudflare, GitHub and TVFY", () => {
    const reg = clone(REGISTRY);
    reg.infrastructure = reg.infrastructure.filter((v) => v.id !== "github");
    expect(hasError(verdict(reg, opts()), 'required vendor "github" is missing')).toBe(true);
  });

  it("flags a missing vendor-control field", () => {
    const reg = clone(REGISTRY);
    reg.infrastructure[0].retention = "";
    expect(hasError(verdict(reg, opts()), "missing retention")).toBe(true);
  });

  it("requires the canonical contract evidence id", () => {
    const reg = clone(REGISTRY);
    reg.infrastructure[0].contract.evidenceId = "EV-SOMETHING-ELSE";
    expect(hasError(verdict(reg, opts()), "contract.evidenceId must be")).toBe(true);
  });

  it("allows a pending contract (partial-passing) but fails an expired one", () => {
    const pending = clone(REGISTRY);
    expect(verdict(pending, opts()).ok).toBe(true); // all contracts pending by default
    const expired = clone(REGISTRY);
    expired.infrastructure[0].contract.status = "expired";
    expect(hasError(verdict(expired, opts()), "expired and must be renewed")).toBe(true);
  });

  it("fails an overdue vendor review (fail-closed freshness)", () => {
    const later = Date.parse("2027-08-01T00:00:00Z");
    expect(hasError(verdict(REGISTRY, opts({ now: later })), "review overdue")).toBe(true);
  });

  it("requires a subprocessor source when the list is empty", () => {
    const reg = clone(REGISTRY);
    const cf = reg.infrastructure.find((v) => v.id === "cloudflare");
    cf.subprocessors = [];
    delete cf.subprocessorsUrl;
    delete cf.subprocessorsNote;
    expect(hasError(verdict(reg, opts()), "subprocessors is empty")).toBe(true);
  });
});

describe("verdict — accessible anti-abuse", () => {
  it("requires at least one accessible mechanism", () => {
    const reg = clone(REGISTRY);
    reg.antiAbuse = [];
    expect(hasError(verdict(reg, opts()), "at least one anti-abuse mechanism")).toBe(true);
  });

  it("rejects an inaccessible interactive challenge with no accessible alternative", () => {
    const reg = clone(REGISTRY);
    reg.antiAbuse.push({
      id: "hard-captcha",
      service: "cloudflare",
      mechanism: "Image-selection challenge",
      interactive: true,
      accessible: false,
      note: "A visual puzzle.",
    });
    expect(hasError(verdict(reg, opts()), "accessibleAlternative")).toBe(true);
  });

  it("accepts an interactive challenge that names an accessible alternative", () => {
    const reg = clone(REGISTRY);
    reg.antiAbuse.push({
      id: "hard-captcha",
      service: "cloudflare",
      mechanism: "Image-selection challenge",
      interactive: true,
      accessible: false,
      accessibleAlternative: "altcha-pow",
      note: "Falls back to the non-interactive self-hosted proof-of-work challenge.",
    });
    expect(verdict(reg, opts()).ok).toBe(true);
  });

  it("flags an anti-abuse entry referencing an unknown service", () => {
    const reg = clone(REGISTRY);
    reg.antiAbuse[0].service = "ghost";
    expect(hasError(verdict(reg, opts()), "not a registered service or vendor")).toBe(true);
  });
});

describe("verdict — cost completeness", () => {
  it("fails when a vendor has no expenditure record", () => {
    const reg = clone(REGISTRY);
    reg.infrastructure.push({
      id: "acme",
      name: "Acme Cloud",
      provider: "Acme Pty Ltd",
      surface: "infrastructure",
      role: "x",
      dataProcessing: "x",
      retention: "x",
      subprocessors: [],
      subprocessorsNote: "none",
      dataLocation: "AU",
      privacyPolicyUrl: "https://acme.example/privacy",
      egressHosts: [],
      contract: {
        type: "DPA",
        evidenceId: "EV-VENDOR-CONTRACT-REVIEW",
        status: "pending",
        reviewDate: "2026-07-15",
        nextReviewDate: "2027-07-15",
      },
    });
    expect(hasError(verdict(reg, opts()), 'vendor "Acme Cloud" has no matching')).toBe(true);
  });

  it("skips the cost check when no expenditure register is supplied", () => {
    expect(verdict(REGISTRY, opts({ expenditure: undefined })).ok).toBe(true);
  });
});

describe("verdict — no unregistered host", () => {
  it("flags a base CSP that hardcodes an external origin", () => {
    const bad = SVELTE_CONFIG.replace(
      '"script-src": ["self"],',
      '"script-src": ["self", "https://evil.example.com"],',
    );
    expect(hasError(verdict(REGISTRY, opts({ svelteConfig: bad })), "BASE_CSP hardcodes")).toBe(
      true,
    );
  });

  it("flags a config that no longer merges the registry", () => {
    const bad = SVELTE_CONFIG.replace("mergeRegistryCsp(BASE_CSP)", "BASE_CSP");
    expect(
      hasError(verdict(REGISTRY, opts({ svelteConfig: bad })), "no longer merges the registry"),
    ).toBe(true);
  });

  it("flags a function that contacts an unregistered host", () => {
    const sources = [
      {
        path: "apps/web/functions/api/x.ts",
        text: 'await fetch("https://evil.example.com/collect");',
      },
    ];
    expect(
      hasError(
        verdict(REGISTRY, opts({ functionSources: sources })),
        'unregistered host "evil.example.com"',
      ),
    ).toBe(true);
  });

  it("allows a function that contacts a registered host", () => {
    const sources = [
      {
        path: "apps/web/functions/api/x.ts",
        text: 'await fetch("https://api.cloudflare.com/client/v4/x");',
      },
    ];
    expect(verdict(REGISTRY, opts({ functionSources: sources })).ok).toBe(true);
  });
});

describe("host helpers", () => {
  it("hostsInText extracts every URL authority", () => {
    expect(hostsInText('a="https://a.com/x" b="http://b.org"')).toEqual(["a.com", "b.org"]);
  });

  it("hostAllowed honours exact and wildcard entries", () => {
    const allow = ["formspree.io", "*.google-analytics.com"];
    expect(hostAllowed("formspree.io", allow)).toBe(true);
    expect(hostAllowed("region1.google-analytics.com", allow)).toBe(true);
    expect(hostAllowed("evil.com", allow)).toBe(false);
  });
});
