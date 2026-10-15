import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// The postcode pages' required notices, as rendered: the CC BY 4.0 attribution with its source and
// licence links, the election and boundaries each page applies to, and the AEC finder wherever a
// postcode touches more than one electorate.

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

const FINDER = "https://electorate.aec.gov.au/";
const LICENCE = "https://creativecommons.org/licenses/by/4.0/";
const CORRESPONDENCES = "https://data.gov.au/data/dataset/asgs-edition-3-2021-correspondences";
const MB_COUNTS =
  "https://www.abs.gov.au/census/guide-census-data/mesh-block-counts/latest-release";

async function expectAttribution(page: Page): Promise<void> {
  const notice = page.locator("p.source", { hasText: "Source: Australian Bureau of Statistics" });
  await expect(notice).toContainText(
    "Postcode correspondence data © Commonwealth of Australia (Australian Bureau of Statistics), CC BY 4.0",
  );
  await expect(notice).toContainText("adapted by How2Vote and provided without warranty");
  await expect(
    notice.getByRole("link", { name: /ASGS Geographic Correspondences \(2021\) Edition 3/ }),
  ).toHaveAttribute("href", CORRESPONDENCES);
  await expect(notice.getByRole("link", { name: /Mesh Block Counts, 2021/ })).toHaveAttribute(
    "href",
    MB_COUNTS,
  );
  await expect(notice.getByRole("link", { name: /^licence/ })).toHaveAttribute("href", LICENCE);
}

const finderLinks = (page: Page) =>
  page.locator("main").getByRole("link", { name: /Find my electorate/ });

test("the 2025 postcode index carries the attribution and passes an accessibility scan", async ({
  page,
}) => {
  await page.goto("/2025/postcodes");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  await expect(page.locator("main")).toContainText(
    "This applies to the 2025 federal election, on the electorate boundaries used at that election.",
  );
  await expect(page.getByRole("link", { name: "3000", exact: true })).toHaveAttribute(
    "href",
    "/2025/postcodes/3000",
  );
  await expectAttribution(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test("a single-electorate postcode names its electorate and election", async ({ page }) => {
  await page.goto("/2025/postcodes/3000");
  await expect(page.locator("main")).toContainText(
    "Postcode 3000 falls in the federal electorate of Melbourne, Victoria. This applies to the 2025 federal election, on the electorate boundaries used at that election.",
  );
  await expect(page.getByRole("link", { name: "Candidates in Melbourne →" })).toHaveAttribute(
    "href",
    "/2025/electorates/melbourne",
  );
  await expect(page.locator("p.note")).toHaveCount(0);
  await expectAttribution(page);
});

test("a split postcode sends the reader to the AEC finder", async ({ page }) => {
  await page.goto("/2025/postcodes/0872");
  await expect(page.locator("main")).toContainText(
    "Postcode 0872 spans more than one federal electorate.",
  );
  await expect(page.getByRole("heading", { name: "Federal electorates" })).toBeVisible();
  await expect(
    page.locator("p.note").getByRole("link", { name: /Find my electorate/ }),
  ).toHaveAttribute("href", FINDER);
  await expectAttribution(page);
});

test("a postcode mostly in one electorate says so, and still points to the AEC finder", async ({
  page,
}) => {
  await page.goto("/2025/postcodes/2000");
  await expect(page.locator("main")).toContainText(
    "Postcode 2000 falls mainly in the federal electorate of Sydney, New South Wales; a small part may be in Wentworth.",
  );
  await expect(page.locator("main")).not.toContainText("spans more than one");
  await expect(
    page.getByRole("heading", { name: "Federal electorate", exact: true }),
  ).toBeVisible();
  await expect(finderLinks(page).first()).toHaveAttribute("href", FINDER);
  await expectAttribution(page);
});

test("the next election's pages date the boundary statement", async ({ page }) => {
  await page.goto("/next/postcodes/3000");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator("main")).toContainText(
    "This applies to the next federal election, using the electorate boundaries of the 2025 election, which were unchanged for this postcode as at 12 October 2026.",
  );
});

test("a split postcode with a small part elsewhere lists the small part apart", async ({
  page,
}) => {
  await page.goto("/2025/postcodes/2122");
  const main = page.locator("main");
  await expect(main).toContainText("Postcode 2122 spans more than one federal electorate.");
  await expect(main).toContainText("A small part of this postcode may also fall in Berowra.");
  await expect(main.locator("ul.rows")).not.toContainText("Berowra");
  await expect(
    page.locator("p.note").getByRole("link", { name: /Find my electorate/ }),
  ).toHaveAttribute("href", FINDER);
  await expectAttribution(page);
});

test("the next election leaves out postcodes in the redrawn states, and says so", async ({
  page,
}) => {
  const response = await page.request.get("/next/postcodes/5000");
  expect(await response.text()).not.toContain("Postcode 5000 falls");
  await page.goto("/next/postcodes");
  await expect(page.locator("main")).toContainText(
    "Postcodes that fall in an electorate in South Australia, Tasmania or the Australian Capital Territory are not listed.",
  );
  await expect(page.getByRole("link", { name: "5000", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "3000", exact: true })).toHaveCount(1);
});
