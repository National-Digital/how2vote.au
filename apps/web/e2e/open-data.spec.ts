import { expect, test } from "@playwright/test";

// The static /data/ files against the pages they mirror. The files exist on the web channel only.
const channel = process.env["PUBLIC_DIST_CHANNEL"] ?? "web";
const isWeb = channel === "web";

type Candidates = {
  license: { id: string };
  attribution: string;
  house: { electorate: string; url: string; candidates: { name: string }[] }[];
};

test("the index, OpenAPI document and every listed file are served as JSON", async ({
  request,
}) => {
  test.skip(!isWeb, "web channel only");
  const index = await request.get("/data/index.json");
  expect(index.ok()).toBe(true);
  expect(index.headers()["content-type"]).toContain("application/json");
  const openapi = await (await request.get("/data/openapi.json")).json();
  expect(openapi.openapi).toBe("3.1.0");

  const body = (await index.json()) as {
    elections: { files: { url: string; license: string }[] }[];
  };
  const files = body.elections.flatMap((e) => e.files);
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const res = await request.get(new URL(f.url).pathname);
    expect(res.ok(), f.url).toBe(true);
    const json = (await res.json()) as { license: { id: string }; attribution: string };
    expect(json.license.id).toBe(f.license);
    expect(json.attribution.length).toBeGreaterThan(0);
  }
});

test("candidates.json lists an electorate's candidates in the order its page shows", async ({
  page,
  request,
}) => {
  test.skip(!isWeb, "web channel only");
  const file = (await (await request.get("/data/2025/candidates.json")).json()) as Candidates;
  expect(file.license.id).toBe("CC-BY-4.0");
  for (const electorate of [file.house[0]!, file.house.at(-1)!]) {
    await page.goto(new URL(electorate.url).pathname);
    const shown = await page.locator("ul.rows > li .lead").allTextContents();
    expect(shown.map((s) => s.replace(/,\s*$/, "").trim())).toEqual(
      electorate.candidates.map((c) => c.name),
    );
  }
});
