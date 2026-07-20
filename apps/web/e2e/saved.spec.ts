import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// Start every test past the age-first gate — the gate itself is proven in age-gate.spec.ts.
test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

// Walk the flow to a finished card for the ACT division of Bean (mirrors flow.spec's helper).
async function buildBeanCard(page: Page): Promise<void> {
  await page.goto("/2025");
  // The only cold-load click: retry until it navigates, so a click landing a beat before hydration
  // attaches the handler doesn't flake the test (the later clicks are all post-hydration).
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

test("save a card on-device, reopen it, then delete it", async ({ page }) => {
  await buildBeanCard(page);

  // Nothing is stored until the visitor explicitly saves.
  const saveButton = page.getByRole("button", { name: "Save on this device" });
  await expect(saveButton).toBeVisible();
  await saveButton.click();
  await expect(page.getByRole("button", { name: "Saved on this device ✓" })).toBeVisible();

  // The footer shortcut appears only once something is saved (exact, to skip the card's own link).
  await page.getByRole("link", { name: "Saved cards", exact: true }).click();
  await expect(page).toHaveURL(/\/saved$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Saved cards");
  await expect(page.getByText("Bean")).toBeVisible();

  // Reopen it — a saved card is just its shareable link, so it reconstructs the card.
  await page.getByRole("link", { name: /Bean/ }).click();
  await expect(page).toHaveURL(/\/card#v1\./);
  await expect(page.getByText("House of Representatives")).toBeVisible();

  // Delete it from the library — the empty state returns.
  await page.goto("/saved");
  await page.getByRole("button", { name: /Delete saved card for Bean/ }).click();
  await expect(page.getByText("You haven't saved any cards yet.")).toBeVisible();
});

test("saving is a toggle, and Clear all needs confirmation", async ({ page }) => {
  await buildBeanCard(page);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(page.getByRole("button", { name: "Saved on this device ✓" })).toBeVisible();

  // Toggling off removes it again.
  await page.getByRole("button", { name: "Saved on this device ✓" }).click();
  await expect(page.getByRole("button", { name: "Save on this device" })).toBeVisible();

  // Re-save, then clear all via the two-step confirm.
  await page.getByRole("button", { name: "Save on this device" }).click();
  await page.goto("/saved");
  await expect(page.getByText("Bean")).toBeVisible();
  // Exact match: the saved-cards "Clear all" is distinct from the global "Clear all how2vote data on
  // this device" control that also lives on this page.
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete all" }).click();
  await expect(page.getByText("You haven't saved any cards yet.")).toBeVisible();
});
