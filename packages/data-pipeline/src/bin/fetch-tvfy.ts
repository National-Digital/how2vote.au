import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { TvfyClient } from "../tvfy.js";
import { paths, writeJson } from "../paths.js";
import { loadEnv } from "../env.js";

/**
 * Fetches every policy from They Vote For You into `data/raw/` for the compiler. Low-volume,
 * non-commercial API use is free; a key is required (TVFY_API_KEY). Raw fetches are git-ignored and
 * reproducible.
 */
async function main(): Promise<void> {
  loadEnv();
  const apiKey = process.env["TVFY_API_KEY"];
  if (!apiKey) {
    console.error("TVFY_API_KEY is not set. Copy .env.example to .env and add your key.");
    process.exit(1);
    return;
  }
  const client = new TvfyClient(apiKey);

  const policies = await client.listPolicies();
  await writeJson(paths.raw.tvfyPolicies, policies);
  console.info(`Fetched ${policies.length} policy summaries.`);

  await mkdir(paths.raw.tvfyDir, { recursive: true });
  let done = 0;
  for (const summary of policies) {
    const detail = await client.getPolicy(summary.id);
    await writeJson(resolve(paths.raw.tvfyDir, `${summary.id}.json`), detail);
    done++;
    if (done % 10 === 0) console.info(`  … ${done}/${policies.length}`);
  }
  console.info(`✓ fetched ${done} policy details into ${paths.raw.tvfyDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
