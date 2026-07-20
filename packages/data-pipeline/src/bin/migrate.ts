import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ELECTION_IDS, electionById, type Merge, type PartyKey } from "@how2vote/data-schema";
import { electionPaths, readJson, writeJson } from "../paths.js";
import {
  buildBallots,
  buildQuestions,
  buildRegistry,
  combineToMerges,
  findUnresolved,
  type V0Combine,
  type V0Electorate,
  type V0House,
  type V0Match,
  type V0Question,
  type V0Senate,
  type V0Split,
} from "../migrate.js";

const ATTRIBUTION = "Vote data © They Vote For You (OpenAustralia Foundation), ODbL";
const firstOf = <T>(x: T[] | T): T => (Array.isArray(x) ? x[0]! : x);

/**
 * Per-election curation. Historical elections (2019/2022) leave `noRecord`/`aliasAdditions`
 * undefined: their `merges` come from the committed `manualCombineParties` table and every
 * unresolved ballot string is auto-recorded as no-data, faithfully reproducing the original site.
 * 2025 keeps the hand-curated aliases and noRecord allowlist that its clean-schema build was
 * validated against.
 */
type Curation = {
  merges?: Merge[];
  aliasAdditions?: Record<string, PartyKey>;
  /** When set, used verbatim; otherwise noRecord is auto-filled from unresolved ballot strings. */
  noRecord?: string[];
};

const CURATION: Record<string, Curation> = {
  "2025": {
    merges: [
      { master: "centre_alliance", merger: "nick_xenophon_team" },
      { master: "family_first_party", merger: "australian_conservatives" },
      { master: "united_australia_party", merger: "palmer_united_party" },
      { master: "united_australia_party", merger: "trumpet_of_patriots" },
    ],
    aliasAdditions: {
      "David Pocock": "senator_david_pocock",
      "Gerard Rennick People First": "senator_gerard_rennick",
    },
    noRecord: [
      "AJP",
      "Animal Justice Party",
      "Australia's Voice",
      "Australian Christians",
      "Citizens Party",
      "FUSION | Planet Rescue | Whistleblower Protection | Innovation",
      "HEART Party",
      "Independent",
      "Indigenous - Aboriginal Party of Australia",
      "Legalise Cannabis Party",
      "Libertarian",
      "Shooters, Fishers and Farmers Party",
      "Socialist Alliance",
      "Sustainable Australia Party - Universal Basic Income",
      "The Great Australian Party",
      "Victorian Socialists",
    ],
  },
};

async function migrateElection(id: string): Promise<void> {
  const meta = electionById(id);
  if (!meta) throw new Error(`Unknown election "${id}"`);
  const p = electionPaths(id);
  const v0Seed = (name: string): string => resolve(p.v0SeedDir, name);
  const curation = CURATION[id] ?? {};

  const [questionData, matchArr, house, senate, electorates] = await Promise.all([
    readJson<V0Question[]>(v0Seed("questionData.json")),
    readJson<V0Match[] | V0Match>(v0Seed("manualMatchCandidates.json")),
    readJson<V0House[]>(v0Seed("candidatesHouse.json")),
    readJson<V0Senate[]>(v0Seed("candidatesSenate.json")),
    readJson<V0Electorate[]>(v0Seed("federalElectorates.json")),
  ]);
  // Split and combine tables are optional (2019 has neither).
  const splitPath = v0Seed("manualSplitParties.json");
  const combinePath = v0Seed("manualCombineParties.json");
  const split = existsSync(splitPath)
    ? firstOf(await readJson<V0Split[] | V0Split>(splitPath))
    : {};
  const merges =
    curation.merges ??
    (existsSync(combinePath)
      ? combineToMerges(firstOf(await readJson<V0Combine[] | V0Combine>(combinePath)))
      : []);

  // First pass builds the registry with any curated noRecord (empty for historical elections),
  // so we can discover which ballot strings still fail to resolve.
  const draft = buildRegistry(firstOf(matchArr), split, {
    merges,
    aliasAdditions: curation.aliasAdditions,
    noRecord: curation.noRecord,
  });
  const ballots = buildBallots(house, senate, electorates, meta.dataVersion);
  const unresolved = findUnresolved(draft, ballots);

  // Historical elections have no curated allowlist: record every unmatched ballot string as
  // no-data, which is exactly how the original site scored an unmatched candidate.
  const registry = curation.noRecord
    ? draft
    : buildRegistry(firstOf(matchArr), split, {
        merges,
        aliasAdditions: curation.aliasAdditions,
        noRecord: unresolved,
      });
  const validKeys = new Set(registry.parties.map((p) => p.key));
  const questions = buildQuestions(questionData, meta.dataVersion, ATTRIBUTION, validKeys);

  await writeJson(p.source.parties, registry);
  await writeJson(p.source.questions, questions);
  await writeJson(p.source.ballots, ballots);
  await writeJson(v0Seed("unresolved.json"), unresolved);

  console.info(
    `✓ ${id}: ${questions.questions.length} questions, ${registry.parties.length} parties, ` +
      `house ${ballots.house.length}, senate ${ballots.senate.length}, ` +
      `electorates ${ballots.electorates.length}, ${unresolved.length} no-record party string(s)`,
  );
}

async function main(): Promise<void> {
  // Default: migrate the historical elections (2019/2022). The 2025 source is already committed
  // and validated; pass an explicit id (`pnpm --filter @how2vote/data-pipeline migrate 2025`)
  // to regenerate it.
  const args = process.argv.slice(2).filter((a) => ELECTION_IDS.includes(a));
  const ids = args.length > 0 ? args : ELECTION_IDS.filter((id) => id !== "2025");
  for (const id of ids) await migrateElection(id);
  console.info(`\nMigrated ${ids.length} election(s): ${ids.join(", ")}.`);
  console.info("Run pnpm --filter @how2vote/data-pipeline dataset:build to build the bundles.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
