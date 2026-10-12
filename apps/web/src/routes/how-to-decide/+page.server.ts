import { CURRENT_ELECTION_ID, activeQuestions, electionById } from "@how2vote/data-schema";
import { datasetFor } from "$lib/content.server";
import { ballotFor } from "$lib/ballots";
import { stageFor } from "$lib/election-stage";
import type { PageServerLoad } from "./$types";

export const prerender = true;

export const load: PageServerLoad = () => {
  const meta = electionById(CURRENT_ELECTION_ID);
  const dataset = datasetFor(CURRENT_ELECTION_ID);
  if (!meta || !dataset) throw new Error(`no dataset for ${CURRENT_ELECTION_ID}`);
  const ballot = ballotFor(CURRENT_ELECTION_ID);
  return {
    label: meta.label,
    propositions: activeQuestions(dataset.questions).length,
    // Fixed at build time, so the hydrated page reads as it was prerendered.
    stage: stageFor(meta, ballot),
    electorateLess: ballot === "none",
    issuesHref: `/${CURRENT_ELECTION_ID}/issues`,
  };
};
