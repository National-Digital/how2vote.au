import { CURRENT_ELECTION_ID, electionById } from "@how2vote/data-schema";
import { parseCliArgs } from "../cli.js";
import {
  fetchSnapshotVersion,
  guardFetch,
  loadActiveMeta,
  loadVersions,
  syncQuestionsFromSnapshot,
  upsertVersionEntry,
} from "../snapshot.js";
import { TvfyClient } from "../tvfy.js";
import { loadEnv } from "../env.js";

/**
 * Fetches/refreshes an election's TVFY snapshot from the live API (ADR 0005). Permitted only
 * inside the writ window (issue of writs → declaration of nominations) — this command and
 * `snapshot-lock` are the ONLY sanctioned paths to the TVFY API for release data; there is no
 * scheduled polling. Re-syncs questions.json from the snapshot so curation can never drift.
 *
 *   pnpm data:snapshot:fetch [electionId] [--force]
 *   pnpm data:snapshot:fetch [electionId] --new-version --reason "…" --verified-by "…"
 */
async function main(): Promise<void> {
  loadEnv();
  const { positionals, flags, values } = parseCliArgs(process.argv.slice(2), [
    "--reason",
    "--verified-by",
  ]);
  const electionId = positionals[0] ?? CURRENT_ELECTION_ID;
  const force = flags.has("--force");
  const newVersion = flags.has("--new-version");
  const reason = values["--reason"];
  const verifiedBy = values["--verified-by"];

  const meta = electionById(electionId);
  if (!meta) {
    console.error(`Unknown election "${electionId}".`);
    process.exit(1);
    return;
  }
  if (newVersion && (!reason || !verifiedBy)) {
    console.error(
      "--new-version is a verified correction: --reason and --verified-by are required.",
    );
    process.exit(1);
    return;
  }
  const apiKey = process.env["TVFY_API_KEY"];
  if (!apiKey) {
    console.error("TVFY_API_KEY is not set. Copy .env.example to .env and add your key.");
    process.exit(1);
    return;
  }

  const active = await loadActiveMeta(electionId);
  const verdict = guardFetch(meta, active, new Date(), { force, newVersion });
  if (!verdict.ok) {
    console.error(`✗ ${verdict.refusal}`);
    process.exit(1);
    return;
  }
  for (const w of verdict.warnings) console.warn(`! ${w}`);

  const versions = await loadVersions(electionId);
  const version = newVersion ? (versions?.active ?? 0) + 1 : (versions?.active ?? 1);
  const nowIso = new Date().toISOString();
  const client = new TvfyClient(apiKey);

  console.info(`Fetching snapshot v${version} for ${electionId}…`);
  await fetchSnapshotVersion({
    electionId,
    version,
    // A writ-window fetch is contemporaneous: TVFY's aggregate IS the relevant-period record, so
    // positions are synced from and verified against this snapshot below.
    basis: "contemporaneous-api-snapshot",
    effectiveAsAt: null,
    listPolicies: () => client.listPolicies(),
    getPolicy: (id) => client.getPolicy(id),
    nowIso,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) console.info(`  … ${done}/${total}`);
    },
  });
  await upsertVersionEntry(electionId, {
    version,
    createdAt: versions?.history.find((h) => h.version === version)?.createdAt ?? nowIso,
    lockedAt: null,
    ...(reason ? { reason } : {}),
    ...(verifiedBy ? { verifiedBy } : {}),
  });

  const merged = await syncQuestionsFromSnapshot(electionId);
  console.info(
    `✓ snapshot v${version} fetched (${merged.questions.length} questions), questions.json synced, dataVersion ${merged.dataVersion}`,
  );
  console.info(
    "Next: pnpm data:validate && pnpm --filter @how2vote/data-pipeline dataset:build, review the diff, commit.",
  );
  console.info("At the declaration of nominations run: pnpm data:snapshot:lock " + electionId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
