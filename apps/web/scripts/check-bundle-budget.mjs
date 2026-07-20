#!/usr/bin/env node
/**
 * Performance budget gate. Sums the gzipped size of the client JS a visitor actually
 * downloads and fails if it exceeds the budget in budgets.json. Deterministic and CI-friendly
 * (unlike Lighthouse, which stays informational). Run after `vite build`.
 *
 * Per-election datasets are the one wrinkle: each election's dataset is a separate dynamic-import
 * chunk (see $lib/data), and exactly ONE loads per session, on demand, off the first-paint path.
 * Summing all of them would penalise multi-election support for bytes that never travel together, so
 * we count every non-dataset chunk in full plus only the single largest dataset chunk (the worst
 * case a visitor loads). That still catches app-shell/dependency bloat and any dataset-size
 * regression. The dataset chunks are identified from Vite's build manifest, not by guesswork.
 */
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const JS_DIR = join(ROOT, "build", "_app", "immutable");
const VITE_MANIFEST = join(ROOT, ".svelte-kit", "output", "client", ".vite", "manifest.json");

const budget = JSON.parse(await readFile(join(ROOT, "budgets.json"), "utf8"));
const limitBytes = budget.jsGzipKB * 1024;

/** Basenames of the per-election dataset chunks, from the Vite manifest (empty if unavailable). */
async function datasetChunkNames() {
  try {
    const manifest = JSON.parse(await readFile(VITE_MANIFEST, "utf8"));
    return new Set(
      Object.entries(manifest)
        .filter(([src]) => /data\/dist\/[^/]+\/dataset\.json$/.test(src))
        .map(([, entry]) => basename(entry.file)),
    );
  } catch {
    return new Set(); // no manifest → count everything (conservative)
  }
}

async function* jsFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`Bundle budget: no build output at ${dir} — run the build first.`);
    process.exit(1);
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(path);
    else if (entry.name.endsWith(".js")) yield path;
  }
}

const datasetChunks = await datasetChunkNames();

let base = 0; // everything except the dataset chunks
let largestDataset = 0; // the single dataset a visitor loads (worst case)
for await (const file of jsFiles(JS_DIR)) {
  const size = gzipSync(await readFile(file)).length;
  if (datasetChunks.has(basename(file))) largestDataset = Math.max(largestDataset, size);
  else base += size;
}

const total = base + largestDataset;
const totalKB = (total / 1024).toFixed(1);
const note =
  datasetChunks.size > 1 ? ` (app + largest of ${datasetChunks.size} election datasets)` : "";
if (total > limitBytes) {
  console.error(
    `✗ Bundle budget exceeded: ${totalKB} KB gzipped > ${budget.jsGzipKB} KB budget${note}.`,
  );
  process.exit(1);
}
console.info(`✓ Bundle budget OK: ${totalKB} KB gzipped ≤ ${budget.jsGzipKB} KB budget${note}.`);
