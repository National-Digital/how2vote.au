import { error } from "@sveltejs/kit";
import { buildIssuePage, issueEntries } from "$lib/content.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = issueEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildIssuePage(params.election, params.issue);
  if (!data) error(404, "Unknown proposition");
  return data;
};
