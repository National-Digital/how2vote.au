import { defineConfig } from "@playwright/test";

// Store-screenshot capture (not part of the quality e2e suite). Boots the built static site and
// drives the real flow at each store's required device size, writing PNGs into the fastlane packs
// (apps/mobile/fastlane/…) so a release is click-paste. Run:
//   pnpm --filter @how2vote/web exec playwright test --config playwright.screenshots.config.ts
//
// Viewports are the device's CSS size with its real deviceScaleFactor, so the captured PNG comes
// out at the store-required PIXEL size (Apple rejects off-spec sizes; Play is lenient but we keep
// it tidy) AND the page lays out the way it does on the device:
//   iphone-6.7      430×932  @3  → 1290×2796  (App Store 6.7" iPhone — required)
//   ipad-12.9      1024×1366 @2  → 2048×2732  (App Store 12.9" iPad — we ship a universal app)
//   android-phone   360×640  @3  → 1080×1920
//   android-tablet  800×1280 @2  → 1600×2560  (Play 10")
//
// Setting the PIXEL size as the CSS viewport instead — which is what this did — lays the app out as
// a 1290px-wide desktop and centres its max-width column in a field of background. The PNG is the
// right shape and the screenshot is of the wrong thing.
export default defineConfig({
  testDir: "e2e/screenshots",
  testMatch: "**/*.screenshots.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    reducedMotion: "reduce",
    // Touch layout, not a narrow desktop: the app's breakpoints and its native shells both key off
    // a phone-shaped viewport, and a desktop-width capture would show chrome no phone renders.
    isMobile: true,
    hasTouch: true,
  },
  projects: [
    {
      name: "iphone-6.7",
      use: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 },
    },
    {
      name: "ipad-12.9",
      use: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: false },
    },
    {
      name: "android-phone",
      use: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 },
    },
    {
      name: "android-tablet",
      use: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, isMobile: false },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --host 127.0.0.1 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },
});
