import { ELECTIONS, formatReport, type ElectionsIndex } from "@how2vote/data-schema";
import { buildManifest, loadSource, validateElection } from "../dataset.js";
import { electionPaths, paths, writeJson } from "../paths.js";

/**
 * Builds every election's app-ready dataset bundle: for each election parse source → validate
 * (fail closed — referential integrity plus the snapshot-consistency gate where a committed
 * snapshot exists, so dist can never be written from a snapshot-divergent source) → write
 * `dist/<id>/dataset.json` and a checksummed `dist/<id>/manifest.json`. Finally writes
 * `dist/elections.json`, the index the app imports to drive the election toggle. The web app
 * imports each `dataset.json`; the manifest checksum and data vintage are surfaced on every card
 * (integrity + ODbL obligations).
 */
async function main(): Promise<void> {
  let failed = false;
  for (const meta of ELECTIONS) {
    const dataset = await loadSource(meta.id);
    const { report, snapshotMeta } = await validateElection(meta, dataset);
    console.info(`[${meta.id}] ${formatReport(report)}`);
    if (!report.ok) {
      failed = true;
      continue;
    }
    const manifest = buildManifest(dataset, snapshotMeta);
    const dist = electionPaths(meta.id).dist;
    await writeJson(dist.dataset, dataset);
    await writeJson(dist.manifest, manifest);
    console.info(
      `✓ [${meta.id}] dataset.json (${manifest.checksum.slice(0, 12)}…), vintage ${manifest.dataVersion}`,
    );
  }

  if (failed) {
    console.error("Refusing to write the election index: at least one dataset is invalid.");
    process.exit(1);
  }

  const index: ElectionsIndex = ELECTIONS;
  await writeJson(paths.electionsIndex, index);
  console.info(`✓ elections index (${index.length}): ${index.map((e) => e.id).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
