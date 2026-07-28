import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Drives the built static site through a real browser: the full keyboard-only quiz flow and an
// offline card open (quality gates).

/** Path-derived byte: stable within a checkout, different between checkouts. */
const pathByte =
  createHash("sha256")
    .update(import.meta.dirname)
    .digest()[0] ?? 0;

/**
 * A preview port private to this checkout, so concurrent worktrees do not contend for one. `PORT`
 * overrides it.
 */
const port = Number(process.env["PORT"] ?? 4173 + (pathByte % 400));

// Adopt an existing server only when explicitly asked (E2E_REUSE=1), which is for iterating on a spec.
// Reuse skips the rebuild and runs against whatever holds the port, so a result from it does not
// establish that the code under test passes; leave it unset to verify a change.
const reuseExistingServer = process.env["E2E_REUSE"] === "1" && !process.env["CI"];

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 90_000,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    command: `pnpm build && pnpm preview --port ${port} --host 127.0.0.1 --strictPort`,
    port,
    reuseExistingServer,
    timeout: 120_000,
  },
});
