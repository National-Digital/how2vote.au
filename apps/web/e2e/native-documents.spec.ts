import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  currentElectionDocuments,
  nativeDataSections,
  nativeDocumentRoutes,
} from "../../../scripts/build-native-documents.mjs";
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
const router = readFileSync(new URL("../src/lib/native-router.svelte.ts", import.meta.url), "utf8");
const routes: string[] = nativeDocumentRoutes(router);
const currentOnly = new Set<string>(currentElectionDocuments(router));
const sections: string[] = nativeDataSections(router);
const elections = readdirSync(
  fileURLToPath(new URL("../../../data/dist/", import.meta.url)),
).filter((f) => !f.endsWith(".json"));
const BUILD = fileURLToPath(new URL("../build/", import.meta.url));

/** An election's data pages, exactly as the projection selects them from the build. */
function dataPages(election: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : f.endsWith(".html") ? [p] : [];
    });
  return sections
    .flatMap((section) => [
      ...(existsSync(join(BUILD, election, `${section}.html`))
        ? [join(BUILD, election, `${section}.html`)]
        : []),
      ...(existsSync(join(BUILD, election, section)) ? walk(join(BUILD, election, section)) : []),
    ])
    .map((file) => `/${relative(BUILD, file).replace(/\.html$/, "")}`);
}

/** The article's text, whitespace removed: layout whitespace is not content. */
async function articleText(page: Page): Promise<string> {
  const text = await page.locator("main article").first().textContent();
  return (text ?? "").replace(/\s/g, "");
}

/**
 * Voter state a page could read: a past election selected, 18+ declared, a dark theme. A document
 * the native core draws only for the current election is checked with no election selected, which
 * is the current one.
 */
async function seedVoterState(page: Page, pastElection = true): Promise<void> {
  await seedEligibility(page);
  await page.addInitScript((past: boolean) => {
    try {
      if (past) localStorage.setItem("how2vote:election:v1", "2022");
      localStorage.setItem("how2vote:theme", "dark");
    } catch {
      // Storage blocked — the spec then compares against default state, which still holds.
    }
  }, pastElection);
}

/** The pages whose hydrated text differs from their prerendered text, with where they diverge. */
async function unstable(browser: Browser, paths: string[]): Promise<string[]> {
  const prerendered = await browser.newContext({ javaScriptEnabled: false });
  const still = await prerendered.newPage();
  const hydratedContext = await browser.newContext();
  const hydrated = await hydratedContext.newPage();
  await seedVoterState(hydrated);
  const differ: string[] = [];
  for (const path of paths) {
    await still.goto(path);
    const before = await articleText(still);
    await hydrated.goto(path);
    await waitForHydration(hydrated);
    await hydrated.waitForLoadState("networkidle");
    const after = await articleText(hydrated);
    if (before.length === 0 || after !== before) {
      let k = 0;
      while (k < before.length && before[k] === after[k]) k++;
      differ.push(`${path}: "…${before.slice(k, k + 40)}" became "…${after.slice(k, k + 40)}"`);
    }
  }
  await prerendered.close();
  await hydratedContext.close();
  return differ;
}

test.describe("native documents", () => {
  test("the router offers at least the legal documents", () => {
    expect(routes).toEqual(expect.arrayContaining(["privacy", "terms"]));
  });

  // Every data page of every election: several hundred loads, so once, in one project, and only
  // where the pages are drawn natively.
  for (const election of elections) {
    test(`${election}'s data pages hydrate to the text they were prerendered with`, async ({
      browser,
    }, testInfo) => {
      test.skip(
        process.env["PUBLIC_DIST_CHANNEL"] !== "ios" || testInfo.project.name !== "chromium",
        "iOS only, one project",
      );
      test.setTimeout(900_000);
      const paths = dataPages(election);
      expect(paths.length).toBeGreaterThan(0);
      expect(await unstable(browser, paths)).toEqual([]);
    });
  }

  for (const name of routes) {
    test(`/${name} hydrates to the text it was prerendered with`, async ({ browser, page }) => {
      const prerendered = await browser.newContext({ javaScriptEnabled: false });
      const still = await prerendered.newPage();
      await still.goto(`/${name}`);
      const before = await articleText(still);
      await prerendered.close();
      expect(before.length).toBeGreaterThan(100);

      await seedVoterState(page, !currentOnly.has(name));
      await page.goto(`/${name}`);
      await waitForHydration(page);
      await page.waitForLoadState("networkidle");
      expect(await articleText(page)).toBe(before);
    });
  }
});
