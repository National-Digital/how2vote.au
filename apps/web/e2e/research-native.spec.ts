import { expect, test, type Page, type Request } from "@playwright/test";
import { seedEligibility, stubChallenge } from "./flow-helpers";

// Read the channel from the environment directly — importing channel.ts would pull in SvelteKit's
// `$env` alias, which is not resolvable in Playwright's plain Node context. The canonical origin is
// the same constant seo.ts uses; kept inline here for the same reason.
const raw = process.env["PUBLIC_DIST_CHANNEL"];
const CHANNEL = raw === "ios" || raw === "android" ? raw : "web";
const SITE_URL = "https://how2vote.au";

// Cross-platform contribution-upload test. The build under test is produced with
// PUBLIC_DIST_CHANNEL set by the CI matrix (web / ios / android); this asserts the SAME opt-in
// flow uploads on every channel, and that the request targets the correct origin:
//   - web PWA: same-origin (relative path resolves to the preview origin);
//   - native shells: the canonical https://how2vote.au origin (the WebView origin is local), which
//     the endpoints accept by the strict CORS allowlist.
// In all cases no cookie/credential rides along. functions/api/** aren't served by `vite preview`,
// so we intercept the POSTs, assert their shape, and fulfil 204 (fire-and-forget on the client).

const NATIVE = CHANNEL !== "web";

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
  await stubChallenge(page);
});

function captureAndFulfil(page: Page): {
  research: Request[];
  geography: Request[];
  token: Request[];
} {
  const research: Request[] = [];
  const geography: Request[] = [];
  const token: Request[] = [];
  // Match both relative (web) and absolute (native) forms.
  void page.route("**/api/research/token", async (route) => {
    token.push(route.request());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tokens: { research: "t-r", geography: "t-g" }, expiresAt: 9e9 }),
    });
  });
  void page.route("**/api/research/geography", async (route) => {
    geography.push(route.request());
    await route.fulfill({ status: 204, body: "" });
  });
  void page.route("**/api/research", async (route) => {
    research.push(route.request());
    await route.fulfill({ status: 204, body: "" });
  });
  return { research, geography, token };
}

async function reachSurveyAndContribute(page: Page): Promise<void> {
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
  for (let i = 0; i < 50; i++) {
    await expect(label).toHaveText(`Question ${i + 1} of 50`);
    await page.keyboard.press(i % 2 === 0 ? "5" : "1");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  // The survey opt-in must be reachable on EVERY channel, native included.
  await expect(page).toHaveURL(/\/survey/);
  const boxes = page.getByRole("checkbox");
  const count = await boxes.count();
  for (let i = 0; i < count; i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: "Contribute my answers and continue" }).click();
  for (let i = 0; i < 30 && !/\/card/.test(page.url()); i++) {
    try {
      await page.getByRole("button", { name: "Prefer not to say" }).click({ timeout: 2000 });
    } catch {
      break;
    }
  }
  await expect(page).toHaveURL(/\/card/, { timeout: 10_000 });
}

test(`[channel=${CHANNEL}] a contribution uploads to the correct origin with no credentials`, async ({
  page,
  baseURL,
}) => {
  // On web the upload is same-origin, so the expected origin is wherever the preview is listening.
  // That port is derived per checkout (playwright.config.ts), so read it from the resolved config
  // rather than pinning a literal.
  expect(baseURL, "baseURL must be set by playwright.config.ts").toBeTruthy();
  const EXPECTED_ORIGIN = NATIVE ? SITE_URL : String(baseURL);

  const posts = captureAndFulfil(page);
  await reachSurveyAndContribute(page);

  await expect.poll(() => posts.research.length, { timeout: 8000 }).toBe(1);
  const req = posts.research[0]!;

  // Correct per-channel origin.
  expect(req.url().startsWith(`${EXPECTED_ORIGIN}/api/research`)).toBe(true);
  expect(req.method()).toBe("POST");

  // No cookie/credential ever rides along (credentials: "omit").
  expect(req.headers()["cookie"]).toBeUndefined();

  // The device-derived record only — never the raw answer vector.
  const body = JSON.parse(req.postData() ?? "{}");
  expect(body).not.toHaveProperty("answers");
  expect(body).not.toHaveProperty("electorate");
  expect(Array.isArray(body.propositions)).toBe(true);

  // The token request and the separate geography ping also target the expected origin.
  expect(posts.token.every((r) => r.url().startsWith(EXPECTED_ORIGIN))).toBe(true);
  expect(posts.geography.every((r) => r.url().startsWith(EXPECTED_ORIGIN))).toBe(true);
});
