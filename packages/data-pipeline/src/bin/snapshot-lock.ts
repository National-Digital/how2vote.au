import { CURRENT_ELECTION_ID, electionById } from "@how2vote/data-schema";
import { parseCliArgs } from "../cli.js";
import {
  fetchSnapshotVersion,
  guardLock,
  loadActiveMeta,
  loadVersions,
  lockSnapshotVersion,
  syncQuestionsFromSnapshot,
  upsertVersionEntry,
} from "../snapshot.js";
import { TvfyClient } from "../tvfy.js";
import { loadEnv } from "../env.js";

/**
 * The declaration-day lock ritual (ADR 0005, revised): final direct-API fetch →
 * questions.json sync → ballots copied into the version (ballot order is final at the same instant)
 * → meta locked with its direct-API provenance (retrievedAt, responseSha256, endpoint, licence).
 * Run it once, at/after the declaration of nominations; from then on the version is immutable and
 * CI enforces it. There is no external web-archive capture step any more — the committed raw
 * responses and their hashes are the tamper-evident record.
 *
 *   pnpm data:snapshot:lock [electionId] [--force]
 */
async function main(): Promise<void> {
  loadEnv();
  const { positionals, flags } = parseCliArgs(process.argv.slice(2));
  const electionId = positionals[0] ?? CURRENT_ELECTION_ID;
  const force = flags.has("--force");

  const meta = electionById(electionId);
  if (!meta) {
    console.error(`Unknown election "${electionId}".`);
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
  const verdict = guardLock(meta, active, new Date(), { force });
  if (!verdict.ok) {
    console.error(`✗ ${verdict.refusal}`);
    process.exit(1);
    return;
  }
  for (const w of verdict.warnings) console.warn(`! ${w}`);

  const versions = await loadVersions(electionId);
  const version = versions?.active ?? 1;
  const nowIso = new Date().toISOString();
  const client = new TvfyClient(apiKey);

  console.info(`Final direct-API fetch for ${electionId} snapshot v${version}…`);
  await fetchSnapshotVersion({
    electionId,
    version,
    basis: "contemporaneous-api-snapshot",
    effectiveAsAt: null,
    listPolicies: () => client.listPolicies(),
    getPolicy: (id) => client.getPolicy(id),
    nowIso,
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) console.info(`  … ${done}/${total}`);
    },
  });
  const merged = await syncQuestionsFromSnapshot(electionId);

  const locked = await lockSnapshotVersion(electionId, version, new Date().toISOString());
  const existing = versions?.history.find((h) => h.version === version);
  await upsertVersionEntry(electionId, {
    version,
    createdAt: existing?.createdAt ?? nowIso,
    lockedAt: locked.lockedAt,
    ...(existing?.reason ? { reason: existing.reason } : {}),
    ...(existing?.verifiedBy ? { verifiedBy: existing.verifiedBy } : {}),
  });

  console.info(
    `✓ snapshot v${version} LOCKED for ${electionId} at ${locked.lockedAt} — ` +
      `${merged.questions.length} questions, direct-API provenance recorded.`,
  );
  console.info(
    "Next: pnpm data:validate && pnpm --filter @how2vote/data-pipeline dataset:build, commit the snapshot, source and dist together.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
