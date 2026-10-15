import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { electionById } from "@how2vote/data-schema";
import {
  compareLead,
  decideFaqs,
  decideStage,
  type DecideStage,
} from "../src/lib/content/how-to-decide";
import { seedEligibility } from "./flow-helpers";

const STAGES: DecideStage[] = ["unannounced", "called", "ballot", "held"];

type Faq = {
  "@type": string;
  mainEntity: { "@type": string; name: string; acceptedAnswer: { text: string } }[];
};

const elections = JSON.parse(
  readFileSync(new URL("../../../data/dist/elections.json", import.meta.url), "utf8"),
) as { id: string; label: string; current: boolean }[];
const current = elections.find((e) => e.current)!;

test.beforeEach(async ({ page }) => {
  await seedEligibility(page);
});

test("each FAQ answer in the JSON-LD is the answer shown under its question", async ({ page }) => {
  for (const javaScriptEnabled of [false, true]) {
    const context = await page
      .context()
      .browser()!
      .newContext({ javaScriptEnabled, baseURL: test.info().project.use.baseURL });
    const view = await context.newPage();
    await view.goto("/how-to-decide");
    const blocks = await view.locator('script[type="application/ld+json"]').allTextContents();
    const faq = blocks.map((b) => JSON.parse(b) as Faq).find((n) => n["@type"] === "FAQPage");
    expect(faq, "the page carries FAQPage JSON-LD").toBeDefined();
    expect(faq!.mainEntity.length).toBeGreaterThanOrEqual(3);
    for (const q of faq!.mainEntity) {
      const heading = view.locator("article h2", { hasText: q.name });
      await expect(heading).toHaveCount(1);
      await expect(heading).toHaveText(q.name);
      const shown = await heading.evaluate((h) => h.nextElementSibling?.textContent ?? "");
      expect(shown.replace(/\s+/g, " ").trim()).toBe(q.acceptedAnswer.text);
    }
    await context.close();
  }
});

test("the proposition count is the current election's", async ({ page }) => {
  await page.goto(`/${current.id}/issues`);
  const count = await page.locator("ul.rows > li").count();
  expect(count).toBeGreaterThan(0);

  await page.goto("/how-to-decide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to decide your vote");
  await expect(page.locator("article")).toContainText(
    `For the ${current.label}, How2Vote asks about ${count} propositions:`,
  );
  await expect(page.getByRole("link", { name: "Start the questions" })).toHaveAttribute(
    "href",
    "/start",
  );
});

test("the page reads for the current election's stage", async ({ page }) => {
  const meta = electionById(current.id)!;
  const { counts } = JSON.parse(
    readFileSync(
      new URL(`../../../data/dist/${current.id}/manifest.json`, import.meta.url),
      "utf8",
    ),
  ) as { counts: Record<string, number> };
  // The build fixed the stage when it prerendered the page; the build ran moments ago.
  const stage = decideStage(meta, (counts["electorates"] ?? 0) === 0);
  await page.goto("/how-to-decide");
  const article = page.locator("article");
  await expect(article).toContainText(compareLead(stage));
  for (const other of STAGES.filter((s) => compareLead(s) !== compareLead(stage))) {
    await expect(article).not.toContainText(compareLead(other));
  }
  const shown = (await article.textContent())!.replace(/\s+/g, " ");
  for (const { answer } of decideFaqs({
    label: current.label,
    propositions: 0,
    stage,
  }).slice(2)) {
    expect(shown).toContain(answer);
  }
});

test("the footer, sitemap and llms.txt link the page", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator("footer.site-footer").getByRole("link", { name: "How to decide" }),
  ).toHaveAttribute("href", "/how-to-decide");
  for (const path of ["/sitemap.xml", "/llms.txt"]) {
    const body = await (await page.request.get(path)).text();
    expect(body, path).toContain("https://how2vote.au/how-to-decide");
  }
});
