import { defineConfig } from "@playwright/test";

// Store-screenshot capture (not part of the quality e2e suite). Boots the built static site and
// drives the real flow at each store's required device size, writing PNGs into the fastlane packs
// (apps/mobile/fastlane/…) so a release is click-paste. Run:
//   pnpm --filter @how2vote/web exec playwright test --config playwright.screenshots.config.ts
//
// Device viewports are the store-required pixel sizes at deviceScaleFactor 1, so the captured PNG
// dimensions match exactly (Apple rejects off-spec sizes; Play is lenient but we keep it tidy):
//   iphone-6.7  1290×2796   (App Store 6.7" iPhone — required)
//   ipad-12.9   2048×2732   (App Store 12.9" iPad — we ship a universal app)
//   android-phone   1080×1920
//   android-tablet  1600×2560 (Play 10")
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
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "iphone-6.7", use: { viewport: { width: 1290, height: 2796 } } },
    { name: "ipad-12.9", use: { viewport: { width: 2048, height: 2732 } } },
    { name: "android-phone", use: { viewport: { width: 1080, height: 1920 } } },
    { name: "android-tablet", use: { viewport: { width: 1600, height: 2560 } } },
  ],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --host 127.0.0.1 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },
});
