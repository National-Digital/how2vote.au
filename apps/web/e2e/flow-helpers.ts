import type { Page } from "@playwright/test";

/**
 * Pre-seed the age-first eligibility acknowledgement (docs/adr/0011) so a spec that is NOT
 * testing the gate starts past it — the same technique the a11y suite uses to pre-seed terms-ack.
 * The gate's own behaviour (it precedes quiz state, the under-18 path clears state and blocks the
 * save/share/print routes, and the eligibility answer never hits the network) is proven end-to-end in
 * age-gate.spec.ts; every other flow spec just needs to get past it.
 *
 * Applied via `test.beforeEach`, this runs before each test's own `page.goto`, so the one-bit flag is
 * present in localStorage the moment the layout reads it and the guard lets the flow through.
 */
export async function seedEligibility(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("how2vote:age-ok:v1", "1");
    } catch {
      // Storage blocked — the interactive gate path is covered by age-gate.spec.ts.
    }
  });
}

/**
 * Stub Cloudflare Turnstile's cross-origin `api.js` with a local fake so the invisible research
 * challenge resolves deterministically in tests. The real widget cannot run on the `127.0.0.1` test
 * origin (not an allowlisted Turnstile domain), and its script load would otherwise stall the
 * fire-and-forget research submission. The fake resolves `execute()` synchronously with a dummy
 * token, exercising the true "obtain a challenge → send it to /api/research/token" path. Anti-abuse
 * enforcement itself is server-side (siteverify), out of scope for a static-preview e2e.
 */
export async function stubTurnstile(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        window.turnstile = {
          ready: (cb) => cb(),
          render: (_el, params) => { window.__tsCallback = params && params.callback; return "test-widget"; },
          execute: () => { if (window.__tsCallback) window.__tsCallback("test-challenge-token"); },
          reset: () => {},
        };
      `,
    }),
  );
}
