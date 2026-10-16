import { error } from "@sveltejs/kit";
import { ELECTION_IDS } from "@how2vote/data-schema";
import { buildElectorateHub } from "$lib/content.server";
import { STAGES, type Stage } from "$lib/election-stage";
import type { EntryGenerator, PageServerLoad } from "./$types";

// Each election's electorate list as it reads at each stage, rendered at build time for the iOS app
// to draw the one the election is at (ADR 0019 D4b). Removed from every other channel's build.
export const prerender = true;

export const entries: EntryGenerator = () =>
  ELECTION_IDS.flatMap((election) => STAGES.map((stage) => ({ election, stage })));

export const load: PageServerLoad = ({ params }) => {
  const stage = params.stage as Stage;
  const data = STAGES.includes(stage) ? buildElectorateHub(params.election, stage) : null;
  if (!data) error(404, "No such stage");
  return { data, stage };
};
