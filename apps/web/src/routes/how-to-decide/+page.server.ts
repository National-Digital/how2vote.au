import { CURRENT_ELECTION_ID, activeQuestions, electionById } from "@how2vote/data-schema";
import { datasetFor } from "$lib/content.server";
import { decideStage } from "$lib/content/how-to-decide";
import { manifestFor } from "$lib/manifest";
import type { PageServerLoad } from "./$types";

export const prerender = true;

export const load: PageServerLoad = () => {
  const meta = electionById(CURRENT_ELECTION_ID);
  const dataset = datasetFor(CURRENT_ELECTION_ID);
  if (!meta || !dataset) throw new Error(`no dataset for ${CURRENT_ELECTION_ID}`);
  const electorateLess = (manifestFor(CURRENT_ELECTION_ID).counts["electorates"] ?? 0) === 0;
  return {
    label: meta.label,
    propositions: activeQuestions(dataset.questions).length,
    // Fixed at build time, so the hydrated page reads as it was prerendered.
    stage: decideStage(meta, electorateLess),
    issuesHref: `/${CURRENT_ELECTION_ID}/issues`,
  };
};
