import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

// Start every test past the age-first gate — the gate itself is proven in age-gate.spec.ts.
test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

/**
 * legal-electoral-output — the blocking electoral-output suite (docs/adr/0010).
 *
 * Printing is ENABLED under the National Digital authoriser model: the two-person compliance review
 * signed off the print-authoriser determination, the control-plane `printing` suspension is lifted
 * (audited RESTORE record) and the product boundary is printMode="nd-authoriser". The printed
 * how-to-vote plan carries NATIONAL DIGITAL's electoral authorisation of the material it publishes;
 * the voter's preference numbers are separately identified as the user's own selection. No user
 * particulars are collected — the print step is an acknowledgement, not an authoriser form.
 *
 * This suite proves the load-bearing legal + privacy invariants of the printable plan:
 *   1. no prohibited field / owner token in any share payload or URL, and none reaches client storage
 *      or the network;
 *   2. a shared (read-only) card cannot print and has no plan builder;
 *   3. the print step is an ACKNOWLEDGEMENT (not a particulars form), and window.print() only fires
 *      after the acknowledgement — the printed stamp is National Digital's entity authorisation plus
 *      "Preference order selected by the user.";
 *   4. the results screen lists no candidates (party voting-record alignment only); the build/print
 *      stage carries the official ballot order and the printed worksheet shows NO party-alignment
 *      percentages;
 *   5. a native (Ctrl+P) print before the acknowledgement produces only the "not authorised" notice,
 *      never an un-acknowledged authorisation stamp.
 */

// Sentinels that must never leak. The National Digital authoriser model collects no user particulars,
// so these guard against any owner-capability / authorisation string escaping into a share payload,
// client storage or the network. (National Digital's own stamp is client-only, printed in the DOM —
// it must never appear in storage, a URL or a request body.)
const FORBIDDEN = ["Authorised by", "owner", "capability"];

const QUESTIONS = 50;

/**
 * Replace window.print with a spy that records the printed authorisation stamp at print time (so a
 * bypass that prints an un-acknowledged stamp is observable) and opens no real dialog.
 */
async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __printCount: number; __printStamps: string[] };
    w.__printCount = 0;
    w.__printStamps = [];
    window.print = () => {
      w.__printCount += 1;
      const el = document.querySelector('[data-testid="print-stamp"]');
      w.__printStamps.push(el ? (el.textContent ?? "") : "");
    };
  });
}

async function printCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __printCount: number }).__printCount);
}

async function printStamps(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __printStamps: string[] }).__printStamps);
}

/**
 * Every client-side store scanned for a leak: localStorage, sessionStorage, cookies and every
 * IndexedDB database's object-store contents, concatenated.
 */
async function allStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const dump = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => {
        const k = s.key(i) ?? "";
        return `${k}=${s.getItem(k) ?? ""}`;
      }).join("\n");
    let idb = "";
    try {
      const dbs = (await indexedDB.databases?.()) ?? [];
      for (const { name } of dbs) {
        if (!name) continue;
        idb += name + "\n";
        await new Promise<void>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const stores = Array.from(db.objectStoreNames);
            if (stores.length === 0) {
              db.close();
              return resolve();
            }
            const tx = db.transaction(stores, "readonly");
            let pending = stores.length;
            const done = () => {
              if (--pending === 0) {
                db.close();
                resolve();
              }
            };
            for (const st of stores) {
              const g = tx.objectStore(st).getAll();
              g.onsuccess = () => {
                idb += JSON.stringify(g.result);
                done();
              };
              g.onerror = () => done();
            }
          };
          req.onerror = () => resolve();
        });
      }
    } catch {
      /* IndexedDB unavailable — nothing to scan */
    }
    return `${dump(localStorage)}\n${dump(sessionStorage)}\n${document.cookie}\n${idb}`;
  });
}

/** Drive the keyboard quiz flow to the card comparison stage for ACT/Bean. */
async function reachCompare(page: Page): Promise<void> {
  await page.goto("/2025");
  await expect(async () => {
    await page.getByRole("button", { name: "See how my views compare" }).click();
    await expect(page).toHaveURL(/\/ballot/);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: /ACT/ }).click();
  await page.getByRole("button", { name: /^Bean/ }).click();
  await page.getByRole("button", { name: /This is my electorate/ }).click();
  await expect(page).toHaveURL(/\/quiz/);

  const label = page.locator("span.label");
  for (let i = 0; i < QUESTIONS; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of ${QUESTIONS}`);
    await page.keyboard.press("3");
  }
  await expect(page).toHaveURL(/\/review/);
  await page.getByRole("button", { name: "See how I compare" }).click();
  await expect(page).toHaveURL(/\/survey/);
  await page
    .getByRole("button", { name: /Skip research and (build my voting plan|see my comparison)/ })
    .click();
  await expect(page).toHaveURL(/\/card#v1\./);
}

/**
 * Names of the House candidates, in DOM (official ballot) order. Only the build stage lists
 * candidates — the results screen shows the party panel only — so this is empty on the results
 * screen and populated once the plan builder is open.
 */
async function houseOrder(page: Page): Promise<string[]> {
  return page.locator("section.ballot .chamber").first().locator(".rows .who b").allTextContents();
}

const buildButton = (page: Page) =>
  page.getByRole("button", { name: /Build (a demonstration plan|my voting plan)/ });
const printButton = (page: Page) =>
  page.getByRole("button", { name: /Print (this demonstration|my voting plan)/ });
// The National Digital authoriser model's ACKNOWLEDGEMENT dialog — not a particulars form.
const ackDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Before you print your how-to-vote plan" });
const confirmButton = (page: Page) =>
  ackDialog(page).getByRole("button", { name: "Print my plan" });

/** From the comparison stage, open the plan builder (through the versioned Terms acceptance gate). */
async function openBuilder(page: Page): Promise<void> {
  await buildButton(page).click();
  const gate = page.getByRole("group", { name: "Terms of Use acceptance" });
  await expect(gate).toBeVisible();
  await gate.getByRole("checkbox").check();
  await gate.getByRole("button", { name: "Accept and continue" }).click();
  await expect(printButton(page)).toBeVisible();
}

/** Acknowledge and print through the working National Digital authoriser flow. */
async function acknowledgeAndPrint(page: Page): Promise<void> {
  await printButton(page).click();
  await expect(ackDialog(page)).toBeVisible();
  await ackDialog(page).getByRole("checkbox").check();
  await expect(confirmButton(page)).toBeEnabled();
  await confirmButton(page).click();
}

test("share payload and URL never carry particulars or an owner token", async ({ page }) => {
  await stubPrint(page);
  await reachCompare(page);

  const url = page.url();
  // The fragment is the whole share payload: version.election.electorate.answers — nothing else.
  const fragment = new URL(url).hash;
  expect(fragment).toMatch(/^#v1\.[^.]+\.[^.]+\.[^.]+$/);
  for (const forbidden of FORBIDDEN) {
    expect(url.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }

  // Building a plan and printing must not change the URL or add any owner token to it — the owner
  // capability lives in memory only.
  await openBuilder(page);
  await acknowledgeAndPrint(page);
  await expect(page).toHaveURL(url);
  for (const forbidden of FORBIDDEN) {
    expect(page.url().toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
});

test("the print step is an acknowledgement (not a particulars form) and stamps National Digital's authorisation", async ({
  page,
}) => {
  await stubPrint(page);
  await reachCompare(page);
  await openBuilder(page);

  // Print opens the acknowledgement gate — it never prints directly.
  await printButton(page).click();
  await expect(ackDialog(page)).toBeVisible();
  expect(await printCount(page)).toBe(0);

  // It is an ACKNOWLEDGEMENT, NOT a form that collects the user's identity — no particulars fields.
  await expect(ackDialog(page).getByLabel("Full name")).toHaveCount(0);
  await expect(ackDialog(page).getByLabel("Town or city")).toHaveCount(0);
  await expect(ackDialog(page).getByLabel("State or territory")).toHaveCount(0);

  // Confirm stays disabled until the declaration is acknowledged, so nothing can print unacknowledged.
  await expect(confirmButton(page)).toBeDisabled();
  // The printed stamp is still empty before acknowledgement.
  await expect(page.getByTestId("print-stamp")).toHaveText("");

  await ackDialog(page).getByRole("checkbox").check();
  await expect(confirmButton(page)).toBeEnabled();
  await confirmButton(page).click();

  // Now — and only now — a print fires, carrying National Digital's entity authorisation plus the
  // "preference order selected by the user" notice. No user name/street ever appears.
  expect(await printCount(page)).toBe(1);
  const stamps = await printStamps(page);
  expect(stamps).toHaveLength(1);
  const stamp = stamps[0]!;
  expect(stamp).toContain("Authorised by");
  expect(stamp).toContain("National Digital");
  expect(stamp).toContain("Preference order selected by the user.");
  // The stamp is National Digital's, not a per-user authoriser: no street-number + street-type form.
  expect(stamp).not.toMatch(/\b\d+\s+\w+\s+(street|st|road|rd|avenue|ave|lane|ln)\b/i);
});

test("the results screen lists no candidates (party panel only); the build/print stage carries the official ballot order and no alignment percentages", async ({
  page,
}) => {
  await stubPrint(page);
  await reachCompare(page);

  // The results screen lists NO candidates — a ballot order shown with no selection reads as a
  // ranking. Alignment lives solely in the party panel, where the figure is shown (e.g. "31%
  // alignment"). So: no candidate rows here, but at least one party figure.
  expect(await houseOrder(page)).toHaveLength(0);
  expect(await page.locator("section.ballot .party-panel .pct").count()).toBeGreaterThan(0);

  await openBuilder(page);
  // The build stage is where the ballot appears — in official order, for the voter to number.
  const built = await houseOrder(page);
  expect(built.length).toBeGreaterThan(0);

  // The plan worksheet is a neutral ballot list + the user's numbers — it carries NO party-alignment
  // percentage (figures live only in the compare-stage party panel, never on the printed plan).
  const worksheetText = (await page.locator(".worksheet").innerText()).replace(/\s+/g, " ");
  expect(worksheetText).not.toMatch(/\d+%/);
  await expect(page.locator(".worksheet").getByText("party alignment")).toHaveCount(0);

  // Under print media the same official order holds — nothing is re-sorted by preference on print.
  await page.emulateMedia({ media: "print" });
  expect(await houseOrder(page)).toEqual(built);
  await page.emulateMedia({ media: null });
});

test("a shared read-only card cannot print and offers no plan builder", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  await reachCompare(page);
  const shareUrl = page.url();

  // A recipient with no history of their own: a fresh context, so there is no owner capability and
  // no quiz state — the card can only be the shared, read-only comparison.
  const recipient = await browser.newContext();
  const shared = await recipient.newPage();
  // The recipient has already passed the age-first gate (proven separately in age-gate.spec.ts); seed
  // it so this test stays focused on the shared-readonly / no-print invariants.
  await seedEligibility(shared);
  await stubPrint(shared);
  await shared.goto(shareUrl);

  await expect(shared.getByText("This is a shared comparison")).toBeVisible();
  await expect(buildButton(shared)).toHaveCount(0);
  await expect(printButton(shared)).toHaveCount(0);
  await expect(ackDialog(shared)).toHaveCount(0);
  expect(await printCount(shared)).toBe(0);

  await recipient.close();
});

test("a native print before the acknowledgement produces only the not-authorised notice", async ({
  page,
}) => {
  await stubPrint(page);
  await reachCompare(page);
  await openBuilder(page);
  // Deliberately do NOT open/acknowledge the in-app gate — simulate a native (Ctrl+P) print.

  // The printed stamp is empty (un-acknowledged) and, in print, the "not authorised" notice shows
  // while the worksheet itself is print-locked (never reaches paper unauthorised).
  await expect(page.getByTestId("print-stamp")).toHaveText("");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-unauthorised")).toBeVisible();
  await expect(page.locator(".worksheet.print-locked")).toBeHidden();
  await expect(page.getByTestId("print-stamp")).toHaveText("");

  // A native print at this moment must not produce an authorisation stamp.
  await page.evaluate(() => window.print());
  expect(await printStamps(page)).toEqual([""]);
  await page.emulateMedia({ media: null });
});

test("a screenshot of the plan carries the authorisation and the historical marker", async ({
  page,
}) => {
  // The print path is gated so paper is always authorised, which leaves SCREEN CAPTURE as the one
  // uncontrolled channel — and capture cannot be intercepted on the web (FLAG_SECURE is
  // deliberately not used on Android). The only lever that works on all three
  // distribution channels is what the captured pixels say, so this asserts the authorisation is
  // actually in them: present, opaque, and the topmost thing at the bottom edge no matter how far
  // into the ballot the voter has scrolled.

  // Single-source the expected wording from the site footer, which renders the same AUTHORISATION
  // constant. Asserting equality here means the band and the footer cannot drift apart — a literal
  // copied into this file would go stale the moment the operator record changed.
  await page.goto("/about");
  const expected = ((await page.locator("footer .auth").innerText()) ?? "").trim();
  expect(expected).toMatch(/^Authorised by .+\.$/);

  await reachCompare(page);
  await openBuilder(page);
  // A real edge-to-edge device inset: the band carries it in its own padding, so this is also what
  // catches a height published from a content-box measurement (which misses padding changes).
  await page.addStyleTag({
    content: ":root{--safe-area-inset-top:47px;--safe-area-inset-bottom:34px}",
  });

  const band = page.locator(".band");
  await expect(band).toBeVisible();
  // Every shipped election is archived today, so the historical marker is the case under test; the
  // live-election branch simply omits this line.
  await expect(band).toContainText(/historical example — not valid for voting/i);
  await expect(band).toContainText(expected);
  await expect(band).toContainText("Preference order selected by the user.");

  const seen = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".band");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const w = window.innerWidth;
    return {
      // Published height must equal the real one, or the reservations below it under-reserve by
      // exactly the amount that is covering content.
      token: getComputedStyle(document.documentElement).getPropertyValue("--plan-auth-h").trim(),
      height: `${Math.round(rect.height)}px`,
      // Flush to the bottom edge of the viewport — the part of the frame a capture always includes.
      gapBelow: Math.round(window.innerHeight - rect.bottom),
      // Opaque: a translucent band would let the ballot show through and become unreadable in a
      // capture, which is the same as not being there.
      background: cs.backgroundColor,
      opacity: cs.opacity,
      // Hit-testing, not just z-index: this is what proves nothing is painted over it.
      hits: [4, w / 2, w - 4].map((x) =>
        document.elementFromPoint(x, window.innerHeight - 3)?.closest(".band") ? "band" : "other",
      ),
    };
  });
  expect(seen).not.toBeNull();
  expect(seen!.token).toBe(seen!.height);
  expect(seen!.gapBelow).toBe(0);
  expect(seen!.background).toMatch(/^rgb\(/); // never `transparent` / `rgba(...,0)`
  expect(seen!.opacity).toBe("1");
  expect(seen!.hits).toEqual(["band", "band", "band"]);

  // Deep into the Senate rows — the capture most likely to be taken, and the one the scrolling
  // worksheet footer is useless for.
  await page.mouse.wheel(0, 2500);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 3);
        return { onTop: !!hit?.closest(".band"), scrolled: window.scrollY > 400 };
      }),
    )
    .toEqual({ onTop: true, scrolled: true });

  // Print is unaffected: it has its own stamp and its own watermark, rendered once at the end of
  // the document and gated on the acknowledgement. A viewport-fixed band would repeat on every
  // printed page and collide with both.
  await page.emulateMedia({ media: "print" });
  await expect(band).toBeHidden();
  await page.emulateMedia({ media: null });
});

test("cancelling the acknowledgement does not print, and Escape closes it and restores focus", async ({
  page,
}) => {
  await stubPrint(page);
  await reachCompare(page);
  await openBuilder(page);

  // Cancel: no print, and the printed stamp stays empty.
  await printButton(page).click();
  await ackDialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(ackDialog(page)).toHaveCount(0);
  expect(await printCount(page)).toBe(0);
  await expect(page.getByTestId("print-stamp")).toHaveText("");

  // Escape: closes the dialog, no print, and focus returns to the trigger (a11y focus restore).
  await printButton(page).click();
  await expect(ackDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ackDialog(page)).toHaveCount(0);
  expect(await printCount(page)).toBe(0);
  await expect(printButton(page)).toBeFocused();
});

test("no owner capability or authorisation string reaches storage or the network", async ({
  page,
}) => {
  const requestUrls: string[] = [];
  const requestBodies: string[] = [];
  page.on("request", (r) => {
    requestUrls.push(r.url());
    requestBodies.push(r.postData() ?? "");
  });

  await stubPrint(page);
  await reachCompare(page);
  await openBuilder(page);
  await acknowledgeAndPrint(page);
  expect(await printCount(page)).toBe(1);

  // Nothing sensitive persisted — including IndexedDB and cookies.
  const storage = await allStorage(page);
  for (const forbidden of FORBIDDEN) {
    expect(storage).not.toContain(forbidden);
  }
  // …and nothing sensitive left the browser, in any request URL or body. National Digital's own
  // authorisation stamp is client-only (printed in the DOM) and must never appear here.
  const urls = requestUrls.join("\n");
  const bodies = requestBodies.join("\n");
  for (const forbidden of FORBIDDEN) {
    expect(urls).not.toContain(forbidden);
    expect(urls).not.toContain(encodeURIComponent(forbidden));
    expect(bodies).not.toContain(forbidden);
  }
});
