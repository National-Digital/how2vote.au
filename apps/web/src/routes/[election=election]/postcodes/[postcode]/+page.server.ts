import { error } from "@sveltejs/kit";
import { buildPostcodePage, postcodeEntries } from "$lib/postcodes.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = postcodeEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildPostcodePage(params.election, params.postcode);
  if (!data) error(404, "Unknown postcode");
  return data;
};
