import { error } from "@sveltejs/kit";
import { FILE_BUILDERS, dataEntries, jsonResponse } from "$lib/open-data.server";
import type { EntryGenerator, RequestHandler } from "./$types";

export const prerender = true;
export const entries: EntryGenerator = () => dataEntries("positions");

export const GET: RequestHandler = ({ params }) => {
  const file = FILE_BUILDERS.positions(params.election);
  if (!file) error(404, "Unknown election");
  return jsonResponse(file);
};
