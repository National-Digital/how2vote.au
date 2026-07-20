import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// The site is cookieless and consent-free by construction: usage is measured by cookieless
// Cloudflare Web Analytics at the edge (no client tag, no cookie) and form protection is cookieless
// Cloudflare Turnstile, run only on submit. Nothing the browser loads is consent-gated, so the
// consent banner + preferences UI stay hidden (gated on hasConfigurableConsent — see
// registry.test.ts, which proves the flag and the fact that the UI re-activates if a consent-gated
// service is ever added back). These tests pin that shipped posture:
//   - no consent UI surfaces and no consent decision is ever stored;
//   - no request is ever made to an analytics / tracking vendor;
//   - building a card contacts no tracking host and never leaks the share payload (answers +
//     electorate) off-device.
const TRACKER_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "google.com/recaptcha",
  "gstatic.com/recaptcha",
  "doubleclick.net",
];

const hitsTracker = (url: string): boolean => TRACKER_HOSTS.some((h) => url.includes(h));

async function storedConsentKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith("how2vote:consent")),
  );
}

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

test("no consent banner or preferences control appears, and no consent is ever stored", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // No consent banner in the shipped, cookieless build (nothing is consent-gated).
  await expect(page.getByRole("dialog", { name: /privacy|analytics|consent|cookie/i })).toHaveCount(
    0,
  );
  // The footer "Privacy settings" trigger is gated off alongside the banner.
  await expect(page.getByRole("button", { name: "Privacy settings" })).toHaveCount(0);
  // And no consent record is written — there is nothing to decide.
  expect(await storedConsentKeys(page)).toEqual([]);
});

test("no request is made to any analytics / tracking vendor", async ({ page }) => {
  const tracker: string[] = [];
  page.on("request", (r) => {
    if (hitsTracker(r.url())) tracker.push(r.url());
  });

  await page.goto("/");
  // Interact — a lazily-wired tracker (there is none) would attach to the first interaction/idle.
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);

  expect(tracker, "no request to a tracking vendor").toEqual([]);
});

test("building a card contacts no tracking host and never leaks the share payload", async ({
  page,
}) => {
  const tracker: string[] = [];
  const leaks: string[] = [];
  const ELECTORATE = "Bean";
  page.on("request", (r) => {
    const url = r.url();
    if (hitsTracker(url)) tracker.push(url);
    // The share payload (electorate + the encoded answer fragment) must never appear in any
    // outbound request URL or body. The fragment lives only in location.hash (never transmitted);
    // this guards against any regression that would forward it.
    const haystack = `${url} ${r.postData() ?? ""}`;
    if (haystack.includes("#v1.") || new RegExp(`\\b${ELECTORATE}\\b`).test(haystack)) {
      leaks.push(url);
    }
  });

  // The default election is now the ballot-less "next" comparison; this spec drives the full ballot
  // flow, so it runs against a past election that has a ballot.
  await page.goto("/2025");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();

  const label = page.locator("span.label");
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press("5");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card#v1\./);

  expect(tracker, "no tracking-vendor request while building a card").toEqual([]);
  expect(leaks, "no outbound request carries the share payload").toEqual([]);
});
