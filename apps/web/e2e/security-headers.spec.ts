import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// Start every test past the age-first gate so /card stays on /card for the CSP read.
test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

// Content-Security-Policy end-to-end coverage.
//
// The site is a static Cloudflare Pages build. The header-only directives (HSTS, frame-ancestors,
// COOP, …) are delivered by apps/web/static/_headers and are asserted statically by
// scripts/check-security-config.mjs — the vite `preview` server used here does NOT emit that file,
// so they cannot be checked over HTTP in this harness. What IS in the served HTML is the per-page
// Content-Security-Policy that SvelteKit emits as a <meta http-equiv> tag (svelte.config.js csp,
// mode "hash"); that is the part a browser actually enforces on each page, so it is exercised here.
//
// Self-contained: this spec shares no helpers with the other e2e specs.

/** Read the enforced CSP for a page from its <meta http-equiv="content-security-policy"> tag. */
async function readMetaCsp(page: Page, path: string): Promise<string> {
  await page.goto(path);
  const content = await page
    .locator('meta[http-equiv="content-security-policy" i]')
    .first()
    .getAttribute("content");
  expect(content, `no CSP <meta> tag on ${path}`).toBeTruthy();
  return content ?? "";
}

test("every prerendered page carries a strict CSP meta tag", async ({ page }) => {
  for (const path of ["/", "/privacy", "/methodology", "/card?res=5f2a9c1e3b7d"]) {
    const csp = await readMetaCsp(page, path);
    // Locked-down fetch/exec surface: default self, no eval, no plugins, no base hijack.
    expect(csp, path).toMatch(/default-src[^;]*'self'/);
    expect(csp, path).toMatch(/object-src[^;]*'none'/);
    expect(csp, path).toMatch(/base-uri[^;]*'none'/);
    // script-src must be hash-locked (mode "hash" emits sha-*) and must never permit eval.
    expect(csp, path).toMatch(/script-src[^;]*'self'/);
    expect(csp, path).not.toContain("unsafe-eval");
  }
});

test("no page trips its own CSP at runtime", async ({ page }) => {
  // Asserting the policy text is not enough — the app can still violate it while running. A caught
  // violation is still reported to the page, so a library that probes for `eval` behind a try/catch
  // produces console violations under a clean policy; packages/data-schema opts out of Zod's JIT probe
  // for that reason and this test guards it.
  //
  // Listen before any navigation, and collect rather than fail fast so the report names the directive
  // and blocked URI.
  const violations: string[] = [];
  await page.exposeFunction("__recordCspViolation", (v: string) => void violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      void (
        window as unknown as { __recordCspViolation: (v: string) => void }
      ).__recordCspViolation(
        `${e.violatedDirective}: ${e.blockedURI || "inline"} (${e.sourceFile ?? "?"}:${e.lineNumber})`,
      );
    });
  });

  for (const path of ["/", "/quiz", "/card?res=5f2a9c1e3b7d"]) {
    await page.goto(path);
    // The quiz/card path constructs the dataset schemas on demand, so let the lazy work settle.
    await page.waitForLoadState("networkidle");
  }

  expect(violations, `CSP violations fired at runtime:\n${violations.join("\n")}`).toEqual([]);
});

test("the CSP hashes the inline hydration script (no blanket inline scripts)", async ({ page }) => {
  const csp = await readMetaCsp(page, "/");
  const scriptSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src"));
  expect(scriptSrc, "no script-src directive in CSP").toBeTruthy();
  // A per-page sha-256 hash proves the inline script is pinned rather than allowed via
  // 'unsafe-inline'. (An external analytics origin may also be listed; that is registry-driven.)
  expect(scriptSrc).toMatch(/'sha(256|384|512)-/);
});
