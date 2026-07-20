import { defineConfig, devices } from "@playwright/test";

// Drives the built static site through a real browser: the full keyboard-only quiz flow and an
// offline card open (quality gates).
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 90_000,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    // Instant screen advance (the design's reduced-motion path) keeps the 50-question run fast.
    reducedMotion: "reduce",
  },
  // Two viewports so every spec — the keyboard flow AND the axe scans — is exercised at a desktop
  // width and a narrow mobile width (WCAG 1.4.10 reflow; responsive). The CI e2e job
  // runs `test:e2e` with no `--project`, so it runs BOTH projects across all specs automatically.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --host 127.0.0.1 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
