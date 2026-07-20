import { ELECTION_IDS } from "@how2vote/data-schema";

/**
 * Route matcher for the per-election segment (`/2019`, `/2025/parties/…`, …). Matches any known
 * election id, so both the past-election landings and the data-derived content pages
 * (electorates / Senate / issues / parties) resolve for every election. Non-election paths
 * (`/about`, …) don't match a known id and fall through to their own routes, which keeps a bare
 * segment from colliding with the content routes.
 *
 * Note the current election's *landing* still lives at `/` (the `[election]` landing route only
 * prerenders the past elections); this matcher only governs which segments are valid election ids.
 */
const IDS = new Set(ELECTION_IDS);

export function match(param: string): boolean {
  return IDS.has(param);
}
