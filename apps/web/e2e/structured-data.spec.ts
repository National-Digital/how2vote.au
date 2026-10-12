import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The election and ballot JSON-LD on the prerendered pages states exactly what the page shows: the
 * same candidates, in the same groups and order, with the same party labels.
 */

type Json = Record<string, unknown>;
type Row = { name: string; party: string };

async function jsonLd(page: Page, type: string): Promise<Json[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((b) => JSON.parse(b) as Json).filter((n) => n["@type"] === type);
}

async function rows(list: Locator): Promise<Row[]> {
  const out: Row[] = [];
  for (const row of await list.locator("li").all()) {
    out.push({
      name: (await row.locator(".lead").innerText()).trim().replace(/,$/, ""),
      party: (await row.locator(".detail").innerText()).trim(),
    });
  }
  return out;
}

/**
 * Checks each JSON-LD Person against the visible row. An omitted affiliation must correspond to a
 * label that names no organisation: "Independent" (the page's text for a blank label) or the
 * candidate's own name.
 */
function expectSameBallot(list: Json, shown: Row[]) {
  const items = list.itemListElement as Json[];
  expect(shown.length).toBeGreaterThan(0);
  expect(items).toHaveLength(shown.length);
  items.forEach((li, i) => {
    const person = li.item as Json;
    const row = shown[i]!;
    expect(person["@type"]).toBe("Person");
    expect(person.name).toBe(row.name);
    const org = person.affiliation as Json | undefined;
    if (org) expect(org.name).toBe(row.party);
    else {
      const [surname = "", given = ""] = row.name.split(",").map((s) => s.trim().toLowerCase());
      expect(["independent", `${given} ${surname}`]).toContain(row.party.toLowerCase());
    }
  });
}

async function ballotPage(page: Page): Promise<Json> {
  const [collection] = await jsonLd(page, "CollectionPage");
  expect(collection).toBeDefined();
  return collection!;
}

test("an electorate page lists its House ballot as Person items in printed order", async ({
  page,
}) => {
  await page.goto("/2025/electorates/bean");
  const collection = await ballotPage(page);
  expectSameBallot(collection.mainEntity as Json, await rows(page.locator("article .rows")));
  expect((collection.spatialCoverage as Json).name).toBe("Bean");
  expect(collection.about).toMatchObject({ "@type": "Event", startDate: "2025-05-03" });
});

for (const [path, state] of [
  ["/2025/senate/tas", "Tasmania"],
  ["/2025/senate/nsw", "New South Wales"],
  ["/2019/senate/nsw", "New South Wales"],
] as const) {
  test(`${path} lists every group's candidates as Person items in printed order`, async ({
    page,
  }) => {
    await page.goto(path);
    const collection = await ballotPage(page);
    expect((collection.spatialCoverage as Json).name).toBe(state);
    const groups = (collection.mainEntity as Json).itemListElement as Json[];
    const headings = await page.locator("article h2").allInnerTexts();
    expect(groups.map((g) => g.position)).toEqual(headings.map((_, i) => i + 1));
    expect(groups.map((g) => (g.item as Json).name)).toEqual(
      headings.map((h) => (h.trim() === "Group UG" ? "Ungrouped" : h.trim())),
    );
    const lists = page.locator("article h2 + ul.rows");
    for (let i = 0; i < groups.length; i++) {
      expectSameBallot(groups[i]!.item as Json, await rows(lists.nth(i)));
    }
  });
}

test("a held election's landing page describes it as an Event", async ({ page }) => {
  await page.goto("/2022");
  const [event] = await jsonLd(page, "Event");
  expect(event).toMatchObject({
    name: "2022 Federal Election",
    url: "https://how2vote.au/2022",
    startDate: "2022-05-21",
    endDate: "2022-05-21",
    eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", address: { addressCountry: "AU" } },
    organizer: { name: "Australian Electoral Commission" },
  });
});
