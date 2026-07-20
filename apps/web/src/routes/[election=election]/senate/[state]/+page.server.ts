import { error } from "@sveltejs/kit";
import { buildSenatePage, senateEntries } from "$lib/content.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = senateEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildSenatePage(params.election, params.state);
  if (!data) error(404, "Unknown state");
  return data;
};
