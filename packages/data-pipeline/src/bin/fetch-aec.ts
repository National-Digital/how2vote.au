import { CURRENT_ELECTION_ID } from "@how2vote/data-schema";
import { fetchAecNominations } from "../aec.js";
import { loadSource } from "../dataset.js";
import { electionPaths, writeJson } from "../paths.js";
import { loadEnv } from "../env.js";

/**
 * Fetches AEC candidate nominations and rewrites the current election's `ballots.json`. Ready to run
 * when the next election is called: supply the published CSV URLs via AEC_HOUSE_CSV_URL /
 * AEC_SENATE_CSV_URL. Between elections there is no live feed, so the seeded ballots stand.
 */
async function main(): Promise<void> {
  loadEnv();
  const houseCsvUrl = process.env["AEC_HOUSE_CSV_URL"];
  const senateCsvUrl = process.env["AEC_SENATE_CSV_URL"];
  if (!houseCsvUrl || !senateCsvUrl) {
    console.error(
      "Set AEC_HOUSE_CSV_URL and AEC_SENATE_CSV_URL to the published AEC nomination CSV downloads.",
    );
    process.exit(1);
    return;
  }

  const { house, senate, electorates } = await fetchAecNominations({ houseCsvUrl, senateCsvUrl });
  const existing = await loadSource();
  await writeJson(electionPaths(CURRENT_ELECTION_ID).source.ballots, {
    schemaVersion: 1,
    dataVersion: existing.ballots.dataVersion,
    source: "Australian Electoral Commission (candidate nominations)",
    house,
    senate,
    electorates,
  });
  console.info(
    `✓ ballots: house ${house.length}, senate ${senate.length}, electorates ${electorates.length}`,
  );
  console.info("Run pnpm data:validate to check every party string still resolves.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
