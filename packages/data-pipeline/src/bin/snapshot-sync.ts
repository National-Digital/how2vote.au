import { CURRENT_ELECTION_ID } from "@how2vote/data-schema";
import { parseCliArgs } from "../cli.js";
import { syncQuestionsFromSnapshot } from "../snapshot.js";

/**
 * Re-syncs questions.json from the active committed snapshot WITHOUT touching the network — e.g.
 * after rewording a question's `text`, to confirm nothing else drifts. The consistency gate in
 * `pnpm data:validate` verifies the result.
 *
 *   `pnpm --filter @how2vote/data-pipeline snapshot:sync [electionId]`
 */
async function main(): Promise<void> {
  const { positionals } = parseCliArgs(process.argv.slice(2));
  const electionId = positionals[0] ?? CURRENT_ELECTION_ID;
  const merged = await syncQuestionsFromSnapshot(electionId);
  console.info(
    `✓ questions.json re-synced for ${electionId} (${merged.questions.length} questions, dataVersion ${merged.dataVersion}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
