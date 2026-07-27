import { expect, test } from "@playwright/test";

test("unknown routes render the branded 404 page", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the start" })).toBeVisible();
});

test("the static edge error page is branded and self-contained", async ({ page }) => {
  // Generated at build time from the shared error copy (scripts/generate-error-pages.mjs), this is
  // the fallback Cloudflare can serve when the origin is unreachable and no app can load.
  const response = await page.goto("/500.html");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Something went wrong on our end",
  );
  await expect(page.getByRole("link", { name: "Back to How2Vote" })).toHaveAttribute("href", "/");
  // It must pull in nothing external — an origin-down page has to render on its own.
  expect(await page.locator("link[rel=stylesheet], script[src]").count()).toBe(0);
});
