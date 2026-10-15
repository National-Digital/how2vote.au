import { error } from "@sveltejs/kit";
import { buildElectorateHub, electionEntries, type ElectorateHub } from "$lib/content.server";
import { postcodeElections } from "$lib/postcodes.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = electionEntries;

export const load: PageServerLoad = ({ params }): ElectorateHub & { postcodesHref?: string } => {
  const data = buildElectorateHub(params.election);
  if (!data) error(404, "Unknown election");
  return postcodeElections().includes(params.election)
    ? { ...data, postcodesHref: `/${params.election}/postcodes` }
    : data;
};
