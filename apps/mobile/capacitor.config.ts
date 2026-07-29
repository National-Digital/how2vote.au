import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The shells bundle the ALREADY-BUILT web app (adapter-static output) — webDir points at the
 * sibling package's build directory, so `pnpm --filter @how2vote/web build` (with
 * PUBLIC_DIST_CHANNEL=ios|android) must run before `cap sync`. Everything the app needs ships
 * inside the binary: dataset, maps, stats, fonts. There is no remote `server.url` and must never
 * be one — App Store guideline 2.5.2 forbids swapping the bundle's behaviour post-review, and
 * the product's offline guarantee depends on local assets.
 *
 * Default WebView origins are kept (capacitor://localhost on iOS, https://localhost on Android):
 * the web app is channel-aware (apps/web/src/lib/channel.ts) and never derives user-facing URLs
 * from its running origin.
 */
const config: CapacitorConfig = {
  appId: "au.how2vote.app",
  appName: "How2Vote",
  webDir: "../web/build",
};

export default config;
