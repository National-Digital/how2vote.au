import { expect, test, type Page } from "@playwright/test";

/**
 * age-gate — the age-first eligibility gate (docs/adr/0011).
 *
 * Runtime proofs, at the real surface, of the load-bearing invariants:
 *   1. the 18+ declaration is the FIRST interactive step — reached before any quiz state exists, and
 *      every gated route fails closed to it until eligibility is affirmed;
 *   2. declaring under-18 clears any pre-existing local quiz / saved-card state and keeps the
 *      quiz / research / save / share / print routes blocked, offering general information only;
 *   3. the eligibility answer never travels over the network, and the only thing persisted is a
 *      single "1" bit — never an age, band or date of birth.
 *
 * This spec deliberately does NOT seed the eligibility flag (the other flow specs do, via
 * flow-helpers) because it is the one that drives the gate itself.
 */

const AGE_KEY = "how2vote:age-ok:v1";
const GATED = ["/ballot", "/quiz", "/card", "/saved"];

async function localKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage));
}

test("the gate is the first step and no quiz state exists before it", async ({ page }) => {
  await page.goto("/");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/start/);
  }).toPass({ timeout: 15_000 });

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/18 or older/);

  // Nothing about the quiz — or the eligibility bit — has been written before the declaration.
  const keys = await localKeys(page);
  expect(keys.some((k) => k.startsWith("how2vote:quiz"))).toBe(false);
  expect(keys).not.toContain(AGE_KEY);
});

test("every gated route fails closed to the gate until eligibility is affirmed", async ({
  page,
}) => {
  for (const route of GATED) {
    await page.goto(route);
    await expect(page, `${route} must redirect to the age gate`).toHaveURL(/\/start/);
    const keys = await localKeys(page);
    expect(
      keys.some((k) => k.startsWith("how2vote:quiz")),
      `no quiz state from ${route}`,
    ).toBe(false);
  }
});

test("confirming returns to the requested route and persists a single eligibility bit", async ({
  page,
}) => {
  // Deep-link to a gated route: the guard remembers it and returns there after the declaration.
  await page.goto("/ballot");
  await expect(page).toHaveURL(/\/start/);
  // Cold-load click: retry until it navigates, so a click landing a beat before hydration
  // attaches the handler doesn't flake (mirrors flow.spec / saved.spec).
  await expect(async () => {
    await page.getByRole("button", { name: /18 or older/ }).click();
    // Returns to the requested /ballot; for the ballot-less default election that continues straight
    // to the quiz, so accept either.
    await expect(page).toHaveURL(/\/(ballot|quiz)/);
  }).toPass({ timeout: 15_000 });

  // The ONLY age-related thing persisted is a bare "1" — no age, band or date of birth.
  expect(await page.evaluate((k) => localStorage.getItem(k), AGE_KEY)).toBe("1");
});

test("a confirmed adult stays past the gate across a reload (resume works)", async ({ page }) => {
  await page.goto("/start");
  // Cold-load click: retry until it navigates, so a click landing a beat before hydration
  // attaches the handler doesn't flake (mirrors flow.spec / saved.spec).
  await expect(async () => {
    await page.getByRole("button", { name: /18 or older/ }).click();
    await expect(page).toHaveURL(/\/(ballot|quiz)/);
  }).toPass({ timeout: 15_000 });
  await page.reload();
  await expect(page).toHaveURL(/\/(ballot|quiz)/);
});

test("declaring under-18 clears prior state, persists nothing, and continues in explore-only mode", async ({
  page,
}) => {
  // Land on the (ungated) gate, then simulate leftovers from a prior adult session on this device.
  await page.goto("/start");
  await page.evaluate(() => {
    localStorage.setItem(
      "how2vote:quiz:v2:2025",
      JSON.stringify({
        state: "ACT",
        electorate: "Bean",
        answers: { 1: { points: 5, important: false } },
        cursor: 3,
        questionIds: [1, 2, 3],
        updatedAt: Date.now(),
      }),
    );
    localStorage.setItem(
      "how2vote:saved:v1",
      JSON.stringify([{ url: "/card#v1.abc", title: "A card", savedAt: Date.now() }]),
    );
  });
  // Reload so the quiz / saved stores hydrate the seeded values, then declare under-18.
  await page.reload();
  await expect(page).toHaveURL(/\/start/);
  // Cold-load click after a reload: retry until the declaration takes (pre-hydration click safety).
  await expect(async () => {
    await page.getByRole("button", { name: /under 18/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /see how your views compare/i,
    );
  }).toPass({ timeout: 15_000 });

  // Explore-mode explainer with lawful-alternative links, and the pre-existing quiz + saved state
  // (a prior adult session's) is cleared — an under-18 never inherits a plan built before the gate.
  await expect(page.getByRole("link", { name: /Enrol early with the AEC/ })).toBeVisible();
  const keys = await localKeys(page);
  expect(
    keys.some((k) => k.startsWith("how2vote:quiz")),
    "quiz state cleared",
  ).toBe(false);
  expect(keys, "saved cards cleared").not.toContain("how2vote:saved:v1");
  expect(keys, "no eligibility ever stored for an under-18 declaration").not.toContain(AGE_KEY);

  // The 18+-only surfaces stay blocked (a comparison is educational; research + saving are 18+).
  for (const route of ["/survey", "/saved"]) {
    await page.goto(route);
    await expect(page, `${route} stays blocked for an under-18`).toHaveURL(/\/start/);
  }
});

test("an under-18 reaches the comparison but is never offered a how-to-vote card", async ({
  page,
}) => {
  // Walks the full ballot flow (electorate + 50 questions), so run against a past election with a
  // ballot — the default is now the ballot-less "next" comparison.
  await page.goto("/2025");
  // The home CTA lands on the age gate (this spec does not seed eligibility).
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/start/);
  }).toPass({ timeout: 15_000 });

  // Declare under-18 → explore explainer, then continue into the quiz. Continuing is a CLIENT-SIDE
  // navigation, which keeps the in-memory explore state; a hard load would fail closed to the gate.
  await expect(async () => {
    await page.getByRole("button", { name: /under 18/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /see how your views compare/i,
    );
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Continue to the quiz" }).click();
  await expect(page).toHaveURL(/\/ballot/);

  // Walk the flow: electorate → 50 questions → review.
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bean");
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);

  const label = page.locator("span.label");
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press("5");
  }

  // An under-18 skips the 18+ research survey and goes straight to the comparison.
  await expect(page).toHaveURL(/\/review/);
  await page.getByRole("button", { name: "See how I compare" }).click();
  await expect(page).toHaveURL(/\/card/);
  await expect(page).not.toHaveURL(/\/survey/);

  // The comparison (the educational result) IS shown...
  await expect(page.getByText("House of Representatives")).toBeVisible();
  await expect(page.locator("span.pct").first()).toBeVisible();
  // ...but NO how-to-vote card can be built, shared or saved.
  await expect(
    page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Share this comparison/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save on this device/ })).toHaveCount(0);
  // Instead, the result points to lawful ways to take part, tied to their electorate.
  await expect(page.getByRole("link", { name: /Contact the member for Bean/ })).toBeVisible();

  // Fail closed: the explore capability is session-only — a hard reload drops it and returns to the
  // gate, and nothing about the under-18 session was ever persisted.
  await page.reload();
  await expect(page).toHaveURL(/\/start/);
  const keys = await localKeys(page);
  expect(keys, "no eligibility bit persisted for an under-18 session").not.toContain(AGE_KEY);
});

test("the eligibility answer is never sent over the network", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    // Capture the body of any non-navigation request that could carry data.
    if (r.method() === "POST" || r.method() === "PUT")
      requests.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`);
  });

  await page.goto("/start");
  // Cold-load click: retry until it navigates, so a click landing a beat before hydration
  // attaches the handler doesn't flake (mirrors flow.spec / saved.spec).
  await expect(async () => {
    await page.getByRole("button", { name: /18 or older/ }).click();
    await expect(page).toHaveURL(/\/(ballot|quiz)/);
  }).toPass({ timeout: 15_000 });
  await page.waitForTimeout(300);

  // Passing the gate makes no upload at all — the eligibility declaration never leaves the device.
  expect(requests, "no request carries the eligibility answer").toEqual([]);
});
