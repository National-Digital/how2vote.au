import type { Page } from "@playwright/test";
import { createChallenge } from "altcha-lib";

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
 * Wait until the page has HYDRATED, not merely rendered.
 *
 * Every route is prerendered, so a control is visible — and `click()` considers it actionable — well
 * before Svelte attaches any handler. Clicking in that window runs the element's NATIVE behaviour: a
 * real anchor navigates, and a button does nothing at all. Both look like the feature is broken, and
 * neither is deterministic, so a spec that clicks straight after `goto()` is a coin toss under load.
 *
 * The root layout stamps `data-hydrated` on <html> from a mount effect, which is the only honest
 * signal available: attributes present in the prerendered HTML (`aria-expanded`, say) are there
 * before hydration, so waiting on one would pass immediately and test nothing. A fixed timeout is
 * worse again — it encodes this machine's speed.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForSelector("html[data-hydrated]", { state: "attached" });
}

/**
 * Stub our `/api/challenge` issuer (a Pages Function, absent from the static e2e preview) with a
 * REAL, signed, deliberately low-cost ALTCHA challenge minted in the test process. The bundled
 * in-page solver then genuinely solves it — exercising the true "fetch a challenge → solve
 * on-device → attach the payload to /api/research/token" path, just cheaply (cost 10 instead of
 * the production 10k, so the solve is instant). Anti-abuse enforcement itself is server-side
 * (in-process verification + single-use burn), out of scope for a static-preview e2e.
 */
export async function stubChallenge(page: Page): Promise<void> {
  await page.route("**/api/challenge", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { purpose?: string };
    const challenge = await createChallenge({
      algorithm: "PBKDF2/SHA-256",
      cost: 10,
      // The client never derives at issue time (no counter), so any deriveKey satisfies the type.
      deriveKey: async () => ({ derivedKey: new Uint8Array(32) }),
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      data: { purpose: body.purpose ?? "research" },
      hmacSignatureSecret: "e2e-challenge-secret",
    });
    await route.fulfill({
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ challenge }),
    });
  });
}
