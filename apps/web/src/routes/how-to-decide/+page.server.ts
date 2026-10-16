import { howToDecide } from "$lib/content/how-to-decide.server";
import type { PageServerLoad } from "./$types";

export const prerender = true;

export const load: PageServerLoad = () => howToDecide();
