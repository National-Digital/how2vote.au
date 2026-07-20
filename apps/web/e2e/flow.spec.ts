import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

const QUESTIONS = 50;

// Start every test past the age-first gate — the gate itself is proven in age-gate.spec.ts.
test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

async function pickBean(page: Page): Promise<void> {
  // The only cold-load click: retry until it navigates, so a click landing a beat before hydration
  // attaches the handler doesn't flake the test (mirrors saved.spec's helper).
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  // Confirmation map step: the chosen electorate is shown on a state map before the quiz starts.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bean");
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
}

test("the full AEC derivative-product licence notice is shown next to the confirmation map", async ({
  page,
}) => {
  await page.goto("/2025");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();

  const figure = page.locator("figure.map");
  await expect(figure).toBeVisible();
  // The prescribed notice lives in a keyboard-operable disclosure adjacent to the map; the AEC
  // Spatial Data Download licence requires the full notice, not just the short attribution credit.
  const disclosure = figure.getByText("Map data and licence");
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(figure.getByText(/incorporates data that is/i)).toBeVisible();
  await expect(
    figure.getByText(/with the permission of the Australian Electoral Commission/i),
  ).toBeVisible();
});

/** Answers every question with the keyboard, gated on each advance (the top-bar label is unique). */
async function answerAll(page: Page, key: string): Promise<void> {
  const label = page.locator("span.label");
  for (let i = 0; i < QUESTIONS; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of ${QUESTIONS}`);
    await page.keyboard.press(key);
  }
}

test("keyboard-only: ballot → 50 questions → review → card", async ({ page }) => {
  // Drive the 2025 ballot flow (the default election is now the ballot-less "next" comparison).
  await page.goto("/2025");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("How do your views compare?");

  await pickBean(page);
  await answerAll(page, "5");

  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("All 50 answered");
  await page.getByRole("button", { name: "See how I compare" }).click();

  await expect(page).toHaveURL(/\/survey/);
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();

  await expect(page).toHaveURL(/\/card#v1\./);
  await expect(page.getByText("House of Representatives")).toBeVisible();
  await expect(page.getByText("Senate", { exact: true })).toBeVisible();
  // The two chambers are demarcated by their real-world ballot-paper cues.
  await expect(page.getByText(/Green ballot paper/)).toBeVisible();
  await expect(page.getByText(/White ballot paper/)).toBeVisible();
  // The results screen lists no candidates: alignment is shown as evidence in the party panel (a
  // percentage), not as a ranking against candidate names.
  await expect(page.locator("section.ballot .party-panel .pct").first()).toBeVisible();
  await expect(page.locator("section.ballot .rows")).toHaveCount(0);
  // The comparison stage offers building your own plan — it never assigns preference numbers itself.
  // Shipped elections are all past → archived, so the builder is labelled a demonstration; a live
  // election would read "Build my voting plan".
  const build = page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ });
  await expect(build).toBeVisible();

  // Open the plan builder (through the versioned Terms gate): the ballot the voter numbers lives
  // here, not on the results screen.
  await build.click();
  const gate = page.getByRole("group", { name: "Terms of Use acceptance" });
  await gate.getByRole("checkbox").check();
  await gate.getByRole("button", { name: "Accept and continue" }).click();

  // In the build stage the Senate defaults to the above-the-line (group) view; the per-column
  // candidate list only appears once the voter switches to below the line — never both at once.
  await expect(page.getByRole("button", { name: "Above the line" })).toBeVisible();
  await expect(page.locator("p.col")).toHaveCount(0);
  await page.getByRole("button", { name: "Below the line" }).click();
  await expect(page.locator("p.col").first()).toBeVisible();
});

test("a hard refresh mid-quiz resumes on the same question, not the ballot", async ({ page }) => {
  await page.goto("/2025");
  await pickBean(page);

  const label = page.locator("span.label");
  await expect(label).toHaveText("Question 1 of 50");
  await page.keyboard.press("5");
  await expect(label).toHaveText("Question 2 of 50");
  await page.keyboard.press("4");
  await expect(label).toHaveText("Question 3 of 50");

  // A full reload rebuilds the client from scratch: the store must rehydrate from localStorage
  // before the page acts on it, so the visitor lands back on question 3 rather than being bounced
  // to /ballot (which would silently discard their in-progress answers).
  await page.reload();
  await expect(page).toHaveURL(/\/quiz/);
  await expect(label).toHaveText("Question 3 of 50");
});

test("issues are starred as extremely important on the review screen", async ({ page }) => {
  await page.goto("/2025");
  await pickBean(page);

  // Answering strongly agree (5) makes every row an extreme, so every row gets a star toggle.
  await answerAll(page, "5");
  await expect(page).toHaveURL(/\/review/);

  const stars = page.getByRole("button", { name: /^Mark ".*" as extremely important$/ });
  await expect(stars).toHaveCount(QUESTIONS);

  const first = stars.first();
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");

  // The ×10 flag survives a round-trip to the card and back to review.
  await page.getByRole("button", { name: "See how I compare" }).click();
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card#v1\./);
  await page.getByRole("link", { name: "Change my answers" }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(
    page.getByRole("button", { name: /^Mark ".*" as extremely important$/ }).first(),
  ).toHaveAttribute("aria-pressed", "true");
});

test("editing one answer from review returns to the summary, not the rest of the quiz", async ({
  page,
}) => {
  await page.goto("/2025");
  await pickBean(page);
  await answerAll(page, "5");
  await expect(page).toHaveURL(/\/review/);

  // Jump back to the 10th question from the review list.
  const rows = page.locator("ol.rev button.edit");
  await rows.nth(9).click();
  await expect(page).toHaveURL(/\/quiz\?edit=1/);
  await expect(page.locator("span.label")).toHaveText("Question 10 of 50");

  // Re-answering sends us straight back to the summary — not on to question 11.
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("All 50 answered");
  await expect(rows.nth(9)).toContainText("Disagree");
});

test("the back arrow while editing returns to the summary without changing the answer", async ({
  page,
}) => {
  await page.goto("/2025");
  await pickBean(page);
  await answerAll(page, "5");

  const rows = page.locator("ol.rev button.edit");
  await rows.nth(4).click();
  await expect(page).toHaveURL(/\/quiz\?edit=1/);
  await page.getByRole("button", { name: "Back to your answers" }).click();

  await expect(page).toHaveURL(/\/review$/);
  await expect(rows.nth(4)).toContainText("Strongly agree");
});

test("moderate answers cannot be starred on the review screen", async ({ page }) => {
  await page.goto("/2025");
  await pickBean(page);

  // "Agree" (4) is a moderate answer, so importance never attaches — no star toggles appear.
  await answerAll(page, "4");
  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByRole("button", { name: /as extremely important$/ })).toHaveCount(0);
});

test("a shared card link recomputes offline", async ({ page, context }) => {
  await page.goto("/2025");
  await pickBean(page);
  await answerAll(page, "3");
  await page.getByRole("button", { name: "See how I compare" }).click();
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card#v1\./);
  const shareUrl = page.url();

  // Let the service worker install and take control, then cut the network.
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.goto(shareUrl);
  await expect(page.getByText("House of Representatives")).toBeVisible();
  await context.setOffline(false);
});

test("an old how2vote.com.au card link (?res=) explains itself instead of erroring", async ({
  page,
}) => {
  await page.goto("/card?res=5f2a9c1e3b7d");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "This card can't be opened any more",
  );
  await expect(page.getByText("old site")).toBeVisible();
  await expect(page.getByRole("link", { name: "Make a new card" })).toHaveAttribute(
    "href",
    "/ballot",
  );
});

test("propositions link to their parliamentary evidence", async ({ page }) => {
  await page.goto("/2025");
  await pickBean(page);
  const evidence = page.getByRole("link", { name: /parliamentary votes behind this/ });
  await expect(evidence).toHaveAttribute("href", /theyvoteforyou\.org\.au\/policies\/\d+/);
});

test("election toggle switches the question set (2022 → 36 questions)", async ({ page }) => {
  await page.goto("/2025");
  // The 2025 election set: 50 questions (the app default is now the ballot-less "next" comparison).
  await expect(page.getByText(/Answer 50 real questions/)).toBeVisible();

  // The toggle is a link to the per-election landing path.
  await page
    .getByRole("group", { name: "Choose an election" })
    .getByRole("link", { name: "2022" })
    .click();
  await expect(page).toHaveURL(/\/2022$/);
  await expect(page.getByText(/Answer 36 real questions/)).toBeVisible();
  await expect(page.getByText(/already been held/)).toBeVisible();

  // The quiz now runs the 2022 set. Historical elections confirm without a boundary map
  // (no 2022 boundary set is shipped), so the confirmation screen is text-only.
  await page.getByRole("button", { name: "See how my views compare" }).click();
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bean");
  await expect(page.locator("figure.map")).toHaveCount(0);
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  await expect(page.locator("span.label")).toHaveText("Question 1 of 36");
});

test("a per-election landing carries its own social preview and canonical", async ({ page }) => {
  await page.goto("/2022");
  await expect(page).toHaveTitle(/2022 Federal Election/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/2022$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /og-2022\.png$/,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    /2022 Federal Election/,
  );
  await expect(page.getByText(/Answer 36 real questions/)).toBeVisible();
});
