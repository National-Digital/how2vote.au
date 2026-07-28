import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { seedEligibility } from "./flow-helpers";

/**
 * The in-app browser, exercised on the channel-matrix build (mobile-ci runs this spec with
 * PUBLIC_DIST_CHANNEL set to web / ios / android).
 *
 * What this can and cannot prove, stated plainly. The plugin itself is native code that only
 * exists inside a Capacitor shell, so no browser-based suite can run it — SFSafariViewController
 * appearing and its Done button returning the reader is manual device QA, and stays that way.
 * What IS testable, and is everything on our side of the bridge, is the contract we hold up:
 * whether we call the plugin at all, with what URL, whether the click still navigates, and what
 * a screen reader is told beforehand. So a plugin double is installed on `window.Capacitor` the
 * way the real bridge installs one, and we assert against the calls it records.
 *
 * The double is deliberately NOT a stand-in for the native behaviour — it resolves and does
 * nothing, because "the page opened" is not the claim. "We handed the right URL to the right
 * place and did not also navigate" is.
 *
 * Read the channel from the environment rather than importing channel.ts: the import would pull
 * in SvelteKit's `$env` alias, which does not resolve in Playwright's plain Node context. Same
 * reason, same shape as research-native.spec.ts.
 */
const raw = process.env["PUBLIC_DIST_CHANNEL"];
const CHANNEL = raw === "ios" || raw === "android" ? raw : "web";
const NATIVE = CHANNEL !== "web";

/** The cue the accessible name must carry, per channel. Asserted, not assumed. */
const CUE = NATIVE ? "opens in an in-app browser" : "opens in a new tab";

type BrowserCall = { url: string };

/**
 * Install a Capacitor-shaped global carrying a Browser plugin double, before any app code runs.
 * This mirrors what the native bridge does: `window.Capacitor.Plugins` exists by the time the
 * bundle evaluates, which is why channel.ts can read it lazily at click time.
 */
async function installBrowserDouble(page: Page, reject = false): Promise<void> {
  await page.addInitScript((shouldReject: boolean) => {
    const calls: BrowserCall[] = [];
    (window as unknown as { __browserCalls: BrowserCall[] }).__browserCalls = calls;
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: {
        Browser: {
          open: (options: { url: string }) => {
            calls.push({ url: options.url });
            return shouldReject ? Promise.reject(new Error("no browser")) : Promise.resolve();
          },
        },
      },
    };
  }, reject);
}

function browserCalls(page: Page): Promise<BrowserCall[]> {
  return page.evaluate(
    () => (window as unknown as { __browserCalls?: BrowserCall[] }).__browserCalls ?? [],
  );
}

/**
 * No test in this file may reach the real theyvoteforyou.org.au, and the second reason matters more
 * than the first: a CI job should not send traffic to a third party's site on every run, and that
 * site sits behind Cloudflare, which appends a `__cf_chl_rt_tk` challenge token to the URL — so an
 * assertion on the landed URL is unreliable. Stub the host and the URL stays the URL.
 */
const OUTBOUND = /^https:\/\/theyvoteforyou\.org\.au\//;

/** Fulfils every outbound request locally and records what was asked for. */
async function stubOutbound(context: BrowserContext): Promise<string[]> {
  const requested: string[] = [];
  await context.route(OUTBOUND, async (route) => {
    requested.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" });
  });
  return requested;
}

/** Outbound URLs actually requested by the current test, in order. */
let outbound: string[] = [];

test.beforeEach(async ({ page, context }) => {
  outbound = await stubOutbound(context);
  await installBrowserDouble(page);
  await seedEligibility(page);
});

test(`an outbound link announces that it ${CUE}`, async ({ page }) => {
  await page.goto("/methodology");

  // getByRole matches the COMPUTED ACCESSIBLE NAME, so this is what a screen reader announces.
  // Scoped to #main because the footer credits the same source and carries the same cue.
  const tvfy = page.locator("#main").getByRole("link", { name: `They Vote For You (${CUE})` });
  await expect(tvfy).toBeVisible();

  // The cue changes with the channel; the link does not stop being a real link. Both shells keep
  // target/rel intact so the no-plugin fallback path is a plain, safe new-tab open.
  await expect(tvfy).toHaveAttribute("target", "_blank");
  await expect(tvfy).toHaveAttribute("rel", /noopener/);
});

test("an https link is opened over the app, and does not navigate away", async ({ page }) => {
  await page.goto("/methodology");
  const before = page.url();
  const tvfy = page.locator("#main").getByRole("link", { name: `They Vote For You (${CUE})` });
  const href = await tvfy.getAttribute("href");
  expect(href).toMatch(/^https:\/\/theyvoteforyou\.org\.au/);

  // A new tab is the failure mode on the native channels: it means the click was NOT intercepted
  // and the WebView is about to hand the URL to the system browser. Watch for it rather than
  // inferring from the absence of a call — an unhandled tab would otherwise pass silently.
  const opened: Page[] = [];
  page.context().on("page", (p) => opened.push(p));

  await tvfy.click();
  await expect
    .poll(async () => (await browserCalls(page)).length, {
      message: NATIVE
        ? "the shell must hand the URL to the in-app browser"
        : "the web channel must never call a native plugin",
    })
    .toBe(NATIVE ? 1 : 0);

  if (NATIVE) {
    expect((await browserCalls(page))[0]?.url).toBe(href);
    // Intercepted means the page under the sheet is untouched: same URL, still interactive.
    expect(page.url()).toBe(before);
    await expect(tvfy).toBeVisible();

    // Asserting a NON-event needs a bounded wait: a tab opened by the anchor's default action is
    // reported within a few ms, so the wait only has to outlast that — an unbounded instant check
    // would pass before the default action's tab had been reported.
    await page.waitForTimeout(750);
    expect(
      opened.map((p) => p.url()),
      "an intercepted click must not ALSO fall through to the anchor's default action",
    ).toEqual([]);
    // The same claim at the network layer, which is the one that cannot be argued with: if the
    // default action had survived, a tab would have opened and requested this URL.
    expect(outbound, "an intercepted click must not put the URL on the wire").toEqual([]);
  } else {
    // The web channel keeps the plain behaviour even with a Capacitor global present — the guard
    // is DIST_CHANNEL, not the presence of a bridge.
    await expect.poll(() => opened.length).toBe(1);
  }

  for (const p of opened) await p.close();
});

test("a modified click still asks the platform for a new tab", async ({ page }) => {
  await page.goto("/methodology");
  const tvfy = page.locator("#main").getByRole("link", { name: `They Vote For You (${CUE})` });
  const href = await tvfy.getAttribute("href");

  // Ctrl/⌘-click is an explicit request for a separate context. Swallowing it into a sheet would
  // take away the one gesture that means "keep this page AND open that one" — and on the shells
  // an external keyboard or a trackpad makes that gesture reachable.
  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    tvfy.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  expect(await browserCalls(page), "a modified click must bypass the plugin").toHaveLength(0);
  await expect
    .poll(() => outbound, { message: "the platform should have been asked for the page itself" })
    .toEqual([href]);
  await tab.close();
});

test.describe("when the in-app browser refuses to open", () => {
  test.skip(!NATIVE, "there is no plugin to refuse on the web channel");

  test.beforeEach(async ({ page }) => {
    // A fresh context per test, so re-installing the double is the only init script that runs.
    await page.goto("about:blank");
  });

  test("the link falls back to a tab instead of doing nothing", async ({ page, context }) => {
    // We have already called preventDefault by the time the plugin rejects, so without the catch
    // the reader taps a link and NOTHING happens — the worst of the three outcomes, and invisible
    // in logs.
    const fresh = await context.newPage();
    await installBrowserDouble(fresh, true);
    await seedEligibility(fresh);
    await fresh.goto("/methodology");

    const tvfy = fresh.locator("#main").getByRole("link", { name: `They Vote For You (${CUE})` });
    const href = await tvfy.getAttribute("href");

    const [tab] = await Promise.all([context.waitForEvent("page"), tvfy.click()]);
    expect(await browserCalls(fresh), "the plugin must still have been tried first").toHaveLength(
      1,
    );
    // Assert on what was REQUESTED, not on where the tab settled. A landed URL is the browser's
    // business — redirects, challenge tokens, canonicalisation — and none of that is this code's
    // contract. What we owe the reader is a request for the href they clicked.
    await expect.poll(() => outbound).toEqual([href]);
    await tab.close();
    await fresh.close();
    await page.close();
  });
});
