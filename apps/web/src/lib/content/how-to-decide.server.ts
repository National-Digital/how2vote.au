import { CURRENT_ELECTION_ID, activeQuestions, electionById } from "@how2vote/data-schema";
import { ballotFor } from "$lib/ballots";
import { datasetFor } from "$lib/content.server";

/** What /how-to-decide says about the current election, less its stage. */
export function howToDecide() {
  const meta = electionById(CURRENT_ELECTION_ID);
  const dataset = datasetFor(CURRENT_ELECTION_ID);
  if (!meta || !dataset) throw new Error(`no dataset for ${CURRENT_ELECTION_ID}`);
  return {
    label: meta.label,
    propositions: activeQuestions(dataset.questions).length,
    electorateLess: ballotFor(CURRENT_ELECTION_ID) === "none",
    issuesHref: `/${CURRENT_ELECTION_ID}/issues`,
  };
}
