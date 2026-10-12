import { openDataCatalogue } from "$lib/open-data.server";
import type { PageServerLoad } from "./$types";

export const prerender = true;

export const load: PageServerLoad = () => ({ openData: openDataCatalogue() });
