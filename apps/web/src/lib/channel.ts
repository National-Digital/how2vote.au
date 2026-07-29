/**
 * Distribution-channel awareness.
 *
 * The same static build serves three channels: the web PWA (Cloudflare Pages) and the two
 * store-distributed native shells (Capacitor on iOS and Android). The channel is baked in at
 * build time via PUBLIC_DIST_CHANNEL — read through `$env/dynamic/public` like the other
 * PUBLIC_ vars (captured and inlined by the static adapter; unset resolves to the web default,
 * so a plain `pnpm build` is always the web PWA).
 *
 * Native shells serve the bundle from a local WebView origin (capacitor://localhost on iOS,
 * https://localhost on Android), which breaks two web assumptions:
 *   - same-origin `/api/*` endpoints do not exist there, so the optional research contribution
 *     targets the canonical origin instead (survey.ts → researchEndpointUrl), accepted by the
 *     endpoints' strict CORS allowlist (research/cors.ts) — same opt-in, same aggregate-only data;
 *   - `window.location` is not the canonical origin, so anything user-facing (share links) must
 *     be composed from SITE_URL instead (see seo.ts shareUrl).
 *
 * Nothing outside this module reads PUBLIC_DIST_CHANNEL, and nothing should branch on a
 * specific native platform — gate behaviour on `isNativeShell` so a future channel inherits the
 * correct behaviour by default.
 */
import { env } from "$env/dynamic/public";

export type DistChannel = "web" | "ios" | "android" | "fdroid";

/** Parses the raw env value, failing closed to the web channel on anything unexpected. */
export function parseDistChannel(raw: string | undefined): DistChannel {
  return raw === "ios" || raw === "android" || raw === "fdroid" ? raw : "web";
}

/** The channel this build was produced for. */
export const DIST_CHANNEL: DistChannel = parseDistChannel(env.PUBLIC_DIST_CHANNEL);

/** True in the Capacitor shells; false for the web PWA. */
export const isNativeShell: boolean = DIST_CHANNEL !== "web";

/** The native application id — the Android Play package, and the iOS bundle id. */
export const APP_ID = "au.how2vote.app";

/**
 * Apple's numeric App Store id (e.g. "1234567890"), baked in at build time via PUBLIC_APPLE_APP_ID.
 * Account-gated (assigned when the app record is created), so it is empty until that GitHub var is
 * set — callers that build an iOS store link must treat "" as "no link available yet".
 */
export const APPLE_APP_ID: string = env.PUBLIC_APPLE_APP_ID ?? "";

/** A user-initiated deep link to this app's store listing for the running channel, or null if none
 *  can be built (web, or iOS before the numeric App ID is configured). No network — an OS handoff. */
export function storeListingUrl(): string | null {
  if (DIST_CHANNEL === "android") return `market://details?id=${APP_ID}`;
  if (DIST_CHANNEL === "ios")
    return APPLE_APP_ID ? `itms-apps://apps.apple.com/app/id${APPLE_APP_ID}` : null;
  // `market://` is wrong for F-Droid twice over: a de-Googled device has nothing to resolve it,
  // and Play cannot update an F-Droid install anyway (different signing keys). The https listing
  // URL works everywhere: the F-Droid client claims it where installed, the browser otherwise.
  if (DIST_CHANNEL === "fdroid") return `https://f-droid.org/packages/${APP_ID}/`;
  return null;
}

/**
 * Duck-typed accessor for a registered Capacitor plugin. The web bundle deliberately does not
 * depend on any Capacitor package — when running inside the shell, the native bridge injects
 * `window.Capacitor.Plugins`, and we read the one plugin we need by name. On the web (and if the
 * plugin isn't registered) this returns null and callers fall back to the web behaviour, so the
 * app is always safe if a native plugin is missing.
 */
function nativePlugin<T>(name: string): T | null {
  if (!isNativeShell || typeof globalThis === "undefined") return null;
  const plugins = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    ?.Plugins;
  const plugin = plugins?.[name];
  return plugin ? (plugin as T) : null;
}

/** Minimal surface of the Capacitor Share plugin (native share sheet). */
type NativeSharePlugin = {
  share(options: { title?: string; url?: string }): Promise<unknown>;
};

export function nativeSharePlugin(): NativeSharePlugin | null {
  const share = nativePlugin<NativeSharePlugin>("Share");
  return typeof share?.share === "function" ? share : null;
}

/**
 * Minimal surface of the Capacitor Preferences plugin — durable native key/value storage that (unlike
 * WebView localStorage) is NOT subject to WebKit's 7-day eviction. Used only to back up / restore the
 * on-device `how2vote:*` state in the shells (see native-storage.ts). Null on web.
 */
type NativePreferencesPlugin = {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
  keys(): Promise<{ keys: string[] }>;
};

export function nativePreferencesPlugin(): NativePreferencesPlugin | null {
  const prefs = nativePlugin<NativePreferencesPlugin>("Preferences");
  return prefs && typeof prefs.get === "function" ? prefs : null;
}

/**
 * Minimal surface of Capacitor's built-in SystemBars plugin (registered by the bridge on both
 * platforms, no extra package). The shells draw edge-to-edge, so the status/gesture bar glyphs sit
 * directly over app content — their light/dark style must follow the app's EFFECTIVE theme, which
 * the in-app toggle can set independently of the OS theme (see theme.svelte.ts). Style semantics
 * are background-relative: "DARK" = dark background behind the bar → light glyphs; "DEFAULT"
 * re-follows the OS theme. Null on web, where the browser owns its chrome.
 */
type NativeSystemBarsPlugin = {
  setStyle(options: { style: "LIGHT" | "DARK" | "DEFAULT" }): Promise<unknown>;
};

export function nativeSystemBarsPlugin(): NativeSystemBarsPlugin | null {
  const bars = nativePlugin<NativeSystemBarsPlugin>("SystemBars");
  return typeof bars?.setStyle === "function" ? bars : null;
}

/**
 * Minimal surface of the Capacitor Browser plugin — an in-app browser view
 * (SFSafariViewController on iOS, Chrome Custom Tabs on Android) for links that leave the site.
 *
 * Without it, an off-origin new-tab link in a shell goes to the SYSTEM browser: the reader leaves
 * the app, and returning is an app-switch or a cold relaunch that can cost a part-built plan. The
 * in-app view shows the real URL in real browser chrome and returns the reader where they were.
 * Null on web, where a tab is already the right answer — see ExternalLink.svelte.
 */
type NativeBrowserPlugin = {
  open(options: { url: string }): Promise<void>;
};

export function nativeBrowserPlugin(): NativeBrowserPlugin | null {
  const browser = nativePlugin<NativeBrowserPlugin>("Browser");
  return typeof browser?.open === "function" ? browser : null;
}

/**
 * Whether a URL may be handed to the in-app browser. ONLY http(s) may.
 *
 * The narrowness is the point. Callers distinguish "off-origin" (anything with a scheme) from
 * "openable in a browser view", and those are not the same set: `market://details?id=…` and
 * `itms-apps://…` are OS handoffs to the store app, and routing one into an in-app browser turns
 * a working handoff into a dead tap. Anything that is not plainly http(s) — a store scheme, a
 * `mailto:`, a relative path, a `javascript:` URL — is left to the platform to resolve.
 */
export function canOpenInAppBrowser(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * The in-app browser to use for THIS url, or null to leave the link alone.
 *
 * Combines the scheme gate and the plugin lookup so callers get one nullable value and one branch,
 * and so the scheme gate sits behind a function the URL matrix tests directly.
 */
export function inAppBrowserFor(href: string): NativeBrowserPlugin | null {
  return canOpenInAppBrowser(href) ? nativeBrowserPlugin() : null;
}

/**
 * Minimal surface of the Capacitor App plugin — used only for the `appUrlOpen` deep-link event in the
 * shells (see routes/+layout.svelte). Null on web (the browser opens URLs directly).
 */
type NativeAppPlugin = {
  addListener(
    event: "appUrlOpen",
    handler: (data: { url: string }) => void,
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
};

export function nativeAppPlugin(): NativeAppPlugin | null {
  const app = nativePlugin<NativeAppPlugin>("App");
  return app && typeof app.addListener === "function" ? app : null;
}
