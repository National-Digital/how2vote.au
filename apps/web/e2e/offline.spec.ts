import { expect, test } from "@playwright/test";

test("the offline page reports the whole card flow as available once cached", async ({ page }) => {
  // First load registers the service worker; give it a moment to install and precache, then reload
  // so the page is controlled and can read the populated cache.
  await page.goto("/offline");
  await page.waitForTimeout(1500);
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("offline");
  await expect(page.getByText("Online", { exact: true })).toBeVisible();

  // Every flow step should now be saved on the device — the dataset is bundled, so a cached flow
  // means a fully-working offline card.
  await expect(page.getByText("The 50 questions")).toBeVisible();
  await expect(page.getByText("Not saved yet")).toHaveCount(0);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
});

test("an offline navigation to an uncached page falls back to the branded offline page", async ({
  page,
  context,
}) => {
  // Prime the service worker from the home page, then cut the network.
  await page.goto("/");
  await page.waitForTimeout(1500);
  await context.setOffline(true);

  await page.goto("/a-page-that-was-never-cached-12345");
  // The SW serves the cached /offline page rather than a dead browser error: assert its distinctive
  // branded content (connectivity-status detection under emulation is covered by the first test).
  await expect(page.getByRole("heading", { level: 1 })).toContainText("offline");
  await expect(
    page.getByText("A connection is only needed for the optional research survey"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Build my comparison" })).toBeVisible();

  await context.setOffline(false);
});
