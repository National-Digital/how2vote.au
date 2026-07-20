import type { Dataset, Electorate } from "@how2vote/data-schema";
import { CURRENT_ELECTION_ID, ELECTION_IDS, activeQuestions } from "@how2vote/data-schema";
import { orderedQuestionIds, slugify } from "@how2vote/engine";

/**
 * Each election's committed, build-validated dataset powers the quiz, scoring and card, fully
 * client-side and offline. At ~330 KB each they dominate the JavaScript payload, yet only the
 * ballot → quiz → review → card flow needs one — the home, about and other content pages never
 * touch a dataset. So they are loaded on demand, one election at a time, via a dynamic import
 * ({@link loadData}) rather than a static one: Vite emits each election as its own async chunk,
 * keeping all of them out of the layout/home bundle so first paint hydrates without parsing any.
 *
 * The manifests (checksum, vintage, attribution, counts) are tiny and live in {@link "$lib/manifest"};
 * they are imported statically so the footer, home and content pages can show attribution and
 * question counts per election without pulling a dataset into their bundle.
 */

export type Question = Dataset["questions"]["questions"][number];

export type Data = {
  dataset: Dataset;
  /** Presentable questions in order — withdrawn questions (disabled outputs) excluded. */
  questions: Question[];
  /**
   * The share-codec id list: EVERY question, including withdrawn ones, in dataset order. The
   * fragment payload is positional over this list, so it must not shrink when a question is
   * withdrawn or previously shared links would decode against the wrong slots.
   */
  questionIds: number[];
  /** The ids a user can actually answer (drives quiz length/progress). */
  activeQuestionIds: number[];
  /** Electorates for a state, alphabetical. */
  electoratesFor(stateCode: string): Electorate[];
  /** Resolves a share-link electorate slug back to a real electorate (division names are unique). */
  electorateFromSlug(slug: string): Electorate | null;
};

/**
 * Dynamic import of one election's dataset chunk. Data-driven, not a per-election switch: a single
 * templated specifier lets Vite's dynamic-import-vars resolve the "$data/dist/[id]/dataset.json"
 * glob and emit a distinct, statically-analysable async chunk for every election it finds on disk at
 * build time (verified: one chunk per election, loaded on demand). Adding an election therefore needs
 * NO edit here: committing data/dist/[id]/dataset.json and registering the id in ELECTIONS is enough
 * (see docs/adding-an-election.md).
 *
 * The id is guarded against the ELECTION_IDS registry (an unknown id falls back to the current
 * election) before it reaches the specifier, so a stray id can never become an unbounded or
 * path-traversing import: the interpolated segment is always a known, url-safe election slug.
 */
function importDataset(electionId: string): Promise<{ default: unknown }> {
  const id = ELECTION_IDS.includes(electionId) ? electionId : CURRENT_ELECTION_ID;
  return import(`$data/dist/${id}/dataset.json`);
}

const cache = new Map<string, Promise<Data>>();

/**
 * Loads an election's dataset on demand and returns the derived views the app needs. Memoised per
 * election, so each chunk is fetched and its derived structures built at most once per session.
 * Call it from a route's onMount and render a loader until it resolves.
 */
export function loadData(electionId: string): Promise<Data> {
  let promise = cache.get(electionId);
  if (!promise) {
    promise = importDataset(electionId).then((mod) => {
      const dataset = mod.default as unknown as Dataset;
      const presentable = activeQuestions(dataset.questions);
      return {
        dataset,
        questions: presentable,
        questionIds: orderedQuestionIds(dataset),
        activeQuestionIds: presentable.map((q) => q.id),
        electoratesFor: (stateCode: string): Electorate[] =>
          dataset.ballots.electorates
            .filter((e) => e.state.toUpperCase() === stateCode.toUpperCase())
            .sort((a, b) => a.electorate.localeCompare(b.electorate)),
        electorateFromSlug: (slug: string): Electorate | null =>
          dataset.ballots.electorates.find((e) => slugify(e.electorate) === slug) ?? null,
      };
    });
    // Do NOT memoise a rejection: a transient import/fetch failure would otherwise wedge the flow
    // permanently (every later call returns the same rejected promise). Evict on failure so the next
    // call retries. The returned/cached promise still rejects for the current caller (this is a side
    // chain), so a route's .catch can surface an error state and offer a retry.
    promise.catch(() => {
      if (cache.get(electionId) === promise) cache.delete(electionId);
    });
    cache.set(electionId, promise);
  }
  return promise;
}

/** State code → full name, in ballot-paper order. Dataset-free, so it renders before data loads. */
export const STATES: { code: string; name: string }[] = [
  { code: "NSW", name: "New South Wales" },
  { code: "VIC", name: "Victoria" },
  { code: "QLD", name: "Queensland" },
  { code: "WA", name: "Western Australia" },
  { code: "SA", name: "South Australia" },
  { code: "TAS", name: "Tasmania" },
  { code: "ACT", name: "Australian Capital Territory" },
  { code: "NT", name: "Northern Territory" },
];

export const stateName = (code: string): string =>
  STATES.find((s) => s.code === code.toUpperCase())?.name ?? code;

/**
 * Sentinel "ballot" for an electorate-less election — a provisional/upcoming comparison that ships
 * with no ballot (ballotStatus "pending"), so there is no electorate to pick. The comparison is
 * party-level only (no candidates), so the state/electorate here are cosmetic: they satisfy the
 * quiz's `hasBallot` gate and the card's selection without a real division. The card surfaces
 * "the current Parliament" rather than this label (see the card page).
 */
export const NATIONAL_BALLOT = { state: "AU", electorate: "Australia" } as const;

/** Whether an election ships no ballot (no electorates) — a party-alignment-only provisional quiz. */
export const isElectorateLess = (dataset: Dataset): boolean =>
  dataset.ballots.electorates.length === 0;

export { slugify };
