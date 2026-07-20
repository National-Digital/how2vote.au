import { error } from "@sveltejs/kit";
import { buildPartyPage, partyEntries } from "$lib/content.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = partyEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildPartyPage(params.election, params.party);
  if (!data) error(404, "Unknown party");
  return data;
};
