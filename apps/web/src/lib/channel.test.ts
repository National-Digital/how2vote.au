import { describe, expect, it } from "vitest";
import {
  canOpenInAppBrowser,
  DIST_CHANNEL,
  isNativeShell,
  nativeBrowserPlugin,
  nativeSharePlugin,
  parseDistChannel,
} from "./channel";
import { shareUrl, SITE_URL } from "./seo";

describe("parseDistChannel", () => {
  it("accepts the three native channels", () => {
    expect(parseDistChannel("ios")).toBe("ios");
    expect(parseDistChannel("android")).toBe("android");
    // F-Droid is distinct from android on purpose: its builds are signed by F-Droid, so Play can
    // never update them and a `market://` remedy is dead. Folding it into android hides that.
    expect(parseDistChannel("fdroid")).toBe("fdroid");
  });

  it("fails closed to web for unset or unexpected values", () => {
    expect(parseDistChannel(undefined)).toBe("web");
    expect(parseDistChannel("")).toBe("web");
    expect(parseDistChannel("web")).toBe("web");
    expect(parseDistChannel("IOS")).toBe("web");
    expect(parseDistChannel("macos")).toBe("web");
  });
});

describe("build-time channel (unset env in unit tests)", () => {
  it("defaults to the web PWA", () => {
    expect(DIST_CHANNEL).toBe("web");
    expect(isNativeShell).toBe(false);
  });

  it("never exposes a native share plugin on the web channel", () => {
    // Even with a Capacitor-shaped global present, the web channel must not use it.
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { Share: { share: async () => undefined } },
    };
    try {
      expect(nativeSharePlugin()).toBeNull();
    } finally {
      delete (globalThis as { Capacitor?: unknown }).Capacitor;
    }
  });

  it("never exposes an in-app browser on the web channel", () => {
    // On the web a new tab is the right answer and the plugin must not be reachable even if a
    // Capacitor-shaped global somehow exists — ExternalLink's interception hangs off this being
    // null, so a leak here would swallow every outbound click on how2vote.au.
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { Browser: { open: async () => undefined } },
    };
    try {
      expect(nativeBrowserPlugin()).toBeNull();
    } finally {
      delete (globalThis as { Capacitor?: unknown }).Capacitor;
    }
  });
});

describe("canOpenInAppBrowser", () => {
  it("accepts http(s), whatever the case", () => {
    expect(canOpenInAppBrowser("https://theyvoteforyou.org.au/")).toBe(true);
    expect(canOpenInAppBrowser("http://example.org/page")).toBe(true);
    expect(canOpenInAppBrowser("HTTPS://Example.org/Page")).toBe(true);
  });

  it("refuses the store schemes — those are OS handoffs, not pages", () => {
    // Routing either of these into a browser view turns a working handoff into a dead tap. They
    // are off-origin (so they still earn the cue) but they are not openable.
    expect(canOpenInAppBrowser("market://details?id=au.how2vote.app")).toBe(false);
    expect(canOpenInAppBrowser("itms-apps://apps.apple.com/app/id123")).toBe(false);
  });

  it("refuses everything else the platform should resolve itself", () => {
    expect(canOpenInAppBrowser("mailto:hello@how2vote.au")).toBe(false);
    expect(canOpenInAppBrowser("tel:+61000000000")).toBe(false);
    expect(canOpenInAppBrowser("/release-manifest.json")).toBe(false);
    expect(canOpenInAppBrowser("#section")).toBe(false);
    expect(canOpenInAppBrowser("")).toBe(false);
  });

  it("is anchored at the start, so a scheme cannot be smuggled in", () => {
    expect(canOpenInAppBrowser("javascript:void(0)")).toBe(false);
    expect(canOpenInAppBrowser("javascript:alert(1)//https://x")).toBe(false);
    expect(canOpenInAppBrowser(" https://example.org")).toBe(false);
  });
});

describe("shareUrl", () => {
  it("composes the canonical origin with path and fragment", () => {
    expect(shareUrl("/card", "#abc123")).toBe(`${SITE_URL}/card#abc123`);
  });

  it("is independent of the running origin (no window.location involved)", () => {
    // A shell origin like capacitor://localhost must never leak into a shared link; the
    // function is pure and only ever emits SITE_URL.
    expect(shareUrl("card", "")).toBe(`${SITE_URL}/card`);
    expect(shareUrl("/card", "")).toMatch(/^https:\/\/how2vote\.au\//);
  });
});
