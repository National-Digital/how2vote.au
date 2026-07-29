import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractTermsBody,
  hashTermsBody,
  normalisePageText,
  scanContradictions,
  verdict,
} from "./check-terms.mjs";

const url = (p) => new URL(p, import.meta.url);
const REGISTRY = JSON.parse(readFileSync(url("../docs/legal/terms-registry.json"), "utf8"));
const TERMS_PAGE = readFileSync(url("../apps/web/src/lib/content/TermsContent.svelte"), "utf8");
const LEAF = readFileSync(url("../apps/web/src/lib/terms/terms.ts"), "utf8");
const STORE = readFileSync(url("../apps/web/src/lib/terms.svelte.ts"), "utf8");
const CARD = readFileSync(url("../apps/web/src/routes/card/+page.svelte"), "utf8");
const SURVEY = readFileSync(url("../apps/web/src/routes/survey/+page.svelte"), "utf8");

const leafConst = (name) => {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([\\s\\S]*?);`).exec(LEAF);
  const lits = m[1].match(/"([^"]*)"|'([^']*)'/g);
  return lits.map((s) => s.slice(1, -1)).join("");
};
const TERMS_VERSION = leafConst("TERMS_VERSION");
const TERMS_ACCEPTANCE_LABEL = leafConst("TERMS_ACCEPTANCE_LABEL");

const hasError = (res, needle) => res.errors.some((e) => e.includes(needle));

const baseInput = () => ({
  registry: JSON.parse(JSON.stringify(REGISTRY)),
  termsSource: TERMS_PAGE,
  termsVersion: TERMS_VERSION,
  acceptanceLabel: TERMS_ACCEPTANCE_LABEL,
  storeSource: STORE,
  wiringSources: [
    { path: "card", text: CARD },
    { path: "survey", text: SURVEY },
  ],
});

describe("verdict — the real committed Terms + registry + wiring", () => {
  it("passes on the real repo state", () => {
    const res = verdict(baseInput());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("immutable hash", () => {
  it("fails when the Terms wording changes without a new version/hash", () => {
    // Edit visible legal copy — the recomputed body hash no longer matches the registry entry.
    const termsSource = TERMS_PAGE.replace(
      "build your own comparison first",
      "build your own comparison later",
    );
    const res = verdict({ ...baseInput(), termsSource });
    expect(res.ok).toBe(false);
    expect(hasError(res, "wording changed")).toBe(true);
  });

  it("recomputes a different hash when the visible body changes", () => {
    const a = hashTermsBody("<p>one</p>");
    const b = hashTermsBody("<p>two</p>");
    expect(a).not.toBe(b);
  });

  it("ignores <script>/<style> changes (not the legal copy)", () => {
    const a = hashTermsBody("<script>const x=1;</script><p>body</p><style>.a{color:red}</style>");
    const b = hashTermsBody("<script>const x=2;</script><p>body</p><style>.a{color:blue}</style>");
    expect(a).toBe(b);
  });
});

describe("version binding", () => {
  it("fails when the registry currentVersion disagrees with TERMS_VERSION", () => {
    const registry = JSON.parse(JSON.stringify(REGISTRY));
    registry.currentVersion = "9999-01";
    expect(hasError(verdict({ ...baseInput(), registry }), "TERMS_VERSION")).toBe(true);
  });

  it("fails when the page does not surface the version placeholder", () => {
    const termsSource = TERMS_PAGE.replace("Terms version {TERMS_VERSION}", "Terms");
    expect(
      hasError(verdict({ ...baseInput(), termsSource }), "does not surface the Terms version"),
    ).toBe(true);
  });
});

describe("required wording", () => {
  it("fails when a bound clause is removed from the page", () => {
    const registry = JSON.parse(JSON.stringify(REGISTRY));
    registry.requiredWording.push({ id: "x", text: "this exact clause is nowhere on the page" });
    expect(hasError(verdict({ ...baseInput(), registry }), "required clause not found")).toBe(true);
  });
});

describe("contradiction scan (negation-aware)", () => {
  const bad = [
    ["expiring link", "Each share link will expire after 7 days."],
    ["revocable link", "You can revoke the share link at any time."],
    ["build from shared", "You can build a voting plan from a shared link."],
    ["ND authorises plan", "National Digital authorises your voting plan."],
    ["particulars stored", "Your authorisation particulars are stored on our server."],
    ["withdraw contribution", "You can withdraw your contribution later."],
  ];
  for (const [name, text] of bad) {
    it(`flags ${name}`, () => {
      expect(scanContradictions(`<p>${text}</p>`).length).toBeGreaterThan(0);
    });
  }

  const clean = [
    "A shared link does not expire and cannot be revoked or deactivated.",
    "A voting plan cannot be built from a link you receive — build your own comparison first.",
    "National Digital does not authorise your voting plan; you do.",
    "They are never saved and never transmitted to National Digital or anyone else.",
    "Once a contribution has been merged it cannot be identified, withdrawn or deleted.",
    "the protections that apply are those disclosure controls rather than a right to withdraw.",
  ];
  for (const text of clean) {
    it(`does not flag: ${text.slice(0, 40)}`, () => {
      expect(scanContradictions(`<p>${text}</p>`)).toEqual([]);
    });
  }

  it("fails the whole verdict when the page carries a contradiction", () => {
    const termsSource = `${TERMS_PAGE}\n<p>You can revoke the share link at any time.</p>`;
    expect(hasError(verdict({ ...baseInput(), termsSource }), "contradicts")).toBe(true);
  });
});

describe("acceptance wiring", () => {
  it("fails when the acceptance label drops the capacity declaration", () => {
    const res = verdict({ ...baseInput(), acceptanceLabel: "I agree to the Terms." });
    expect(hasError(res, "natural person")).toBe(true);
  });

  it("fails when the store does not bind acceptance to TERMS_VERSION", () => {
    const storeSource = "export const termsAcceptance = {}; const acceptedAt = 0;";
    expect(hasError(verdict({ ...baseInput(), storeSource }), "TERMS_VERSION")).toBe(true);
  });

  it("fails when the store `accepted` does not compare to the current version", () => {
    const storeSource =
      "import { TERMS_VERSION } from './x'; export const termsAcceptance = {}; const acceptedAt = 0; const y = TERMS_VERSION;";
    expect(hasError(verdict({ ...baseInput(), storeSource }), "fail closed")).toBe(true);
  });

  it("fails when a gated surface does not gate on termsAcceptance.accepted", () => {
    const res = verdict({
      ...baseInput(),
      wiringSources: [{ path: "card", text: "no gate here" }],
    });
    expect(hasError(res, "does not reference the termsAcceptance store")).toBe(true);
  });
});

describe("registry structure", () => {
  it("fails on a non-object registry", () => {
    expect(verdict({ registry: null }).ok).toBe(false);
  });

  it("fails when the current version has no registry entry", () => {
    const registry = JSON.parse(JSON.stringify(REGISTRY));
    registry.versions = [];
    expect(
      hasError(verdict({ ...baseInput(), registry }), "no entry for the current version"),
    ).toBe(true);
  });

  it("fails on a malformed sha256", () => {
    const registry = JSON.parse(JSON.stringify(REGISTRY));
    registry.versions[0].sha256 = "nothex";
    expect(hasError(verdict({ ...baseInput(), registry }), "64 hex")).toBe(true);
  });
});

describe("helpers", () => {
  it("extractTermsBody strips script/style and normalises", () => {
    expect(extractTermsBody("<script>x</script> <p>a  b</p> <style>y</style>")).toBe("a b");
  });
  it("normalisePageText collapses whitespace and entities", () => {
    expect(normalisePageText("<p>a\n  &amp; b</p>")).toBe("a & b");
  });
});
