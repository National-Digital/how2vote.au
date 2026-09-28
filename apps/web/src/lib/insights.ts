/**
 * The Insights page's figures: the shape of the published `/stats/*` aggregates, and every value the
 * page derives from them. The page renders from these functions, and the iOS app is handed what
 * `insightsModel` derives, so the two show the same figures without the app working any out.
 *
 * The files are generated at build time by the data pipeline (packages/data-pipeline
 * generate-stats), StatsFile schemaVersion 3 and StatsIndex schemaVersion 2 in stats.ts.
 */
import {
  CURRENT_ELECTION_ID,
  ELECTIONS,
  electionPhase,
  isPollingDayNoticeWindow,
  type ElectionMeta,
} from "@how2vote/data-schema";
import { provenanceFor } from "$lib/manifest";

export type StatCell = { key: string; label: string; count: number };
export type StatBucket = { key: string; label: string; shown: number; cells: StatCell[] };
export type StatGeo = {
  scope: "national" | "state";
  code: string | null;
  label: string;
  buckets: StatBucket[];
};
export type PartyView = {
  kind: "party";
  id: string;
  title: string;
  dimension: string;
  sensitive: boolean;
  geos: StatGeo[];
};
export type PropositionView = {
  kind: "proposition";
  id: string;
  title: string;
  propositionId: number;
  geos: StatGeo[];
};
export type StatView = PartyView | PropositionView;
/**
 * A collection-context cohort: responses collected at one stage of the AEC timetable,
 * independently k-anonymised by the generator so switching to it can never reveal a sub-k cell.
 */
export type CohortStats = {
  key: string;
  label: string;
  disclosure: string;
  totalResponses: number;
  published: boolean;
  views: StatView[];
};
export type StatsFile = {
  schemaVersion: number;
  generatedAt: string;
  electionId: string;
  electionLabel: string;
  minCell: number;
  totalResponses: number;
  published: boolean;
  views: StatView[];
  cohorts: CohortStats[];
};
export type IndexEntry = { id: string; label: string; published: boolean; totalResponses: number };
export type StatsIndex = { schemaVersion: number; generatedAt: string; elections: IndexEntry[] };

/** The group size the lead names when no election's figures are loaded to say otherwise. */
export const DEFAULT_MIN_CELL = 10;

/**
 * Insights are closed on election day, from 00:00 until the last national poll close (8 pm AEST),
 * so live analysis isn't published while people are still voting. Keyed off each registered
 * election's fixed polling day — not the selected election, and not the `current` flag. See
 * docs/adr/0014-election-day-notice.md.
 */
export function insightsClosed(now: Date, elections: readonly ElectionMeta[] = ELECTIONS): boolean {
  return elections.some((m) => isPollingDayNoticeWindow(m, now));
}

/**
 * The windows `insightsClosed` is true in, as epoch-millisecond `[start, end)` pairs, for a screen
 * that must close without asking again: each election's polling day from 00:00 AEST to its polls'
 * close. Built from the same fields `isPollingDayNoticeWindow` reads.
 */
export function closedWindows(elections: readonly ElectionMeta[] = ELECTIONS): [number, number][] {
  return elections.flatMap((m): [number, number][] => {
    const t = m.timetable;
    if (!t) return [];
    return [[Date.parse(`${m.date}T00:00:00+10:00`), Date.parse(t.pollsCloseAt)]];
  });
}

/** An index file the page can read, or null. */
export function readIndex(file: unknown): StatsIndex | null {
  const index = file as StatsIndex | null;
  return index?.schemaVersion === 2 ? index : null;
}

/**
 * An election's stats file as the page reads it, or null for one it cannot. An older file without
 * cohorts is read as a single "all" cohort.
 */
export function readStats(file: unknown): StatsFile | null {
  const stats = file as StatsFile | null;
  if (stats?.schemaVersion !== 3) return null;
  if (!stats.cohorts || stats.cohorts.length === 0) {
    stats.cohorts = stats.published
      ? [
          {
            key: "all",
            label: "All responses",
            disclosure: "",
            totalResponses: stats.totalResponses,
            published: stats.published,
            views: stats.views,
          },
        ]
      : [];
  }
  return stats;
}

/**
 * The elections to offer: every registry election, with its index stats when present. A registry
 * election the (stale) index omits — the upcoming comparison — still shows, so it's acknowledged.
 */
export function listedElections(
  index: StatsIndex | null,
  elections: readonly ElectionMeta[] = ELECTIONS,
): IndexEntry[] {
  return elections.map(
    (m) =>
      index?.elections.find((e) => e.id === m.id) ?? {
        id: m.id,
        label: m.label,
        published: false,
        totalResponses: 0,
      },
  );
}

/**
 * The election the page opens on: one with published results, else the current one, so an as-yet
 * empty upcoming election is acknowledged rather than leaving the page blank.
 */
export function initialElection(index: StatsIndex, current: string = CURRENT_ELECTION_ID): string {
  return index.elections.find((e) => e.published)?.id ?? current;
}

/** An election's name on its button: its label without the words every label shares. */
export const electionPill = (label: string): string => label.replace(" Federal Election", "");

export const pct = (n: number, total: number): number =>
  total > 0 ? Math.round((n / total) * 100) : 0;

/** The geography shown for a party view: the one selected, else national. */
export const geoFor = (view: PartyView, code: string | null): StatGeo =>
  view.geos.find((g) => g.code === code) ?? view.geos[0]!;

/** Ordered agree/neutral/disagree cells for a proposition's overall bucket. */
export function propParts(view: PropositionView): {
  agree: number;
  neutral: number;
  disagree: number;
  shown: number;
} {
  const bucket = view.geos[0]?.buckets[0];
  const get = (k: string): number => bucket?.cells.find((c) => c.key === k)?.count ?? 0;
  return {
    agree: get("agree"),
    neutral: get("neutral"),
    disagree: get("disagree"),
    shown: bucket?.shown ?? 0,
  };
}

/** The date a stats file was generated, as the page writes it. */
export const updatedOn = (generatedAt: string): string =>
  new Date(generatedAt).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** A count as the page writes it. */
export const count = (n: number): string => n.toLocaleString("en-AU");

/** One bar of a party view's bucket: the cell's label and its share, as the page shows it. */
export type ModelCell = { label: string; pct: number };
/** A bucket, with its shown count as heard (`shown`) and as written (`shownText`). */
export type ModelBucket = {
  key: string;
  label: string;
  shown: number;
  shownText: string;
  cells: ModelCell[];
};
export type ModelGeo = {
  code: string | null;
  national: boolean;
  label: string;
  buckets: ModelBucket[];
};
export type ModelParty = { id: string; title: string; geos: ModelGeo[] };
export type ModelProposition = {
  id: string;
  title: string;
  agree: number;
  neutral: number;
  disagree: number;
  shown: number;
  shownText: string;
};
export type ModelCohort = {
  key: string;
  label: string;
  disclosure: string;
  total: string;
  published: boolean;
  parties: ModelParty[];
  propositions: ModelProposition[];
};
export type ModelElection = {
  id: string;
  /** Its name on its button. */
  pill: string;
  /** Its name in the sentence saying it has no responses yet. */
  label: string;
  published: boolean;
  upcoming: boolean;
  /** The data-provenance statement, where the election has a committed snapshot. */
  provenance: string | null;
  /** Its figures, or null when its file could not be read. */
  stats: null | {
    label: string;
    updated: string;
    minCell: number;
    published: boolean;
    cohorts: ModelCohort[];
  };
};
/**
 * What the Insights page shows, derived: every election it offers and every figure it can show
 * for each, the election it opens on, and the windows it is closed in. Null `elections` while it
 * is closed, when no figure is read at all; `failed` when the index could not be read.
 */
export type InsightsModel = {
  windows: [number, number][];
  closed: boolean;
  failed: boolean;
  initial: string;
  elections: ModelElection[] | null;
};

/**
 * The page's figures for every election, from the index and each election's file (null for one
 * that could not be read), as the page derives them for the election and cohort shown.
 */
export function insightsModel(input: {
  now: Date;
  index: StatsIndex | null;
  files: Record<string, StatsFile | null>;
  /** The registry, and each election's provenance statement: the app's own, but for a test. */
  elections?: readonly ElectionMeta[];
  provenance?: (id: string) => string | null;
}): InsightsModel {
  const {
    index,
    elections = ELECTIONS,
    provenance = (id: string) => provenanceFor(id)?.statement ?? null,
  } = input;
  const current = elections.find((e) => e.current)?.id ?? elections[0]?.id ?? CURRENT_ELECTION_ID;
  const windows = closedWindows(elections);
  if (insightsClosed(input.now, elections)) {
    return { windows, closed: true, failed: false, initial: current, elections: null };
  }
  if (!index) {
    return { windows, closed: false, failed: true, initial: current, elections: null };
  }
  const cohort = (c: CohortStats): ModelCohort => ({
    key: c.key,
    label: c.label,
    disclosure: c.disclosure,
    total: count(c.totalResponses ?? 0),
    published: c.published,
    parties: c.views
      .filter((v): v is PartyView => v.kind === "party")
      .map((view) => ({
        id: view.id,
        title: view.title,
        geos: view.geos.map((g) => ({
          code: g.code,
          national: g.scope === "national",
          label: g.code ?? g.label,
          buckets: g.buckets.map((b) => ({
            key: b.key,
            label: b.label,
            shown: b.shown,
            shownText: count(b.shown),
            cells: b.cells.map((cell) => ({ label: cell.label, pct: pct(cell.count, b.shown) })),
          })),
        })),
      })),
    propositions: c.views
      .filter((v): v is PropositionView => v.kind === "proposition")
      .map((view) => {
        const p = propParts(view);
        return {
          id: view.id,
          title: view.title,
          agree: pct(p.agree, p.shown),
          neutral: pct(p.neutral, p.shown),
          disagree: pct(p.disagree, p.shown),
          shown: p.shown,
          shownText: count(p.shown),
        };
      }),
  });
  return {
    windows,
    closed: false,
    failed: false,
    initial: initialElection(index, current),
    elections: listedElections(index, elections).map((e) => {
      const meta = elections.find((m) => m.id === e.id);
      const stats = input.files[e.id] ?? null;
      return {
        id: e.id,
        pill: electionPill(e.label),
        label: meta?.label ?? "this election",
        published: e.published,
        upcoming: meta ? electionPhase(meta) === "upcoming" : false,
        provenance: provenance(e.id),
        stats: stats && {
          label: stats.electionLabel,
          updated: updatedOn(stats.generatedAt),
          minCell: stats.minCell,
          published: stats.published,
          cohorts: stats.cohorts.map(cohort),
        },
      };
    }),
  };
}

/**
 * Reads the published files and derives the page's figures from them, for the iOS app. While the
 * page is closed for election day no file is read at all, as the page reads none; and figures read
 * as a close begins are not handed over.
 *
 * @param read - reads a stats file by name (`index`, or an election's id), or null for one missing
 */
export async function readInsights(
  read: (name: string) => Promise<unknown>,
  clock: () => Date = () => new Date(),
): Promise<InsightsModel> {
  const closedNow = (): InsightsModel | null => {
    const now = clock();
    return insightsClosed(now) ? insightsModel({ now, index: null, files: {} }) : null;
  };
  const before = closedNow();
  if (before) return before;
  const index = readIndex(await read("index"));
  const files: Record<string, StatsFile | null> = {};
  if (index) {
    for (const e of listedElections(index)) files[e.id] = readStats(await read(e.id));
  }
  return closedNow() ?? insightsModel({ now: clock(), index, files });
}
