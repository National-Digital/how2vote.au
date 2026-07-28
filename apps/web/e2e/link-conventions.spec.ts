import { expect, test } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

/**
 * The two link conventions that are about not surprising the reader.
 *
 *   - A glossary word in body copy answers itself in place. Sending someone to /glossary and back
 *     to look up one word is a page-sized answer to a sentence-sized question, and on the pages
 *     where these words appear the reader is usually part-way through something.
 *   - A link that opens a new tab says so BEFORE it is clicked, via a cue in the link itself rather
 *     than an interstitial on the way out (see ExternalLink.svelte).
 *
 * In both cases the underlying link must survive intact — a real href, a real target — because the
 * whole design depends on the enhancement being removable without breaking anything.
 */

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

test("a glossary word defines itself in place", async ({ page }) => {
  await page.goto("/2025/issues");
  const term = page.getByRole("link", { name: "divisions" });
  await expect(term).toBeVisible();

  // Still a real deep link into the glossary page: the no-JS fallback, and what "open in new tab"
  // and "copy link address" give you.
  await expect(term).toHaveAttribute("href", "/glossary#division");

  const urlBefore = page.url();
  await term.click();

  const pop = page.getByRole("dialog", { name: /^Definition: Division$/ });
  await expect(pop).toBeVisible();
  // The point of the whole exercise: the answer came to the reader.
  expect(page.url()).toBe(urlBefore);

  // The SAME definition the glossary page publishes, compared against the page's own rendered
  // text rather than a literal, so the two cannot drift apart.
  const shown = (await pop.innerText()).replace(/\s+/g, " ");
  const ref = await page.context().newPage();
  await ref.goto("/glossary");
  const canonical = (await ref.locator("dt#division + dd").innerText()).replace(/\s+/g, " ");
  await ref.close();
  expect(canonical.length).toBeGreaterThan(40);
  expect(shown).toContain(canonical);

  // Escape closes it and puts the reader back on the word they were reading. Chromium's popover
  // engine restores focus itself, so this locks the platform behaviour the design depends on; the
  // component's own focus-restore call targets engines without it (WKWebView), which this suite
  // cannot reach.
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(term).toBeFocused();
});

test("the glossary word is still a real link", async ({ page }) => {
  await page.goto("/2025/issues");
  const term = page.getByRole("link", { name: "divisions" });

  // A modified click is the reader asking for the glossary page itself. Asserted by waiting for
  // the tab it opens — `toBeHidden()` on the popover would pass before the click handler had even
  // run.
  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    term.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await tab.waitForURL(/\/glossary#division$/);
  await tab.close();
});

test("a link that opens a new tab says so", async ({ page }) => {
  await page.goto("/methodology");

  // getByRole matches on the COMPUTED ACCESSIBLE NAME, so this asserts what a screen reader
  // actually announces — not merely that the words exist somewhere in the DOM. The visible ↗ is
  // aria-hidden precisely so it is not announced as punctuation, and would fail an exact match if
  // that ever regressed.
  // Scoped to the document body: the footer credits the same source, and both carry the cue —
  // which is the point, but it makes an unscoped locator ambiguous.
  const tvfy = page
    .locator("#main")
    .getByRole("link", { name: "They Vote For You (opens in a new tab)" });
  await expect(tvfy).toBeVisible();

  await expect(tvfy).toHaveAttribute("target", "_blank");
  // rel is not hygiene here: target="_blank" without noopener hands the opened page a live
  // `window.opener` reference back into this one.
  await expect(tvfy).toHaveAttribute("rel", /noopener/);
  await expect(tvfy).toHaveAttribute("rel", /noreferrer/);

  // …and the cue is not painted on top of the reader: it must be invisible to sighted users, or
  // every external link in the body copy would grow a parenthetical.
  //
  // Asserted on GEOMETRY, not text. innerText returns clipped-but-rendered content, so comparing
  // the link's text would have passed with the cue plainly visible on screen — it reads the DOM,
  // not the pixels. The clip-rect technique keeps the span in the accessibility tree precisely
  // BECAUSE it is still laid out, so its box is what distinguishes hidden from shown.
  const cueSpan = tvfy.locator(".visually-hidden");
  await expect(cueSpan).toHaveCount(1);
  const box = await cueSpan.boundingBox();
  expect(
    box,
    "the cue span must still be laid out (display:none would drop it from the name)",
  ).not.toBeNull();
  expect(box!.width, "the cue must not be visible on screen").toBeLessThanOrEqual(2);
  expect(box!.height, "the cue must not be visible on screen").toBeLessThanOrEqual(2);
});
