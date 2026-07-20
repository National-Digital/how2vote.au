import { expect, test, type Page } from "@playwright/test";

// Insights is closed on any registered election's election day, from 00:00 until the last national
// poll close (8 pm AEST). Freezing the browser clock to 2025's polling day (polls closed
// 2025-05-03T20:00:00+10:00) exercises the real window without needing a future fixture — the close
// keys off `now` vs each election's fixed polling day, so a past election's window still drives it
// under a mocked clock. The gate is client-side against the visitor's clock, which page.clock drives.
//
// A representative instant well inside the window (midday) — not a boundary; the exact 00:00/8pm
// edges are pinned in packages/data-schema/src/elections.test.ts, so here we just need "clearly
// during" vs "clearly after".
const DURING_CLOSED_WINDOW = new Date("2025-05-03T12:00:00+10:00");
const AFTER_POLLS_CLOSE = new Date("2025-05-03T21:00:00+10:00");

const CLOSED_HEADING = "Insights are closed for election day";

/** Records every /stats/* asset the page requests, so we can assert the aggregates are/aren't fetched. */
function trackStatsRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/stats/")) urls.push(req.url());
  });
  return urls;
}

test("closes the analysis and fetches no /stats during the election-day window", async ({
  page,
}) => {
  await page.clock.install({ time: DURING_CLOSED_WINDOW });
  const statsRequests = trackStatsRequests(page);

  await page.goto("/insights");

  await expect(page.getByRole("heading", { name: CLOSED_HEADING })).toBeVisible();
  await expect(page.getByText("Check back after polls close nationally")).toBeVisible();
  // The withheld aggregates must never reach the browser: no /stats request is made at all.
  expect(statsRequests).toHaveLength(0);
  // The analysis body (its lead paragraph) is not rendered.
  await expect(page.getByText("These figures come from the optional survey")).toHaveCount(0);
});

test("shows the analysis (and fetches /stats) once polls have closed", async ({ page }) => {
  await page.clock.install({ time: AFTER_POLLS_CLOSE });
  const statsRequests = trackStatsRequests(page);

  await page.goto("/insights");

  // Not closed: the notice is absent and the page attempts to load the aggregates as normal.
  await expect(page.getByRole("heading", { name: CLOSED_HEADING })).toHaveCount(0);
  await expect(page.getByText("These figures come from the optional survey")).toBeVisible();
  await expect.poll(() => statsRequests.length).toBeGreaterThan(0);
});
