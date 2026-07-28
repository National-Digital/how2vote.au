import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedEligibility } from "../flow-helpers";

// Drives the real flow once per device project (see playwright.screenshots.config.ts) and writes
// the store screenshots into the fastlane packs. Marketing surface — the pipeline regenerates these
// every release, but a human should eyeball them before the first submission.
//
// All PNGs are written under the COMMITTED apps/mobile/fastlane/screenshots/ tree (the
// fastlane/metadata/ dir is generated + gitignored, so committed assets can't live there). The
// release workflows point deliver at fastlane/screenshots/en-AU (iOS) and copy the android trees
// into supply's images path at release time. Regenerated every release; commit an initial set.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHOTS = resolve(REPO, "apps/mobile/fastlane/screenshots");

/** device project → the committed directory its PNGs belong in. */
function outDir(project: string): string {
  if (project === "android-phone") return resolve(SHOTS, "android-phone");
  if (project === "android-tablet") return resolve(SHOTS, "android-tablet");
  return resolve(SHOTS, "en-AU"); // iphone-6.7 / ipad-12.9 → deliver picks device by dimensions
}

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

test("capture store screenshots", async ({ page }, testInfo) => {
  const dir = outDir(testInfo.project.name);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async (screen: string): Promise<void> => {
    n += 1;
    const name = `${testInfo.project.name}-${String(n).padStart(2, "0")}-${screen}.png`;
    await page.screenshot({ path: resolve(dir, name), fullPage: false });
  };

  // 1 — the landing / value proposition.
  await page.goto("/2025");
  await expect(page.getByRole("button", { name: "See how my views compare" })).toBeVisible();
  await shot("home");

  // 2 — choosing your electorate (the ballot).
  await page.getByRole("button", { name: "See how my views compare" }).click();
  await expect(page).toHaveURL(/\/ballot/);
  await shot("ballot");

  // 3 — a real proposition (the quiz).
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  await expect(page.locator("span.label")).toHaveText("Question 1 of 50");
  await shot("question");

  // 4 — the comparison card (answer through the flow with the keyboard).
  for (let i = 0; i < 50; i++) {
    await expect(page.locator("span.label")).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press(i % 2 === 0 ? "5" : "1");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  // Skip the optional survey straight to the card.
  await gotoCard(page);
  await shot("card");

  // 5 — the aggregate insights dashboard.
  await page.goto("/insights");
  await expect(page).toHaveURL(/\/insights/);
  await shot("insights");
});

async function gotoCard(page: Page): Promise<void> {
  for (let i = 0; i < 30 && !/\/card/.test(page.url()); i++) {
    try {
      await page
        .getByRole("button", { name: /Skip|Prefer not to say/ })
        .first()
        .click({ timeout: 1500 });
    } catch {
      break;
    }
  }
  if (!/\/card/.test(page.url())) await page.goto("/card");
  await expect(page).toHaveURL(/\/card/, { timeout: 10_000 });
}
