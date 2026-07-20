import { ELECTIONS } from "@how2vote/data-schema";

// Prerender one landing page per past election (the current one lives at `/`).
export const prerender = true;

export const entries = () => ELECTIONS.filter((e) => !e.current).map((e) => ({ election: e.id }));
