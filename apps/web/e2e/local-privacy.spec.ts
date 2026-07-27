import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// Local-device privacy + anonymous share-link safeguards. Proven at the real
// surface: (1) the one "clear all my data" control wipes EVERY localStorage key and the service-worker
// caches; (2) copying a share link is never possible without first seeing the non-revocable-link
// warning; (3) "make my own comparison" from a shared card starts a clean session.

const QUIZ_KEY = "how2vote:quiz:v2:2025";

/** Walk the flow to a finished own card for the ACT division of Bean (mirrors saved.spec's helper). */
async function buildBeanCard(page: Page): Promise<void> {
  // Past election with a ballot — the default is now the ballot-less "next" comparison.
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
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card#v1\./);
}

test("clear-all wipes every How2Vote localStorage key and service-worker cache", async ({
  page,
}) => {
  // Reach the gated /saved page by seeding the eligibility bit directly (not via an init script, so
  // nothing re-seeds it after the wipe and we can prove it was cleared).
  await page.goto("/");
  await page.evaluate(async () => {
    // A representative on-device key from every store namespace, plus a foreign key that must SURVIVE.
    localStorage.setItem("how2vote:age-ok:v1", "1");
    localStorage.setItem("how2vote:saved:v1", "[]");
    localStorage.setItem("how2vote:quiz:v2:2025", "{}");
    localStorage.setItem("how2vote:theme", "dark");
    localStorage.setItem("how2vote:consent:v1", "{}");
    localStorage.setItem("not-how2vote:keep", "keep-me");
    // Two caches: a how2vote-namespaced one (must be deleted) and a foreign one (must survive).
    await caches.open("how2vote-e2e-seeded");
    await caches.open("unrelated-e2e-cache");
  });

  await page.goto("/saved");
  await expect(
    page.getByRole("heading", { name: "Clear all your data on this device" }),
  ).toBeVisible();

  // Two-step confirm, then the control clears everything and hard-reloads to a clean landing.
  await page.getByRole("button", { name: "Clear all How2Vote data on this device" }).click();
  await page.getByRole("button", { name: "Yes, clear everything" }).click();
  await page.waitForURL("**/");

  const after = await page.evaluate(async () => ({
    how2voteKeys: Object.keys(localStorage).filter((k) => k.startsWith("how2vote:")),
    foreign: localStorage.getItem("not-how2vote:keep"),
    seededCache: (await caches.keys()).includes("how2vote-e2e-seeded"),
    foreignCache: (await caches.keys()).includes("unrelated-e2e-cache"),
  }));

  // Every how2vote-namespaced localStorage key is gone; the foreign key is untouched.
  expect(after.how2voteKeys).toEqual([]);
  expect(after.foreign).toBe("keep-me");
  // The how2vote-namespaced cache is deleted; a cache outside the namespace is left alone.
  expect(after.seededCache).toBe(false);
  expect(after.foreignCache).toBe(true);
});

test("a share link can never be copied without the non-revocable-link warning first", async ({
  page,
}) => {
  await seedEligibility(page);
  // Force the clipboard path (no native share sheet) and capture every copy so we can prove copying
  // happens ONLY after the warning is acknowledged.
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, "share", { configurable: true, get: () => undefined });
    const stub = {
      writeText: (text: string) => {
        (window as unknown as { __copied: string[] }).__copied.push(text);
        return Promise.resolve();
      },
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => stub });
  });

  await buildBeanCard(page);

  const copied = () =>
    page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.slice());

  // Nothing is copied just by having the card open, and the warning is not shown yet.
  expect(await copied()).toEqual([]);
  await expect(page.getByText("This link can't be recalled")).toBeHidden();

  // Sharing is a consequential action, so the versioned Terms gate is shown first. It must
  // be accepted before anything else; accepting it does NOT copy — it reveals the non-revocable
  // warning, which itself still requires an explicit confirm.
  await page.getByRole("button", { name: "Share this comparison" }).click();
  await page.locator(".terms-check input[type='checkbox']").check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page.getByText("This link can't be recalled")).toBeVisible();
  await expect(page.getByText(/does not expire/)).toBeVisible();
  expect(await copied()).toEqual([]);

  // Only the explicit confirm inside the warning performs the copy.
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("button", { name: "Link copied ✓" })).toBeVisible();
  const clip = await copied();
  expect(clip).toHaveLength(1);
  expect(clip[0]).toContain("/card#v1.");

  // Cancelling the warning instead must never copy.
  await page.getByRole("button", { name: "Link copied ✓" }).click();
  await expect(page.getByText("This link can't be recalled")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("This link can't be recalled")).toBeHidden();
  expect(await copied()).toHaveLength(1); // still just the one confirmed copy
});

test("'make my own comparison' from a shared card starts a clean session", async ({ page }) => {
  await seedEligibility(page);
  await buildBeanCard(page);

  // The finished own quiz is persisted for this election…
  expect(await page.evaluate((k) => localStorage.getItem(k), QUIZ_KEY)).not.toBeNull();
  const sharedUrl = page.url();

  // …now open that link FRESH, which the card treats as a read-only shared comparison. Navigate away
  // first so this is a full document load (goto to the identical URL would be a same-page hash change
  // that never re-mounts the card), exactly as a recipient opening the link cold would experience.
  await page.goto("/");
  await page.goto(sharedUrl);
  const makeMine = page.getByRole("button", { name: "Make my own comparison" });
  await expect(makeMine).toBeVisible();
  await expect(page.getByRole("link", { name: "Change my answers" })).toBeHidden();
  // Residual in-progress quiz still on the device before we start fresh.
  expect(await page.evaluate((k) => localStorage.getItem(k), QUIZ_KEY)).not.toBeNull();

  // Making your own wipes the in-progress quiz so nothing leaks into the new comparison.
  await makeMine.click();
  await expect(page).toHaveURL(/\/ballot/);
  expect(await page.evaluate((k) => localStorage.getItem(k), QUIZ_KEY)).toBeNull();
  // The ballot flow is back at step 1 (pick a state) — no resumed state.
  await expect(page.getByRole("button", { name: /ACT/ })).toBeVisible();
});
