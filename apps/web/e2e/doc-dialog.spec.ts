import { expect, test, type Page } from "@playwright/test";
import { seedEligibility, waitForHydration } from "./flow-helpers";

/**
 * Policy links raised by a transient decision surface open the document OVER the current page.
 *
 * The consent banner's "privacy notice" link and the Terms gate's "Terms of Use" link are both
 * mid-decision surfaces: navigating away would abandon the decision the surface exists to collect
 * and leave no obvious way back, so the document has to come to the reader rather than the reader
 * going to the document.
 *
 * What must stay true alongside that:
 *   - the URL is still real (so it can be shared, printed, indexed, and demanded by Play), and a
 *     modified click still navigates;
 *   - the dialog shows the SAME document as the page, not a summary of it;
 *   - the app's global keyboard shortcuts stop while any modal is up.
 */

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

/** Reach the research opt-in gate at /survey — the mid-decision surface the questions begin from. */
async function reachSurveyGate(page: Page): Promise<void> {
  await page.goto("/2025");
  await waitForHydration(page);
  await page.getByRole("button", { name: "See how my views compare" }).click();
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByLabel("Search electorates").fill("Bean");
  await page.getByRole("button", { name: /^Bean\b/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  for (let i = 0; i < 50; i++) {
    await expect(page.locator("span.label")).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press("4");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  await expect(page).toHaveURL(/\/survey/);
}

/** Reach the comparison stage, where "Build my plan" raises the Terms gate. */
async function reachCompare(page: Page): Promise<void> {
  await reachSurveyGate(page);
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card/);
}

test("the Terms gate's link opens the terms over the gate, without losing the pending action", async ({
  page,
}) => {
  await reachCompare(page);
  await page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }).click();
  const gate = page.getByRole("group", { name: "Terms of Use acceptance" });
  await expect(gate).toBeVisible();

  const urlBefore = page.url();
  await gate.getByRole("link", { name: "Terms of Use" }).click();

  const dialog = page.getByRole("dialog", { name: "Terms of use" });
  await expect(dialog).toBeVisible();
  // The whole point: we did not go anywhere, and the gate is still behind the dialog waiting.
  expect(page.url()).toBe(urlBefore);

  // The same document, not a précis of it. Asserted against the page's own rendered text rather
  // than a literal, so the two cannot drift apart.
  const dialogText = ((await dialog.locator(".prose").innerText()) ?? "").replace(/\s+/g, " ");
  const page2 = await page.context().newPage();
  await page2.goto("/terms");
  const pageText = ((await page2.locator("article.prose").innerText()) ?? "").replace(/\s+/g, " ");
  await page2.close();
  // The route's <article> also carries the h1 the dialog puts in its own header, so compare the
  // body: every paragraph of the page must be present in the dialog.
  expect(dialogText.length).toBeGreaterThan(2000);
  expect(pageText).toContain(dialogText.slice(0, 400));

  // Escape closes it (the native dialog's own behaviour) and the gate is still there, unaccepted.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(gate).toBeVisible();
  await expect(gate.getByRole("checkbox")).not.toBeChecked();

  // And the pending action still completes — the gate was suspended, not discarded.
  await gate.getByRole("checkbox").check();
  await gate.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page.locator(".worksheet")).toBeVisible();
});

test("the policy link is still a real link", async ({ page }) => {
  await reachCompare(page);
  await page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }).click();
  const link = page
    .getByRole("group", { name: "Terms of Use acceptance" })
    .getByRole("link", { name: "Terms of Use" });

  // A real href, so "copy link address", the browser status bar, indexing and Play's
  // privacy-policy-URL requirement all still work.
  await expect(link).toHaveAttribute("href", "/terms");

  // A modified click is the reader asking for actual navigation; only a plain click is intercepted.
  //
  // Asserted by waiting for the tab it opens, NOT by checking the dialog is absent: `toBeHidden()`
  // is satisfied the instant it is called, so against an async click handler it passes before the
  // handler has even resolved.
  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    link.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  // waitForURL, not waitForLoadState: a background tab is created at about:blank and navigates
  // afterwards, so the load state can settle before the real URL is in place.
  await tab.waitForURL(/\/terms\/?$/);
  await tab.close();
  await expect(page.getByRole("dialog", { name: "Terms of use" })).toBeHidden();
});

test("the research gate's policy link opens over the gate, keeping the consent it is collecting", async ({
  page,
}) => {
  // The gate's consent state is component-local, so any navigation away from it discards the ticks
  // — returning by the page's back control, browser Back or the Android gesture all remount the
  // gate un-ticked. The policy therefore has to open over the gate.
  await reachSurveyGate(page);
  const consent = page.getByRole("checkbox", { name: /consent to National Digital collecting/ });
  await consent.check();

  const urlBefore = page.url();
  // Scoped to the main landmark: the footer carries a "Privacy policy" link that must keep
  // navigating, so an unscoped locator is ambiguous.
  await page.locator("#main").getByRole("link", { name: "Privacy policy" }).click();

  const dialog = page.getByRole("dialog", { name: "Privacy policy" });
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  // The same document the page publishes, not a summary — compared against the route's own
  // rendered text rather than a literal, so the two cannot drift.
  const dialogText = (await dialog.locator(".prose").innerText()).replace(/\s+/g, " ");
  const ref = await page.context().newPage();
  await ref.goto("/privacy");
  const pageText = (await ref.locator("article.prose").innerText()).replace(/\s+/g, " ");
  await ref.close();
  expect(dialogText.length).toBeGreaterThan(2000);
  expect(pageText).toContain(dialogText.slice(0, 400));

  // The assertion that carries the fix: the decision survived reading the document.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(urlBefore);
  await expect(consent).toBeChecked();

  // …and the gate can still be completed from here, which is what "did not lose the flow" means.
  await page.getByRole("checkbox", { name: /read and agree to the Terms of Use/ }).check();
  await expect(
    page.getByRole("button", { name: "Contribute my answers and continue" }),
  ).toBeEnabled();
});

test("the research gate's Terms link opens over the gate too", async ({ page }) => {
  // The gate asks for two separate decisions and links the document behind each, so both links
  // carry the same requirement. This one sits inside the Terms checkbox's own label.
  await reachSurveyGate(page);
  const consent = page.getByRole("checkbox", { name: /consent to National Digital collecting/ });
  await consent.check();

  const urlBefore = page.url();
  await page.locator("#main").getByRole("link", { name: "Terms of Use" }).click();

  const dialog = page.getByRole("dialog", { name: "Terms of use" });
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(consent).toBeChecked();
});

test("the corrections log renders the same body on its page and inside a dialog", async ({
  page,
}) => {
  // Guards the move of the corrections body into $lib/content: the page must still publish the
  // whole log, and the cross-reference inside the body must open over rather than navigate, since
  // that body is also rendered in a dialog over a comparison.
  //
  // The card's own `<DocLink href="/corrections">` is not reachable from this suite: it renders only
  // when a proposition is withdrawn, which the signed control plane drives and a test cannot forge.
  // The registry entry is exercised here through the shared body instead.
  await page.goto("/corrections");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Correction log" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Methodology change log" })).toBeVisible();
  await expect(page.getByText(/No corrections yet/)).toBeVisible();

  const urlBefore = page.url();
  const main = page.locator("#main");
  await main.getByRole("link", { name: "how it works", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "How it works" });
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  // The contact route is a destination the reader chose, not a document raised mid-decision, so it
  // stays a real navigation — the rule is per call site, and this is the side of it that navigates.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await main.getByRole("link", { name: "contact page" }).click();
  await expect(page).toHaveURL(/\/contact\/?$/);
});

test("an open modal suspends the quiz's answer keys", async ({ page }) => {
  // The quiz binds bare 1–5 and ArrowLeft on a `window` handler, and key events still reach
  // `window` from inside a modal dialog — so a digit typed into a dialog must reach the textarea
  // and must not answer the question behind it (see $lib/modal).
  await page.goto("/2025");
  await waitForHydration(page);
  await page.getByRole("button", { name: "See how my views compare" }).click();
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByLabel("Search electorates").fill("Bean");
  await page.getByRole("button", { name: /^Bean\b/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  await expect(page.locator("span.label")).toHaveText("Question 1 of 50");

  await page.getByRole("button", { name: "Send feedback" }).click();
  const box = page.getByLabel("Your feedback");
  await expect(box).toBeVisible();
  await box.click();
  await page.keyboard.type("15 boxes");

  // The character reached the textarea …
  await expect(box).toHaveValue("15 boxes");
  // … and did NOT answer the question behind the dialog.
  await expect(page.locator("span.label")).toHaveText("Question 1 of 50");

  // Closing it hands the shortcuts back, or the fix would have broken the quiz instead.
  await page.getByRole("button", { name: "Close feedback" }).click();
  await expect(box).toBeHidden();
  await page.keyboard.press("5");
  await expect(page.locator("span.label")).toHaveText("Question 2 of 50");
});

test("an in-flow link to the methodology opens it over the comparison", async ({ page }) => {
  // The footer's /methodology link still navigates, but a "how the scoring works" aside next to a
  // comparison the reader is reading opens over the page. Same document, different reader intent.
  await page.goto("/2025/parties");
  await waitForHydration(page);
  const urlBefore = page.url();
  await page.getByRole("link", { name: "how the scoring works" }).click();

  const dialog = page.getByRole("dialog", { name: "How it works" });
  await expect(dialog).toBeVisible();
  expect(page.url()).toBe(urlBefore);

  // The page's body, not a summary of it — compared against the route's own rendered text.
  const dialogText = (await dialog.locator(".prose").innerText()).replace(/\s+/g, " ");
  const ref = await page.context().newPage();
  await ref.goto("/methodology");
  const pageText = (await ref.locator("article.prose").innerText()).replace(/\s+/g, " ");
  await ref.close();
  expect(dialogText.length).toBeGreaterThan(2000);
  expect(pageText).toContain(dialogText.slice(0, 400));

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(urlBefore);
});

test("every way out of the dialog puts focus back on the link that opened it", async ({ page }) => {
  // Unmounting the component removes the <dialog> instead of closing it while connected, so the
  // browser's restore-focus step never runs and focus falls to <body>. Escape is unaffected only
  // because it is already a native close, so every exit path (Escape, ×, Done) is asserted
  // separately.
  await page.goto("/2025/parties");
  await waitForHydration(page);
  const link = page.getByRole("link", { name: "how the scoring works" });
  const dialog = page.getByRole("dialog", { name: "How it works" });
  const focusedText = (): Promise<string | undefined> =>
    page.evaluate(() => document.activeElement?.textContent?.trim());

  for (const exit of ["Escape", "×", "Done"] as const) {
    await link.click();
    await expect(dialog).toBeVisible();
    if (exit === "Escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: exit === "×" ? /Close/ : "Done" }).click();
    await expect(dialog).toBeHidden();
    expect(await focusedText(), `focus after closing via ${exit}`).toBe("how the scoring works");
  }
});

test("the footer's link to the same document still navigates", async ({ page }) => {
  // The counterpart to the test above, and the reason DocLink is opt-in per call site: a reader who
  // deliberately picks "How it works" out of the footer asked to GO there. If this ever starts
  // opening a dialog, the rule has collapsed into "no link ever navigates", which is not the rule.
  await page.goto("/methodology");
  await page.goto("/glossary");
  await waitForHydration(page);
  await page.getByRole("contentinfo").getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/methodology\/?$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
