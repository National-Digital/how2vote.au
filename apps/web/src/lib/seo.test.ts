import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELECTIONS } from "@how2vote/data-schema";
import {
  SITE_URL,
  OG_IMAGE,
  pageMeta,
  canonicalPath,
  resolveMeta,
  DEFAULT_META,
  indexableRoutes,
  ogImageFor,
  electionLandingMeta,
} from "./seo";

const ROUTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../routes");

/**
 * Canonical paths of every prerendered page route (a directory holding a `+page.svelte`), walked
 * from src/routes. Route groups `(group)` are unwrapped; dynamic `[param]` segments are skipped
 * (they can't be enumerated for a static sitemap). This is the set the sitemap and llms.txt must
 * cover, so every entry is required to be registered in pageMeta below.
 */
function pageRoutes(dir = ROUTES_DIR, prefix = ""): string[] {
  const found: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === "+page.svelte")) {
    found.push(prefix === "" ? "/" : prefix);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes("[")) continue;
    const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
    found.push(...pageRoutes(resolve(dir, entry.name), prefix + segment));
  }
  return found;
}

// Enforced metadata length policy (checklist item 1.11): titles 10–60 chars, descriptions 50–160.
const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

describe("seo metadata", () => {
  it("uses the apex origin with no trailing slash", () => {
    expect(SITE_URL).toBe("https://how2vote.au");
    expect(SITE_URL.endsWith("/")).toBe(false);
  });

  it("points og:image at an absolute URL on the canonical origin", () => {
    expect(OG_IMAGE.startsWith(SITE_URL + "/")).toBe(true);
  });

  for (const [route, meta] of Object.entries(pageMeta)) {
    describe(route, () => {
      it(`title is ${TITLE_MIN}–${TITLE_MAX} chars`, () => {
        expect(meta.title.length).toBeGreaterThanOrEqual(TITLE_MIN);
        expect(meta.title.length).toBeLessThanOrEqual(TITLE_MAX);
      });
      it(`description is ${DESC_MIN}–${DESC_MAX} chars`, () => {
        expect(meta.description.length).toBeGreaterThanOrEqual(DESC_MIN);
        expect(meta.description.length).toBeLessThanOrEqual(DESC_MAX);
      });
    });
  }

  it("keys are canonical (leading slash, no trailing slash except root)", () => {
    for (const route of Object.keys(pageMeta)) {
      expect(route.startsWith("/")).toBe(true);
      expect(canonicalPath(route)).toBe(route);
    }
  });
});

describe("pageMeta completeness", () => {
  // Every prerendered page must be registered here, so the sitemap and llms.txt (both derived from
  // pageMeta) can never silently omit a page. A new route with no entry fails this test.
  it("registers every +page.svelte route", () => {
    for (const route of pageRoutes()) {
      expect(
        Object.prototype.hasOwnProperty.call(pageMeta, route),
        `route "${route}" is missing a pageMeta entry (add it to src/lib/seo.ts)`,
      ).toBe(true);
    }
  });
});

describe("indexableRoutes", () => {
  it("includes the content pages and excludes app-flow routes", () => {
    expect(indexableRoutes).toContain("/");
    expect(indexableRoutes).toContain("/about");
    expect(indexableRoutes).toContain("/methodology");
    expect(indexableRoutes).toContain("/privacy");
    expect(indexableRoutes).toContain("/contact");
    for (const flow of ["/ballot", "/quiz", "/review", "/survey", "/card", "/offline", "/saved"]) {
      expect(indexableRoutes).not.toContain(flow);
    }
  });
});

describe("canonicalPath", () => {
  it("strips a trailing slash except at the root", () => {
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("/about/")).toBe("/about");
    expect(canonicalPath("/about")).toBe("/about");
  });
});

describe("resolveMeta", () => {
  it("resolves a known route and normalises trailing slashes", () => {
    expect(resolveMeta("/about")).toBe(pageMeta["/about"]);
    expect(resolveMeta("/about/")).toBe(pageMeta["/about"]);
  });

  it("falls back to the site default for unknown routes", () => {
    expect(resolveMeta("/does-not-exist")).toBe(DEFAULT_META);
  });
});

describe("per-election OG + landing metadata", () => {
  it("resolves a per-election image on the canonical origin, defaulting for unknown", () => {
    expect(ogImageFor("2019")).toBe(`${SITE_URL}/og-2019.png`);
    expect(ogImageFor(undefined)).toBe(OG_IMAGE);
  });

  for (const e of ELECTIONS) {
    it(`landing meta for ${e.id} respects the length policy`, () => {
      const m = electionLandingMeta(e.label);
      expect(m.title.length).toBeGreaterThanOrEqual(TITLE_MIN);
      expect(m.title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(m.description.length).toBeGreaterThanOrEqual(DESC_MIN);
      expect(m.description.length).toBeLessThanOrEqual(DESC_MAX);
    });
  }
});
