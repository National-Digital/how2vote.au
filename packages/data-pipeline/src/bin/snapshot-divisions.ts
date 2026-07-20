import { CURRENT_ELECTION_ID, electionById, type QuestionSet } from "@how2vote/data-schema";
import { parseCliArgs } from "../cli.js";
import { electionPaths, readJson, writeJson } from "../paths.js";
import { filterDivisionsToVintage, loadActiveMeta } from "../snapshot.js";
import { compilePolicy, TvfyClient } from "../tvfy.js";
import { loadEnv } from "../env.js";

/**
 * One-off division-field backfill for PAST elections (ADR 0005): fetches each used policy from
 * the live API (raw, not committed), restricts its divisions to those dated on/before the
 * election's dataVersion (the vintage its positions were compiled at), and writes the resulting
 * divisionCount/First/Last into questions.json — so past elections carry the same question shape
 * future snapshot-synced elections do. Positions and text are untouched; dataVersion is unchanged.
 *
 * Caveat (documented in ADR 0005): TVFY's division curation is current-day — retroactively added
 * or removed division links make these fields retrospective metadata, not snapshot-verified
 * evidence.
 *
 *   pnpm data:snapshot:divisions <electionId>
 */
async function main(): Promise<void> {
  loadEnv();
  const { positionals } = parseCliArgs(process.argv.slice(2));
  const electionId = positionals[0] ?? CURRENT_ELECTION_ID;

  const meta = electionById(electionId);
  if (!meta) {
    console.error(`Unknown election "${electionId}".`);
    process.exit(1);
    return;
  }
  const active = await loadActiveMeta(electionId);
  if (active?.basis === "contemporaneous-api-snapshot") {
    console.error(
      `"${electionId}" has a contemporaneous API snapshot — its division fields come from data:snapshot:fetch/lock sync, not this reconstruction backfill.`,
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

  const source = electionPaths(electionId).source;
  const questions = await readJson<QuestionSet>(source.questions);
  const vintage = questions.dataVersion;
  const client = new TvfyClient(apiKey);

  console.info(
    `Backfilling division fields for ${electionId} (${questions.questions.length} questions, vintage ≤ ${vintage})…`,
  );
  let done = 0;
  const updated = [];
  for (const q of questions.questions) {
    const detail = filterDivisionsToVintage(await client.getPolicy(q.id), vintage);
    const compiled = compilePolicy(detail);
    if (compiled.divisionCount === 0) {
      console.warn(`! policy ${q.id}: no divisions on/before ${vintage} — fields omitted.`);
      const { divisionFirst: _f, divisionLast: _l, divisionCount: _c, ...rest } = q;
      updated.push(rest);
    } else {
      updated.push({
        ...q,
        divisionFirst: compiled.divisionFirst!,
        divisionLast: compiled.divisionLast!,
        divisionCount: compiled.divisionCount,
      });
    }
    done++;
    if (done % 10 === 0 || done === questions.questions.length) {
      console.info(`  … ${done}/${questions.questions.length}`);
    }
  }

  await writeJson(source.questions, { ...questions, questions: updated });
  console.info(`✓ questions.json updated for ${electionId} (positions and dataVersion untouched).`);
  console.info("Next: pnpm data:validate && pnpm --filter @how2vote/data-pipeline dataset:build.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
