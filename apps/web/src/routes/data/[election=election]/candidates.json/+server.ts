import { error } from "@sveltejs/kit";
import { FILE_BUILDERS, dataEntries, jsonResponse } from "$lib/open-data.server";
import type { EntryGenerator, RequestHandler } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = () => dataEntries("candidates");

export const GET: RequestHandler = ({ params }) => {
  const file = FILE_BUILDERS.candidates(params.election);
  if (!file) error(404, "No ballot for this election");
  return jsonResponse(file);
};
