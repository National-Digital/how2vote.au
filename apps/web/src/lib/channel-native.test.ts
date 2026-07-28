import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * channel.ts, evaluated as a NATIVE build.
 *
 * The rest of the suite runs with PUBLIC_DIST_CHANNEL unset, which is correct — that is the web
 * PWA, the default, and every native accessor is null there. But it means the shells' half of
 * every branch is untested by construction: an assertion that `inAppBrowserFor("market://…")` is
 * null passes on the web channel no matter what the function does, because everything is null on
 * the web.
 *
 * So this file stubs the env module and re-imports channel.ts, which reads the channel once at
 * module scope. `vi.resetModules()` per test keeps that evaluation from leaking between cases.
 */
const CAPACITOR = "Capacitor";

function stubChannel(channel: string): void {
  vi.doMock("$env/dynamic/public", () => ({ env: { PUBLIC_DIST_CHANNEL: channel } }));
}

/** Install a bridge-shaped global carrying a Browser plugin, and record what it is asked to open. */
function installBridge(): { opened: string[] } {
  const opened: string[] = [];
  (globalThis as Record<string, unknown>)[CAPACITOR] = {
    Plugins: {
      Browser: {
        open: (options: { url: string }) => {
          opened.push(options.url);
          return Promise.resolve();
        },
      },
    },
  };
  return { opened };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[CAPACITOR];
  vi.doUnmock("$env/dynamic/public");
});

describe("inAppBrowserFor, on a native channel with the bridge present", () => {
  it("hands over an http(s) url — and it is the SAME plugin the bridge registered", async () => {
    const { opened } = installBridge();
    stubChannel("android");
    const { inAppBrowserFor, isNativeShell } = await import("./channel");

    expect(isNativeShell, "guards the guard: this must be a native evaluation").toBe(true);
    const browser = inAppBrowserFor("https://theyvoteforyou.org.au/");
    expect(browser).not.toBeNull();

    // Not just "returned something truthy" — prove the returned object actually reaches the
    // bridge, so a stub or a wrong lookup name cannot pass this.
    await browser?.open({ url: "https://theyvoteforyou.org.au/" });
    expect(opened).toEqual(["https://theyvoteforyou.org.au/"]);
  });

  it("refuses the store schemes even though the bridge is right there", async () => {
    // On the web channel this assertion is worthless (everything is null); here the plugin IS
    // available, so returning null can only be the scheme gate doing its job.
    // Routing market:// into a browser view is how "Update" becomes a dead tap.
    installBridge();
    stubChannel("android");
    const { inAppBrowserFor } = await import("./channel");

    expect(inAppBrowserFor("market://details?id=au.how2vote.app")).toBeNull();
    expect(inAppBrowserFor("itms-apps://apps.apple.com/app/id123")).toBeNull();
    expect(inAppBrowserFor("mailto:hello@how2vote.au")).toBeNull();
    expect(inAppBrowserFor("/release-manifest.json")).toBeNull();
    expect(inAppBrowserFor("javascript:alert(1)//https://x")).toBeNull();
  });

  it("is null on iOS too — the gate is channel-agnostic", async () => {
    installBridge();
    stubChannel("ios");
    const { inAppBrowserFor, isNativeShell } = await import("./channel");

    expect(isNativeShell).toBe(true);
    expect(inAppBrowserFor("https://how2vote.au/")).not.toBeNull();
    expect(inAppBrowserFor("itms-apps://apps.apple.com/app/id123")).toBeNull();
  });

  it("is null when the shell has no Browser plugin registered", async () => {
    // A packaging fault, not a supported state — but the link must still work, so this must be a
    // null rather than a throw. ExternalLink's fallback is the plain new-tab open.
    (globalThis as Record<string, unknown>)[CAPACITOR] = { Plugins: {} };
    stubChannel("android");
    const { inAppBrowserFor } = await import("./channel");

    expect(inAppBrowserFor("https://theyvoteforyou.org.au/")).toBeNull();
  });

  it("offers each native channel an update remedy that its installer can actually honour", async () => {
    // The stale-data notice's only remedy on a shell is this link, and it is loudest during a
    // campaign — so a channel whose link does not resolve has no remedy at all. F-Droid builds are
    // signed by F-Droid, so Play can neither open nor update them: `market://` is a dead tap on a
    // de-Googled device and a wrong destination everywhere else.
    for (const [channel, expected] of [
      ["android", "market://details?id=au.how2vote.app"],
      ["fdroid", "https://f-droid.org/packages/au.how2vote.app/"],
    ] as const) {
      vi.resetModules();
      stubChannel(channel);
      const { storeListingUrl, isNativeShell } = await import("./channel");
      expect(isNativeShell, channel).toBe(true);
      expect(storeListingUrl(), channel).toBe(expected);
    }
  });

  it("is null on the web channel even with a bridge-shaped global present", async () => {
    // The counterpart of the first case, and the reason the gate is DIST_CHANNEL and not
    // "does window.Capacitor exist": a page that injected such a global must not be able to
    // capture how2vote.au's outbound links.
    installBridge();
    stubChannel("web");
    const { inAppBrowserFor, isNativeShell } = await import("./channel");

    expect(isNativeShell).toBe(false);
    expect(inAppBrowserFor("https://theyvoteforyou.org.au/")).toBeNull();
  });
});
