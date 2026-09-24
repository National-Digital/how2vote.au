import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error -- a plain ES module with no type declarations
import { nativeDocumentRoutes } from "../../../scripts/build-native-documents.mjs";
import { seedEligibility, waitForHydration } from "./flow-helpers";

/**
 * The iOS app draws these documents from their PRERENDERED HTML (`build-native-documents.mjs`), so
 * a page whose text changes once its scripts run would show a native reader something the web never
 * shows. Each document is loaded twice — with JavaScript off, which is exactly the markup the
 * projection reads, and hydrated with the voter state most likely to change a page — and the two
 * article texts must match.
 *
 * The list is read from the router the same way the projection reads it, so a document cannot be
 * made native without passing here.
 */
const routes: string[] = nativeDocumentRoutes(
  readFileSync(new URL("../src/lib/native-router.svelte.ts", import.meta.url), "utf8"),
);

/** The article's text, whitespace removed: layout whitespace is not content. */
async function articleText(page: Page): Promise<string> {
  const text = await page.locator("main article").first().textContent();
  return (text ?? "").replace(/\s/g, "");
}

/** Voter state a page could read: a past election selected, 18+ declared, a dark theme. */
async function seedVoterState(page: Page): Promise<void> {
  await seedEligibility(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("how2vote:election:v1", "2022");
      localStorage.setItem("how2vote:theme", "dark");
    } catch {
      // Storage blocked — the spec then compares against default state, which still holds.
    }
  });
}

test.describe("native documents", () => {
  test("the router offers at least the legal documents", () => {
    expect(routes).toEqual(expect.arrayContaining(["privacy", "terms"]));
  });

  for (const name of routes) {
    test(`/${name} hydrates to the text it was prerendered with`, async ({ browser, page }) => {
      const prerendered = await browser.newContext({ javaScriptEnabled: false });
      const still = await prerendered.newPage();
      await still.goto(`/${name}`);
      const before = await articleText(still);
      await prerendered.close();
      expect(before.length).toBeGreaterThan(100);

      await seedVoterState(page);
      await page.goto(`/${name}`);
      await waitForHydration(page);
      await page.waitForLoadState("networkidle");
      expect(await articleText(page)).toBe(before);
    });
  }
});
