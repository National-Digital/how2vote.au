import { error } from "@sveltejs/kit";
import { buildPostcodeHub, postcodeHubEntries } from "$lib/postcodes.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = postcodeHubEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildPostcodeHub(params.election);
  if (!data) error(404, "No postcode pages for this election");
  return data;
};
