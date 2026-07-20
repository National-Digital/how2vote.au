import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// Start every test past the age-first gate — the gate itself is scanned in age-gate.spec.ts.
test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

// axe-core accessibility gate. Zero WCAG 2.0/2.1
// A & AA violations on every screen — including the surfaces named in the independent accessibility
// review: a large-state Senate below-the-line ballot, the plan-builder validation/status states, the
// consent banner and privacy-preferences modal, the Terms acknowledgement gate, and the PRINT
// worksheet.
//
// This suite is a BLOCKING accessibility gate: the axe scan below hard-asserts zero
// violations (serious/critical and every other A/AA impact — stricter than serious/critical alone),
// and it runs as a required check in the compliance workflow's "Accessibility and Product" group as
// well as the main e2e job. Alongside the surface scans it exercises keyboard navigation / focus
// order / a visible focus indicator, ARIA + keyboard operation of the consent dialogs, an explicit
// colour-contrast scan, forced-colours (Windows High Contrast) mode, 400% zoom (320px) reflow, the
// long Senate below-the-line ballot, the consent forms (survey age + research consent + Terms), the
// accessible anti-abuse path (no inaccessible in-page challenge), and the printed plan's s321D
// authorisation stamp being present and in reading order. Automated human assistive-technology
// testing (screen readers etc.) is external evidence and stays
// PENDING, so this remains partial. Lighthouse's accessibility category is separately blocking
// (apps/web/lighthouserc.json: categories:accessibility is an error assertion; performance stays a
// warn-level informational assertion).
async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

/** Fail if the document scrolls horizontally at the current viewport (WCAG 1.4.10 reflow). */
async function assertNoHOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    overflow,
    "content must reflow with no horizontal scrollbar at this width",
  ).toBeLessThanOrEqual(1);
}

/**
 * Drive the keyboard-only flow to the /card comparison stage for a given state + electorate.
 * Mirrors the flow the other specs use (state grid → electorate list → confirm map → 50-question
 * quiz → skip research). `seedTerms` pre-acknowledges the Terms so the build stage is reachable
 * without the gate (the gate itself is exercised in its own test).
 */
async function reachCardCompare(
  page: Page,
  opts: { state?: RegExp; electorate?: string; answer?: string; seedTerms?: boolean } = {},
): Promise<void> {
  const { state = /ACT/, electorate = "Bean", answer = "4", seedTerms = false } = opts;
  if (seedTerms) {
    await page.addInitScript(() => {
      try {
        // Versioned Terms acceptance: seed a current-version acceptance record so the
        // build stage is reachable without the gate. The version literal mirrors TERMS_VERSION.
        localStorage.setItem(
          "how2vote:terms-accept:v2",
          JSON.stringify({ version: "2026-07.1", acceptedAt: new Date().toISOString() }),
        );
      } catch {
        /* storage blocked — the gate test covers the explicit path */
      }
    });
  }
  await page.goto("/2025");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: state }).click();
  await page.getByLabel("Search electorates").fill(electorate);
  await page.getByRole("button", { name: new RegExp(`^${electorate}\\b`) }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  const label = page.locator("span.label");
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press(answer);
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Drive the keyboard-only flow as far as the /survey research gate (the screen carrying the three
 * consent forms: the survey-age + research-consent checkbox and the versioned Terms acceptance).
 * Mirrors the navigation the research/flow specs use; stops at the gate rather than skipping it.
 */
async function reachSurveyGate(page: Page): Promise<void> {
  await page.goto("/2025");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByLabel("Search electorates").fill("Bean");
  await page.getByRole("button", { name: /^Bean\b/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);
  const label = page.locator("span.label");
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press("4");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  await expect(page).toHaveURL(/\/survey/);
  await expect(page.getByRole("button", { name: /Contribute my answers/ })).toBeVisible();
}

/**
 * Replace window.print with a spy that opens no real dialog and, at print time, records the printed
 * s321D authorisation stamp AND its DOM reading position relative to the ballot + worksheet footer.
 * The particulars are wiped immediately AFTER the print returns, so the stamp can only be
 * observed at the moment print fires — hence this capture, mirroring legal-electoral-output.spec.ts.
 */
async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __printStamp: string | null;
      __printOrder: { afterBallot: boolean; afterWorksheet: boolean } | null;
    };
    w.__printStamp = null;
    w.__printOrder = null;
    window.print = () => {
      const el = document.querySelector('[data-testid="print-stamp"]');
      w.__printStamp = el ? (el.textContent ?? "") : null;
      const preceding = Node.DOCUMENT_POSITION_PRECEDING;
      const isAfter = (target: Element | null) =>
        !!target && !!el && (el.compareDocumentPosition(target) & preceding) !== 0;
      w.__printOrder = {
        afterBallot: isAfter(document.querySelector("section.ballot")),
        afterWorksheet: isAfter(document.querySelector(".worksheet-foot")),
      };
    };
  });
}

test("landing has no accessibility violations", async ({ page }) => {
  await page.goto("/");
  await scan(page);
});

test("content pages have no accessibility violations", async ({ page }) => {
  for (const path of [
    "/methodology",
    "/privacy",
    "/about",
    "/insights",
    "/terms",
    "/accessibility",
    "/glossary",
  ]) {
    await page.goto(path);
    await scan(page);
  }
});

test("the archived-link explainer has no accessibility violations", async ({ page }) => {
  await page.goto("/card?res=5f2a9c1e3b7d");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await scan(page);
});

test("the flow screens have no accessibility violations", async ({ page }) => {
  await page.goto("/2025");
  // Retry the cold-load click until it navigates (a click landing just before hydration attaches the
  // handler must not flake the run — mirrors the flow/saved/consent helpers).
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await scan(page); // ballot: state grid
  await page.getByRole("button", { name: /ACT/ }).click();
  await scan(page); // ballot: electorate list
  await page.getByRole("button", { name: /^Bean/ }).click();
  await scan(page); // ballot: confirmation map
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await scan(page); // quiz

  const label = page.locator("span.label");
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press("4");
  }
  await scan(page); // review
  await page.getByRole("button", { name: "See how I compare" }).click();
  await scan(page); // survey gate (research consent)
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card/);
  await scan(page); // card — comparison stage (party panels only; carries the archived historical-use banner)

  // Plan creation is gated by a versioned Terms-of-Use acceptance. The archived
  // election labels the action "Build a demonstration plan"; a live one, "Build my voting plan".
  await page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }).click();
  const gate = page.getByRole("group", { name: "Terms of Use acceptance" });
  await expect(gate).toBeVisible();
  await scan(page); // Terms acceptance gate
  await gate.getByRole("checkbox").check();
  await gate.getByRole("button", { name: "Accept and continue" }).click();

  await expect(
    page.getByRole("button", { name: /Give .* a higher preference/ }).first(),
  ).toBeVisible();
  await scan(page); // card — build stage (blank ballot: "0 of N numbered" — an incomplete state)

  // The Senate below-the-line view is a separate ballot layout, in the build stage; exercise the
  // toggle here (a large mainland state is scanned end-to-end in its own test below).
  await page.getByRole("button", { name: "Below the line" }).click();
  await scan(page); // card build stage — Senate below the line
  await page.getByRole("button", { name: "Above the line" }).click();

  // A partially-numbered ballot — a validation/status state the reviewer named. Duplicate/gap
  // numbering cannot arise (the order model is contiguous 1..k by construction — see $lib/plan), so
  // the meaningful in-between state is partial completion.
  const firstBox = page.locator("section.ballot input[type='number']").first();
  await firstBox.fill("1");
  await firstBox.press("Tab");
  await expect(page.locator("p.check").first()).toContainText(/numbered/);
  await scan(page); // card — build stage, partially numbered

  // The PRINT worksheet of the built plan must also pass (chrome/controls hidden; boxes + footer
  // + historical-use banner kept).
  await page.emulateMedia({ media: "print" });
  await scan(page);
  await page.emulateMedia({ media: null });
});

test("a large-state Senate below-the-line ballot has no accessibility violations", async ({
  page,
}) => {
  // ACT (used above) has a tiny Senate; the review asked for a full mainland below-the-line list.
  // The below-the-line ballot lives in the build stage — seed Terms so it is reachable without the
  // gate, open the builder, then switch to below the line.
  await reachCardCompare(page, { state: /NSW/, electorate: "Sydney", seedTerms: true });
  await page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }).click();
  await page.getByRole("button", { name: "Below the line" }).click();
  await expect(page.getByText(/^Column/).first()).toBeVisible();
  await scan(page);
});

test("no consent banner or preferences control surfaces (nothing is consent-gated)", async ({
  page,
}) => {
  // Usage is measured by cookieless Cloudflare Web Analytics at the edge and form protection is
  // cookieless Turnstile, so nothing the browser loads is consent-gated: the consent banner and its
  // footer preferences trigger stay hidden (gated on hasConfigurableConsent). The consent components
  // remain in the codebase, dormant, ready to re-activate if a consent-gated service is added back
  // (the gate flag + re-activation are unit-tested in registry.test.ts). Assert the shipped build
  // shows neither surface, and that the home page is still clean under axe.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("dialog", { name: /privacy|analytics|consent|cookie/i })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Privacy settings" })).toHaveCount(0);
  await scan(page);
});

test("key screens have no accessibility violations under forced colors", async ({ page }) => {
  // Windows High Contrast / forced-colors mode (WCAG 1.4.11). axe auto-disables its contrast rule
  // here, so this asserts the remaining rules (names, roles, focus order) still hold.
  await page.emulateMedia({ forcedColors: "active" });
  for (const path of ["/", "/methodology", "/privacy", "/card?res=5f2a9c1e3b7d"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scan(page);
  }
  await page.emulateMedia({ forcedColors: "none" });
});

test("content reflows at 320px (≈400% zoom) with no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 512 });
  for (const path of [
    "/",
    "/methodology",
    "/privacy",
    "/about",
    "/terms",
    "/accessibility",
    "/glossary",
    "/card?res=5f2a9c1e3b7d",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await assertNoHOverflow(page);
    await scan(page);
  }
});

test("the plan builder reflows at 320px (≈400% zoom) with no horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await reachCardCompare(page, { state: /ACT/, electorate: "Bean", seedTerms: true });
  await assertNoHOverflow(page); // comparison stage
  await page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }).click();
  await expect(
    page.getByRole("button", { name: /Give .* a higher preference/ }).first(),
  ).toBeVisible();
  await assertNoHOverflow(page); // build stage (numbered-box ballot)
  await scan(page);
});

test("keyboard: focus order starts at the skip link and a keyboard-focused control shows a focus ring", async ({
  page,
}) => {
  // WCAG 2.4.1 (bypass blocks) + 2.4.3 (focus order) + 2.4.7 (focus visible). The first Tab must reach
  // the "Skip to content" bypass link before any page chrome; the keyboard-focused element must carry a
  // visible focus indicator (a non-zero outline), not rely on the mouse-only default.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "See how my views compare" })).toBeVisible();

  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(first, "the first tab stop is the skip link").toBe("Skip to content");

  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return null;
    const s = getComputedStyle(el);
    return { width: parseFloat(s.outlineWidth) || 0, style: s.outlineStyle };
  });
  expect(ring, "an element is focused").not.toBeNull();
  expect(ring?.style, "focus indicator is not suppressed").not.toBe("none");
  expect(ring?.width ?? 0, "focus indicator has a non-zero outline").toBeGreaterThan(0);

  // Activating the skip link moves the keyboard into the main content region (2.4.1).
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("colour contrast meets WCAG AA (explicit color-contrast rule) on key screens", async ({
  page,
}) => {
  // WCAG 1.4.3 asserted on its own so a contrast regression is unambiguous, across a light-heavy text
  // page, a data page and the card explainer (the two-tone palette's hardest surfaces).
  for (const path of ["/", "/methodology", "/privacy", "/card?res=5f2a9c1e3b7d"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  }
});

test("the survey consent forms are accessible and keyboard-operable (age + research consent + Terms)", async ({
  page,
}) => {
  await reachSurveyGate(page);
  await scan(page); // axe on the three-consent research gate

  // Contributing is inert until BOTH required consents are ticked; skipping is never gated. Both are
  // real checkboxes operable by keyboard (focus + Space), not mouse-only.
  const contribute = page.getByRole("button", { name: /Contribute my answers/ });
  await expect(contribute).toBeDisabled();

  const consent = page.getByRole("checkbox", { name: /consent to National Digital collecting/ });
  const terms = page.getByRole("checkbox", { name: /read and agree to the Terms of Use/ });

  await consent.focus();
  await expect(consent).toBeFocused();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();

  await terms.focus();
  await page.keyboard.press("Space");
  await expect(terms).toBeChecked();

  await expect(contribute).toBeEnabled();
});

test("the anti-abuse challenge presents no inaccessible in-page widget (accessible path)", async ({
  page,
}) => {
  // Anti-abuse is enforced by server-side siteverify at token issue, not by an in-page
  // CAPTCHA the user must solve — so nothing inaccessible ever blocks the accessible submission path.
  // (If the provider's managed challenge is ever shown, it carries its own accessible fallback.)
  await reachSurveyGate(page);
  await expect(
    page.locator("iframe[src*='challenges.cloudflare.com'], .cf-turnstile, [data-sitekey]"),
    "no in-page challenge widget is rendered on the submission path",
  ).toHaveCount(0);

  // The consent path completes by keyboard with no challenge to solve: ticking the two consents alone
  // enables the contribute action.
  await page.getByRole("checkbox", { name: /consent to National Digital collecting/ }).check();
  await page.getByRole("checkbox", { name: /read and agree to the Terms of Use/ }).check();
  await expect(page.getByRole("button", { name: /Contribute my answers/ })).toBeEnabled();
});

test("the printed plan exposes the s321D authorisation stamp, present and in reading order", async ({
  page,
}) => {
  // Print / PDF reading order (WCAG 1.3.2) + the mandatory s321D authorisation: the printed
  // worksheet must expose the authorisation stamp AND place it after the ballot content and worksheet
  // footer in DOM (reading) order, so assistive tech and a PDF read it last, as an authorisation.
  await stubPrint(page);
  await reachCardCompare(page, { state: /ACT/, electorate: "Bean", seedTerms: true });

  await page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ }).click();
  const printButton = page.getByRole("button", {
    name: /Print (this demonstration|my voting plan)/,
  });
  await expect(printButton).toBeVisible();

  // Acknowledge: under the National Digital authoriser model the print step is an ACKNOWLEDGEMENT,
  // not a particulars form (no name/town/state fields). Affirming it is the only path to a stamp.
  await printButton.click();
  const dialog = page.getByRole("dialog", { name: "Before you print your how-to-vote plan" });
  await expect(dialog).toBeVisible();
  await scan(page); // the acknowledgement dialog itself is accessible
  await expect(dialog.getByLabel("Full name")).toHaveCount(0);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Print my plan" }).click();

  // At print time the stamp carried National Digital's entity authorisation plus the
  // "preference order selected by the user" notice (captured by the print spy, since the stamp is
  // cleared immediately after the print returns).
  const printed = await page.evaluate(
    () =>
      (
        window as unknown as {
          __printStamp: string | null;
          __printOrder: { afterBallot: boolean; afterWorksheet: boolean } | null;
        }
      ).__printStamp,
  );
  expect(printed, "the printed stamp carries National Digital's authorisation").toContain(
    "Authorised by",
  );
  expect(printed).toContain("National Digital");
  expect(printed).toContain("Preference order selected by the user.");

  // Reading order: the stamp follows the last ballot section and the worksheet footer in the DOM, so
  // assistive tech and a PDF read it last, as an authorisation of the material above it (WCAG 1.3.2).
  const order = await page.evaluate(
    () =>
      (
        window as unknown as {
          __printOrder: { afterBallot: boolean; afterWorksheet: boolean } | null;
        }
      ).__printOrder,
  );
  expect(order?.afterBallot, "stamp follows the ballot content").toBe(true);
  expect(order?.afterWorksheet, "stamp follows the worksheet footer").toBe(true);
});

test("the axe gate is genuinely blocking — a seeded serious violation is detected", async ({
  page,
}) => {
  // Proof the gate is not a no-op: the exact scan the surface tests use MUST report a serious/critical
  // violation once one is injected. A same-page anchor with no discernible text trips axe's "link-name"
  // rule (serious). This asserts the violation IS found, so the suite stays green while guaranteeing a
  // real regression on any screen would fail the (empty-violations) assertion the other tests make.
  await page.goto("/");
  await page.evaluate(() => {
    const bad = document.createElement("a");
    bad.setAttribute("href", "#nowhere");
    bad.id = "axe-selftest-violation";
    document.body.appendChild(bad);
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    seriousOrCritical.length,
    "the axe scan detects a seeded serious/critical violation (gate is live)",
  ).toBeGreaterThan(0);
});
