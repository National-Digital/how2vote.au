import { error } from "@sveltejs/kit";
import { buildIssueHub, electionEntries } from "$lib/content.server";
import type { EntryGenerator, PageServerLoad } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = electionEntries;

export const load: PageServerLoad = ({ params }) => {
  const data = buildIssueHub(params.election);
  if (!data) error(404, "Unknown election");
  return data;
};
