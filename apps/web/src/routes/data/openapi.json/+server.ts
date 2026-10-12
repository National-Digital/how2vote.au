import { jsonResponse, openApiDocument } from "$lib/open-data.server";

export const prerender = true;

export function GET() {
  return jsonResponse(openApiDocument());
}
