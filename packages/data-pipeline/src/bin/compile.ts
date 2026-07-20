import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { compilePolicy, type CompiledPolicy, type TvfyPolicyDetail } from "../tvfy.js";
import { paths, readJson, writeJson } from "../paths.js";

/**
 * Compiles the raw TVFY policy details in `data/raw/tvfy/` into the full per-party position matrix
 * (`data/compiled/positions.json`), deterministically. The output is a
 * reproducible, git-ignored EXPLORATION artifact for curators browsing the full catalogue — the
 * curated `data/source/<election>/questions.json` is synced and ENFORCED against the committed
 * snapshot instead (`data:snapshot:fetch` / `snapshot:sync`, gated by the snapshot-consistency
 * check in `data:validate`; ADR 0005).
 */
async function main(): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(paths.raw.tvfyDir)).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`No raw policies at ${paths.raw.tvfyDir}. Run "pnpm data:fetch:tvfy" first.`);
    process.exit(1);
    return;
  }

  const compiled: CompiledPolicy[] = [];
  for (const file of files.sort()) {
    const detail = await readJson<TvfyPolicyDetail>(resolve(paths.raw.tvfyDir, file));
    compiled.push(compilePolicy(detail));
  }
  compiled.sort((a, b) => a.id - b.id);

  await writeJson(paths.compiled, {
    source: "They Vote For You (OpenAustralia Foundation), ODbL",
    compiledAt: "deterministic", // no wall-clock: output depends only on inputs
    policyCount: compiled.length,
    policies: compiled,
  });
  console.info(`✓ compiled ${compiled.length} policies → ${paths.compiled}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
