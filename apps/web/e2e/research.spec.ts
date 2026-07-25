import { expect, test, type Page, type Request } from "@playwright/test";
import { seedEligibility, stubChallenge } from "./flow-helpers";

// Start every test past the age-first gate — the gate itself is proven in age-gate.spec.ts — and
// stub the challenge issuer so the invisible research proof-of-work solves on the test origin.
test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
  await stubChallenge(page);
});

// Compliance guarantee (ADR 0006): a research record is uploaded
// ONLY on an explicit opt-in, as EXACTLY ONE detailed record (never carrying the electorate) plus at
// most one separate, unlinkable geography ping. Nothing is sent by reaching the card, by skipping,
// by navigating away mid-survey, or on tab-close; a failed upload is not silently retried. These are
// runtime proofs via real network capture, not source inspection.

async function reachSurvey(page: Page): Promise<void> {
  await page.goto("/2025");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  const label = page.locator("span.label");
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press("3");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  await expect(page).toHaveURL(/\/survey/);
}

/**
 * Capture every POST to the two research endpoints, kept apart: the detailed Views record
 * (`/api/research`) and the separate geography tally (`/api/research/geography`). Attach BEFORE the
 * flow so a stray early request cannot be missed.
 */
function trackResearch(page: Page): { research: Request[]; geography: Request[] } {
  const research: Request[] = [];
  const geography: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const url = r.url();
    if (url.includes("/api/research/geography")) geography.push(r);
    // The single-use submission token is integrity infrastructure, not a data record — it
    // must not be counted as a detailed research upload.
    else if (url.includes("/api/research/token")) return;
    else if (url.includes("/api/research")) research.push(r);
  });
  return { research, geography };
}

/** Tick BOTH required opt-ins on the research gate: research consent AND the versioned Terms
 *  acceptance. Contributing is inert until both are ticked. */
async function optIn(page: Page): Promise<void> {
  await page.getByRole("checkbox", { name: /consent to National Digital collecting/ }).check();
  await page.getByRole("checkbox", { name: /read and agree to the Terms of Use/ }).check();
}

/** From the research gate: opt in, contribute, then answer every optional question with
 *  "Prefer not to say" until the plan (/card) is reached — the only path that uploads. */
async function consentAndFinish(page: Page): Promise<void> {
  await optIn(page);
  await page.getByRole("button", { name: "Contribute my answers and continue" }).click();
  for (let i = 0; i < 30 && !/\/card/.test(page.url()); i++) {
    try {
      await page.getByRole("button", { name: "Prefer not to say" }).click({ timeout: 2000 });
    } catch {
      break; // the last answer navigated to /card — the button is gone
    }
  }
  await expect(page).toHaveURL(/\/card/, { timeout: 10_000 });
}

test("skipping research uploads nothing — no request to /api/research", async ({ page }) => {
  const posts = trackResearch(page);

  await reachSurvey(page);
  // Reaching the survey (and the whole quiz before it) must not have posted a record.
  expect(posts.research.length, "no detailed upload before an explicit opt-in").toBe(0);
  expect(posts.geography.length, "no geography ping before an explicit opt-in").toBe(0);

  // The Contribute action is inert until consent is ticked; Skip is always available.
  await expect(
    page.getByRole("button", { name: "Contribute my answers and continue" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card/);

  // Give any stray fire-and-forget POST time to appear, then assert none did.
  await page.waitForTimeout(500);
  expect(posts.research.length, "skipping uploads no record").toBe(0);
  expect(posts.geography.length, "skipping uploads no geography ping").toBe(0);
});

test("the research gate shows the collection notice and gates Contribute on consent", async ({
  page,
}) => {
  const posts = trackResearch(page);
  await reachSurvey(page);

  // (f) The collection notice is present on the gate BEFORE any question or transmission — and it
  // describes the aggregate-counters processing (ADR-0008) in construction language, never
  // claiming anonymity.
  await expect(page.getByText(/never\s+leave\s+your\s+device/i)).toBeVisible();
  await expect(page.getByText(/additions\s+to\s+aggregate\s+counts/i)).toBeVisible();
  await expect(page.getByText(/no\s+direct\s+identifiers\s+are\s+collected/i)).toBeVisible();
  expect(
    posts.research.length + posts.geography.length,
    "nothing is transmitted merely by reaching the gate",
  ).toBe(0);

  // (d) Contribute needs BOTH opt-ins: the 18+/research-consent tick AND the versioned Terms
  // acceptance. It stays disabled until both are ticked; consent alone is not enough.
  const contribute = page.getByRole("button", { name: "Contribute my answers and continue" });
  await expect(contribute).toBeDisabled();
  await page.getByRole("checkbox", { name: /consent to National Digital collecting/ }).check();
  await expect(contribute).toBeDisabled();
  await page.getByRole("checkbox", { name: /read and agree to the Terms of Use/ }).check();
  await expect(contribute).toBeEnabled();

  // Opting in alone still transmits nothing — the upload happens only on finishing the questions.
  await page.waitForTimeout(300);
  expect(posts.research.length + posts.geography.length, "consent alone uploads nothing").toBe(0);
});

test("consenting and finishing posts exactly one record (no electorate) + one geography ping", async ({
  page,
}) => {
  const posts = trackResearch(page);
  await reachSurvey(page);
  await consentAndFinish(page);

  // (c) Exactly one detailed record AND one geography ping.
  await expect.poll(() => posts.research.length, { timeout: 8000 }).toBe(1);
  await expect.poll(() => posts.geography.length, { timeout: 8000 }).toBe(1);
  // Settle, then confirm there is no duplicate/second attempt.
  await page.waitForTimeout(600);
  expect(posts.research.length, "exactly one detailed record").toBe(1);
  expect(posts.geography.length, "exactly one geography ping").toBe(1);

  // The contribution must NOT carry the electorate — and it must NOT carry the raw
  // answer vector or weights either (ADR-0008): only the device-derived match + stances travel.
  const raw = posts.research[0]!.postData() ?? "{}";
  const record = JSON.parse(raw);
  expect(record, "contribution must not carry the electorate").not.toHaveProperty("electorate");
  expect(record.schemaVersion, "research schema v1").toBe(1);
  expect(record.consentVersion, "consent version recorded").toEqual(expect.any(String));
  expect(record.match, "device-derived match travels").toMatch(/^[a-z0-9_]+$/);
  // All 50 quiz answers were neutral (3) → 50 neutral stances, and nothing rawer than that.
  expect(record.propositions).toEqual(
    Array.from({ length: 50 }, () => expect.objectContaining({ stance: "neutral" })),
  );
  expect(record, "no raw answer vector on the wire").not.toHaveProperty("answers");
  expect(raw, "no points on the wire").not.toContain('"points"');
  expect(raw, "no importance weights on the wire").not.toContain('"important"');

  const geo = JSON.parse(posts.geography[0]!.postData() ?? "{}");
  expect(geo.electorate, "geography ping carries the electorate").toBeTruthy();
  expect(geo, "geography ping carries no answer data").not.toHaveProperty("answers");
  expect(geo, "geography ping carries no match").not.toHaveProperty("match");
});

test("navigating away mid-survey uploads nothing (no pagehide/beforeunload transmit)", async ({
  page,
}) => {
  const posts = trackResearch(page);
  await reachSurvey(page);

  // Opt in and begin the questions, then leave WITHOUT finishing.
  await optIn(page);
  await page.getByRole("button", { name: "Contribute my answers and continue" }).click();
  await page.getByRole("button", { name: "Prefer not to say" }).click();
  await page.getByRole("button", { name: "Prefer not to say" }).click();

  // Navigate right away from the site (a real tab-close/navigation). Submission only ever happens on
  // finish, and there is no pagehide/beforeunload/sendBeacon handler, so nothing is sent.
  await page.goto("/about");
  await page.waitForTimeout(500);
  expect(posts.research.length, "no record on navigation away").toBe(0);
  expect(posts.geography.length, "no geography ping on navigation away").toBe(0);
});

test("a failed research upload is not silently retried (single attempt)", async ({ page }) => {
  const posts = trackResearch(page);
  let researchAttempts = 0;
  // Abort ONLY the detailed endpoint (not .../geography). The client swallows the failure and does
  // not retry — the card must be unaffected and no second attempt may occur.
  await page.route(
    (url) => url.pathname === "/api/research",
    async (route) => {
      researchAttempts += 1;
      await route.abort();
    },
  );

  await reachSurvey(page);
  await consentAndFinish(page);

  await expect.poll(() => researchAttempts, { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(800);
  expect(researchAttempts, "fire-and-forget: one attempt, no retry").toBe(1);
  // The geography ping is a separate request and still fires; the plan loads regardless.
  expect(posts.geography.length, "the separate geography ping is unaffected").toBe(1);
  await expect(page).toHaveURL(/\/card/);
});
