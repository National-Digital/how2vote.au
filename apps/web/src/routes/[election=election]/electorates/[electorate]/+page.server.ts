import { error } from "@sveltejs/kit";
import { buildElectoratePage, electorateEntries } from "$lib/content.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = electorateEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildElectoratePage(params.election, params.electorate);
  if (!data) error(404, "Unknown electorate");
  return data;
};
