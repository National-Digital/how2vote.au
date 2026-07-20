import { expect, test, type Page, type Request } from "@playwright/test";
import { seedEligibility, stubTurnstile } from "./flow-helpers";
import { TRANSMITTABLE_FIELDS } from "../src/lib/research/transport-policy";

// In-transit transport policy: a real opt-in flow must put ONLY the allowlisted fields on
// the wire — the device-derived stances travel, but the raw answer vector/weights, the electorate and
// any identifier never do — and the client attaches no cookie/credential. functions/api/** are
// Cloudflare Pages Functions (not served by `vite preview`), so we inspect the outbound requests
// directly via the browser network capture; the request fires fire-and-forget regardless of backend.

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
  await stubTurnstile(page);
});

async function reachSurvey(page: Page): Promise<void> {
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
    // Alternate agree(5)/disagree(1) so a real derived stance mix travels, never raw answers.
    await page.keyboard.press(i % 2 === 0 ? "5" : "1");
  }
  await page.getByRole("button", { name: "See how I compare" }).click();
  await expect(page).toHaveURL(/\/survey/);
}

function trackResearch(page: Page): { research: Request[]; geography: Request[] } {
  const research: Request[] = [];
  const geography: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const url = r.url();
    if (url.includes("/api/research/geography")) geography.push(r);
    else if (url.includes("/api/research/token")) return;
    else if (url.includes("/api/research")) research.push(r);
  });
  return { research, geography };
}

async function consentAndFinish(page: Page): Promise<void> {
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

test("the detailed record carries only allowlisted fields over the wire", async ({ page }) => {
  const posts = trackResearch(page);
  await reachSurvey(page);
  await consentAndFinish(page);

  await expect.poll(() => posts.research.length, { timeout: 8000 }).toBe(1);
  const req = posts.research[0]!;
  const record = JSON.parse(req.postData() ?? "{}");

  // Every transmitted key must be on the endpoint allowlist — nothing else may reach the wire.
  const allowed = new Set<string>(TRANSMITTABLE_FIELDS.research);
  for (const key of Object.keys(record)) {
    expect(allowed.has(key), `field "${key}" is not on the research transport allowlist`).toBe(
      true,
    );
  }

  // The device-derived stances DO travel; the raw vector/weights/electorate/identifiers never do.
  expect(record.match, "device-derived match travels").toMatch(/^[a-z0-9_]+$/);
  expect(Array.isArray(record.propositions)).toBe(true);
  for (const p of record.propositions) {
    expect(Object.keys(p).sort()).toEqual(["id", "stance"]);
    expect(["agree", "neutral", "disagree"]).toContain(p.stance);
  }
  const raw = req.postData() ?? "{}";
  expect(record, "no raw answer vector").not.toHaveProperty("answers");
  expect(raw, "no points on the wire").not.toContain('"points"');
  expect(raw, "no importance weights on the wire").not.toContain('"important"');
  expect(record, "no electorate on the detailed record").not.toHaveProperty("electorate");
  expect(record, "no IP on the wire").not.toHaveProperty("ip");

  // credentials 'omit' — the browser attaches no cookie/credential to a research request.
  const headers = req.headers();
  expect(headers["cookie"], "no cookie is attached (credentials omit)").toBeUndefined();
  expect(headers["authorization"], "no credential is attached").toBeUndefined();
  expect(headers["content-type"]).toContain("application/json");
});

test("the geography ping carries only election + electorate (+token)", async ({ page }) => {
  const posts = trackResearch(page);
  await reachSurvey(page);
  await consentAndFinish(page);

  await expect.poll(() => posts.geography.length, { timeout: 8000 }).toBe(1);
  const geo = JSON.parse(posts.geography[0]!.postData() ?? "{}");
  const allowed = new Set<string>(TRANSMITTABLE_FIELDS.geography);
  for (const key of Object.keys(geo)) {
    expect(allowed.has(key), `geography field "${key}" is not on the allowlist`).toBe(true);
  }
  expect(geo.electorate, "geography ping carries the electorate").toBeTruthy();
  expect(geo, "geography ping carries no match").not.toHaveProperty("match");
  expect(geo, "geography ping carries no demographics").not.toHaveProperty("demographics");
});
