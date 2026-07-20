import { createHash } from "node:crypto";
import { activeQuestions, type Dataset } from "@how2vote/data-schema";

/**
 * Aggregation and disclosure control for the public research dashboards (ADR-0004, ADR-0007).
 * This module is pure and deterministic: it takes the aggregate COUNTER rows (the only thing the
 * research store holds — no per-person rows exist; see docs/research/analysis-plan.md) and the
 * compiled dataset and returns the suppressed, publish-safe stats bundle. Internals are sums over
 * counts, never per-person scoring: the top-party match and stances were derived on the
 * contributor's device at ingestion, and every counter row arrives already keyed by its
 * collection-context cohort, classified server-side.
 *
 * Disclosure model — cell suppression with a single minimum group size (k-anonymity):
 *   - PRIMARY k-suppression happens at the DATABASE/VIEW layer, not here: the generator reads only
 *     the `v_public_*` views (apps/web/migrations/0001_research.sql), each of which applies
 *     `HAVING SUM(n) >= k`, so a cell below k can never leave the database. The `count >= minCell`
 *     filter in `suppressBucket` below is defence-in-depth over already-gated input; it is NOT the
 *     authoritative gate. `MIN_CELL` here MUST equal the views' HAVING threshold — the two are pinned
 *     together by scripts/check-public-stat-release.mjs (fail-closed on drift).
 *   - The SAME threshold applies to every dimension: an aggregate of at least k people is treated as
 *     safe, so no dimension needs a special-case number. Every demographic dimension is publishable.
 *   - A bucket's published denominator (`shown`) is the sum of its *surviving* cells, NEVER the true
 *     total, so a suppressed cell cannot be recovered by subtracting the visible cells from a total.
 *   - COMPLEMENTARY suppression defeats differencing between the national marginal and its per-state
 *     interiors: for a (dimension, bucket, party) series whose national marginal is published, the
 *     per-state cells are published ONLY when the published states fully reconstruct that marginal
 *     (nothing hidden). If any hidden mass remains — a sub-k state that the view dropped, or the
 *     unknown-state ('') contribution — every per-state cell in the series is suppressed too, so the
 *     remainder can never be isolated by `marginal − Σ published states`. See
 *     `complementaryStateSuppression`.
 *   - A bucket is dropped entirely if no cell survives; a geography (state) is dropped if no bucket
 *     survives; a cohort publishes nothing until its own responses clear `dashboardMin`.
 *   - Cohorts are a strict partition and are NEVER combined into a published cell-view when more than
 *     one is present (differencing protection — see buildStats).
 *
 * Only one demographic dimension is crossed per view — never a multi-way crosstab. Party views also
 * roll up by geography (national + per-state where cells clear and survive complementary
 * suppression) — except the sensitive dimensions, collected national-only and never given a state
 * figure. The set of views is a fixed allowlist, not an arbitrary pivot surface, and the set of
 * published DB views is itself allowlisted (check-public-stat-release.mjs).
 */

/** The one k-anonymity threshold: an aggregate of at least this many people is publishable. MUST
 *  equal the `HAVING SUM(n) >= k` threshold baked into every v_public_* view in
 *  apps/web/migrations/0001_research.sql (pinned by check-public-stat-release.mjs). */
export const MIN_CELL = 10;

/**
 * Human-readable record of the disclosure rules applied to every published release, embedded in each
 * stats file's `release` block (and thereby bound into the deploy's release manifest via
 * publicStatsHash). Auditors read the applied rules straight from the file they were applied to.
 */
export const SUPPRESSION_RULES: readonly string[] = [
  "k-anonymity: cells with fewer than k contributors are suppressed at the database view layer (HAVING SUM(n) >= k), never by post-hoc filtering",
  "no true bucket total is emitted — a bucket's shown value is the sum of its surviving cells only",
  "complementary suppression: per-state cells are dropped for any (dimension, bucket, party) series whose national marginal is not fully reconstructed by the published states, defeating differencing",
  "per-cohort partition: collection-context cohorts are suppressed independently and never combined into a published cell-view",
  "sensitive dimensions are published national-only, with no sub-national geography",
  "only party keys present in the compiled dataset are ever published",
];
/** A dashboard stays hidden until at least this many responses exist, to avoid a near-empty board. */
export const DASHBOARD_MIN = 50;

/** AU state/territory codes → display names, for the geographic roll-up labels. */
const STATE_LABELS: Record<string, string> = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  SA: "South Australia",
  WA: "Western Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
};
const STATE_ORDER = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

/**
 * The counter rows buildStats consumes. These come from the k-gated `v_public_*` views, NOT the raw
 * counter tables (see generate-stats.ts and migration 0006): every cell here has already cleared the
 * DB-layer `HAVING SUM(n) >= k` primary suppression, so buildStats never sees a sub-k cell. Each row
 * carries the collection-context cohort it was tallied under.
 */
export type CounterRows = {
  /** `v_public_response_total`: scored contributions per (cohort, state). The denominators (not a
   *  disclosive cross-tab; summed to a per-cohort total for the dashboard-visibility gate). */
  responseTotals: { cohort: string; stateCode: string | null; responses: number }[];
  /** `v_public_demographic_national`: party match × one dimension × bucket, summed across ALL states
   *  (incl. the unknown-state and national-only sensitive rows) and k-gated. The national marginal. */
  demographicsNational: {
    cohort: string;
    dimension: string;
    bucket: string;
    party: string;
    n: number;
  }[];
  /** `v_public_demographic_state`: the same cross-tab keyed by a real state, k-gated. Non-sensitive
   *  dimensions only (sensitive dimensions are stored state_code='' and excluded by the view). */
  demographicsState: {
    cohort: string;
    stateCode: string;
    dimension: string;
    bucket: string;
    party: string;
    n: number;
  }[];
  /** `v_public_proposition_national`: client-derived stance tallies per (cohort, proposition), k-gated. */
  propositions: { cohort: string; propositionId: number; stance: string; n: number }[];
};

/** A published cell. `key` is a party key (party views) or an answer category (proposition views). */
export type StatCell = { key: string; label: string; count: number };
/** A published group within a view: a demographic value, "Overall", or similar. */
export type StatBucket = { key: string; label: string; shown: number; cells: StatCell[] };
/** A reporting geography: national, or a single state. */
export type StatGeo = {
  scope: "national" | "state";
  code: string | null;
  label: string;
  buckets: StatBucket[];
};

/** Top-party-match crossed against one demographic dimension, rolled up national + per-state. */
export type PartyStatView = {
  kind: "party";
  id: string;
  title: string;
  dimension: string;
  geos: StatGeo[];
};
/** Answer distribution (agree / neutral / disagree) for a single proposition, national. */
export type PropositionStatView = {
  kind: "proposition";
  id: string;
  title: string;
  propositionId: number;
  geos: StatGeo[];
};
export type StatView = PartyStatView | PropositionStatView;

/**
 * The collection-context cohorts a dashboard can be filtered to. Mirrors
 * the cohort key on every counter row (see functions/api/research.ts and `@how2vote/data-schema`
 * `electionStage`), plus `"all"` reserved for the single-cohort mirror. Cohorts must never be
 * silently combined.
 *
 * CRITICAL: each cohort's aggregates are built by running the SAME suppression pipeline over ONLY
 * that cohort's counter rows — and because the counters themselves are keyed by cohort at
 * ingestion, a cell shown for one cohort has ≥ `minCell` responses IN THAT COHORT by construction,
 * and a cohort board appears only with ≥ `dashboardMin` responses in it. Filtering can therefore
 * never expose a sub-k cell that only clears the threshold once cohorts are combined.
 */
export type CohortKey =
  "all" | "pre-declaration" | "live" | "post-election" | "historical" | "unknown";

export type CohortStats = {
  key: CohortKey;
  label: string;
  /** Plain-language statement of what this cohort is (and, for "all", that it mixes collection times). */
  disclosure: string;
  totalResponses: number;
  published: boolean;
  views: StatView[];
};

/**
 * The immutable release record embedded in every published stats file. It states the k applied, the
 * disclosure rules, a content-addressed release id, and the release date. The whole stats file is
 * hashed into the deploy's release manifest (publicStatsHash), so any tampering with these fields (or
 * the data) is detectable at deploy (scripts/check-release-manifest.mjs).
 */
export type StatRelease = {
  /** Content-addressed, immutable id: `rel-<electionId>-<16 hex of the payload digest>`. */
  releaseId: string;
  /** The k-anonymity threshold applied (mirrors `minCell`), stated explicitly for auditors. */
  k: number;
  /** The disclosure rules applied to this release (see SUPPRESSION_RULES). */
  suppressionRules: readonly string[];
  /** Release date (YYYY-MM-DD, from generatedAt). */
  date: string;
};

export type StatsFile = {
  schemaVersion: 3;
  generatedAt: string;
  electionId: string;
  electionLabel: string;
  minCell: number;
  /** Immutable, hashable disclosure-control provenance for this release. */
  release: StatRelease;
  /** Total scored contributions across all cohorts. */
  totalResponses: number;
  /** False when no cohort clears `dashboardMin`; the UI shows a "not enough yet" state. */
  published: boolean;
  /** The combined ("all" cohort) views, kept at top level for back-compat and the Dataset metadata. */
  views: StatView[];
  /**
   * Per-collection-context cohorts, each independently k-anonymised. One entry per context that
   * has any responses. The insights page renders one cohort at a time with its disclosure.
   */
  cohorts: CohortStats[];
};

/** The lightweight index the insights page reads first, to know which elections have data. */
export type StatsIndexEntry = {
  id: string;
  label: string;
  published: boolean;
  totalResponses: number;
};
export type StatsIndex = {
  schemaVersion: 2;
  generatedAt: string;
  elections: StatsIndexEntry[];
};

/**
 * The publishable party breakdowns — one per demographic dimension the survey collects. Each crosses
 * the top party match against ONE dimension (never a multi-way crosstab). `buckets` fixes display
 * order and mirrors the option order of SURVEY in the web app (src/lib/survey.ts) — keep the two in
 * step. Every dimension is published; identity is protected solely by the single k-anonymity
 * threshold (`MIN_CELL`), consistent with the privacy policy.
 */
const PARTY_VIEWS: { id: string; title: string; dimension: string; buckets: string[] }[] = [
  // — About you —
  {
    id: "top-party-by-age",
    title: "Top party match by age group",
    dimension: "age",
    buckets: ["18–24", "25–34", "35–44", "45–54", "55–64", "65–74", "75+"],
  },
  {
    id: "top-party-by-gender",
    title: "Top party match by gender",
    dimension: "gender",
    buckets: ["Man or male", "Woman or female", "Non-binary", "I use a different term"],
  },
  {
    id: "top-party-by-education",
    title: "Top party match by education",
    dimension: "education",
    buckets: [
      "Year 11 or below",
      "Year 12",
      "Certificate (incl. trade)",
      "Diploma or advanced diploma",
      "Bachelor degree",
      "Postgraduate degree",
    ],
  },
  {
    id: "top-party-by-work",
    title: "Top party match by work situation",
    dimension: "work",
    buckets: [
      "Working full-time",
      "Working part-time or casual",
      "Unemployed, looking for work",
      "Retired",
      "Studying, not working",
      "Home duties, caring or other",
    ],
  },
  {
    id: "top-party-by-union",
    title: "Top party match by union membership",
    dimension: "union_member",
    buckets: ["Yes", "No"],
  },
  // — Your household —
  {
    id: "top-party-by-household-size",
    title: "Top party match by household size",
    dimension: "household_size",
    buckets: ["1", "2", "3", "4", "5 or more"],
  },
  {
    id: "top-party-by-children",
    title: "Top party match by children under 18 at home",
    dimension: "children",
    buckets: ["Yes", "No"],
  },
  {
    id: "top-party-by-tenure",
    title: "Top party match by housing tenure",
    dimension: "tenure",
    buckets: ["Owned outright", "Owned with a mortgage", "Rented", "Other arrangement"],
  },
  {
    id: "top-party-by-income",
    title: "Top party match by household income",
    dimension: "income",
    buckets: [
      "Under $52,000",
      "$52,000–$104,000",
      "$104,000–$156,000",
      "$156,000–$208,000",
      "Over $208,000",
    ],
  },
  {
    id: "top-party-by-finances",
    title: "Top party match by household finances vs a year ago",
    dimension: "financial",
    buckets: ["Better off", "About the same", "Worse off"],
  },
  // — Background and identity —
  {
    id: "top-party-by-birthplace",
    title: "Top party match by country of birth",
    dimension: "birthplace",
    buckets: ["Australia", "Overseas, mainly English-speaking country", "Overseas, other country"],
  },
  {
    id: "top-party-by-language",
    title: "Top party match by language other than English at home",
    dimension: "language",
    buckets: ["Yes", "No"],
  },
  {
    id: "top-party-by-indigenous",
    title: "Top party match by Aboriginal or Torres Strait Islander origin",
    dimension: "indigenous",
    buckets: ["No", "Yes, Aboriginal", "Yes, Torres Strait Islander", "Yes, both"],
  },
  {
    id: "top-party-by-religion",
    title: "Top party match by religion",
    dimension: "religion",
    buckets: ["No religion", "Christian", "Muslim", "Hindu", "Buddhist", "Sikh", "Other religion"],
  },
  {
    id: "top-party-by-attendance",
    title: "Top party match by religious service attendance",
    dimension: "attendance",
    buckets: ["Never", "Rarely", "A few times a year", "Monthly or more", "Weekly or more"],
  },
  {
    id: "top-party-by-orientation",
    title: "Top party match by sexual orientation",
    dimension: "orientation",
    buckets: ["Straight (heterosexual)", "Gay or lesbian", "Bisexual", "I use a different term"],
  },
  // — Politics —
  {
    id: "top-party-by-left-right",
    title: "Top party match by left–right self-placement",
    dimension: "politics_scale",
    buckets: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  },
  {
    id: "top-party-by-party-id",
    title: "Top party match by party identification",
    dimension: "party_id",
    buckets: [
      "Labor",
      "Liberal/National Coalition",
      "Greens",
      "One Nation",
      "Independent or other",
      "Another party",
      "No party",
    ],
  },
  {
    id: "top-party-by-past-vote",
    title: "Top party match by past federal vote",
    dimension: "past_vote",
    buckets: [
      "Labor",
      "Liberal/National Coalition",
      "Greens",
      "One Nation",
      "Independent or other",
      "Didn't vote",
      "Couldn't vote",
    ],
  },
  {
    id: "top-party-by-vote-intention",
    title: "Top party match by current vote intention",
    dimension: "vote_intention",
    buckets: [
      "Labor",
      "Liberal/National Coalition",
      "Greens",
      "One Nation",
      "Independent or other",
      "Undecided",
    ],
  },
];

/** Stance categories for proposition views, as derived on device (survey.ts `stanceOf`):
 *  points 4/5 → agree, 3 → neutral, 1/2 → disagree; skips never reach the counters. */
const STANCE_CATEGORIES: { key: string; label: string }[] = [
  { key: "agree", label: "Agree" },
  { key: "neutral", label: "Neutral" },
  { key: "disagree", label: "Disagree" },
];

/**
 * Dimensions stored national-only under the analysis plan's key rule (sensitive information —
 * keep in step with SENSITIVE_DIMENSIONS in apps/web/src/lib/survey.ts). The store never holds a
 * state-keyed row for these; this set is defence in depth so a view for them never even looks.
 */
const SENSITIVE_DIMENSIONS: ReadonlySet<string> = new Set([
  "union_member",
  "birthplace",
  "language",
  "indigenous",
  "religion",
  "attendance",
  "orientation",
  "politics_scale",
  "party_id",
  "past_vote",
  "vote_intention",
  "vote_next",
]);

/** Cohort ordering + presentation. `disclosure` takes the election year label for a full sentence. */
const COHORT_META: {
  key: Exclude<CohortKey, "all">;
  label: string;
  disclosure: (year: string) => string;
}[] = [
  {
    key: "live",
    label: "During the election",
    disclosure: (y) => `Collected during the ${y} federal election period.`,
  },
  {
    key: "post-election",
    label: "Shortly after",
    disclosure: (y) =>
      `Collected shortly after the ${y} federal election, before the writs were returned.`,
  },
  {
    key: "historical",
    label: "Retrospective",
    disclosure: (y) =>
      `Collected materially after the ${y} federal election — views expressed later about a past election, not opinion at the time of that election.`,
  },
  {
    key: "pre-declaration",
    label: "Before nominations",
    disclosure: (y) => `Collected before nominations were declared for the ${y} federal election.`,
  },
  {
    key: "unknown",
    label: "Timing unknown",
    disclosure: () =>
      `Collection timing could not be reliably determined; excluded from time-based comparison.`,
  },
];

const VALID_COHORTS = new Set(COHORT_META.map((c) => c.key));

/** Normalise a stored cohort key; anything absent/unrecognised becomes "unknown". */
function cohortOf(context: string | null | undefined): Exclude<CohortKey, "all"> {
  return context && VALID_COHORTS.has(context as Exclude<CohortKey, "all">)
    ? (context as Exclude<CohortKey, "all">)
    : "unknown";
}

/**
 * Suppress a set of raw counts into published cells. Cells below `minCell` are dropped entirely
 * (absence, never a `"<n"` placeholder). `shown` is the sum of the surviving cells — never the true
 * total — so the suppressed remainder is unrecoverable. Returns null when nothing survives, so the
 * caller can drop the whole bucket.
 */
function suppressBucket(
  key: string,
  label: string,
  counts: Map<string, number>,
  order: string[],
  labeller: (k: string) => string,
  minCell: number,
): StatBucket | null {
  const cells: StatCell[] = [...counts.entries()]
    .filter(([, count]) => count >= minCell)
    .map(([k, count]) => ({ key: k, label: labeller(k), count }))
    .sort((a, b) => {
      const byOrder = order.indexOf(a.key) - order.indexOf(b.key);
      return b.count - a.count || byOrder || a.key.localeCompare(b.key);
    });
  if (cells.length === 0) return null;
  const shown = cells.reduce((sum, c) => sum + c.count, 0);
  return { key, label, shown, cells };
}

/** A demographic counter row without a geography key (national marginal or one state's slice). */
type DimCountRow = { dimension: string; bucket: string; party: string; n: number };

/**
 * Build the demographic buckets of a party view from a slice of (already k-gated) counter rows.
 * `skipSeries`, when given, drops any (bucket, party) cell whose key is present — used to apply
 * complementary suppression to the per-state geographies.
 */
function partyBuckets(
  rows: DimCountRow[],
  dimension: string,
  bucketKeys: string[],
  partyOrder: string[],
  partyLabel: (k: string) => string,
  minCell: number,
  skipSeries?: ReadonlySet<string>,
): StatBucket[] {
  const buckets: StatBucket[] = [];
  for (const bucketKey of bucketKeys) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.dimension !== dimension || r.bucket !== bucketKey) continue;
      if (skipSeries?.has(seriesKey(bucketKey, r.party))) continue;
      counts.set(r.party, (counts.get(r.party) ?? 0) + r.n);
    }
    const bucket = suppressBucket(bucketKey, bucketKey, counts, partyOrder, partyLabel, minCell);
    if (bucket) buckets.push(bucket);
  }
  return buckets;
}

/** Stable key for one (bucket, party) series across geographies. */
const seriesKey = (bucket: string, party: string): string => `${bucket} ${party}`;

/**
 * Complementary suppression for ONE (dimension, bucket, party) series across the geography
 * hierarchy — the defence against a differencing attack that recovers a suppressed state cell as
 * `national marginal − Σ published states`.
 *
 * Given the national marginal (already k-gated; null if it did not itself clear k) and the per-state
 * cells that survived primary k-suppression, it returns the state cells that may still be published:
 *   - the marginal is fully reconstructed by the published states (nothing hidden) → publish them all;
 *   - otherwise hidden mass remains — a sub-k state the view dropped, or the unknown-state ('')
 *     contribution folded into the marginal — and `marginal − Σ published` would isolate it, so ALL
 *     per-state cells in the series are suppressed (the complementary cells go too).
 *
 * A state cell cannot clear k unless its marginal does (the marginal sums it), so a non-null-marginal
 * with published states is the only meaningful case; a null marginal alongside published states is an
 * inconsistency and fails closed (everything suppressed).
 */
export function complementaryStateSuppression<T extends { count: number }>(
  nationalMarginal: number | null,
  stateCells: readonly T[],
): T[] {
  if (stateCells.length === 0) return [];
  if (nationalMarginal === null) return [];
  const sum = stateCells.reduce((acc, c) => acc + c.count, 0);
  return sum === nationalMarginal ? [...stateCells] : [];
}

export type BuildStatsOptions = {
  generatedAt: string;
  electionId: string;
  electionLabel?: string;
  /** The election's calendar year (ElectionMeta.year), used for the disclosure sentence. The
   *  election id is NOT a year (it only coincidentally equals one for the current datasets). */
  electionYear?: number;
  minCell?: number;
  dashboardMin?: number;
};

export function buildStats(
  counters: CounterRows,
  dataset: Dataset,
  opts: BuildStatsOptions,
): StatsFile {
  const minCell = opts.minCell ?? MIN_CELL;
  const dashboardMin = opts.dashboardMin ?? DASHBOARD_MIN;

  const partyLabelMap = new Map<string, string>(
    dataset.parties.parties.map((p) => [p.key, p.displayName]),
  );
  const partyLabel = (k: string): string => partyLabelMap.get(k) ?? k;
  const partyOrder = dataset.parties.parties.map((p) => p.key);

  const stanceOrder = STANCE_CATEGORIES.map((c) => c.key);
  const stanceLabel = (k: string): string => STANCE_CATEGORIES.find((c) => c.key === k)?.label ?? k;

  // Party keys are shape-checked but not dataset-checked at ingestion (the Function has no
  // dataset), so a hostile client can create counter rows under an arbitrary slug. Nothing that
  // isn't a party in the compiled dataset is ever published, whatever its count.
  const nationalRows = counters.demographicsNational
    .filter((r) => partyLabelMap.has(r.party))
    .map((r) => ({ ...r, cohort: cohortOf(r.cohort) }));
  const stateRows = counters.demographicsState
    .filter((r) => partyLabelMap.has(r.party))
    .map((r) => ({ ...r, cohort: cohortOf(r.cohort) }));
  const responseTotals = counters.responseTotals.map((r) => ({
    ...r,
    cohort: cohortOf(r.cohort),
  }));
  const propositionRows = counters.propositions.map((r) => ({
    ...r,
    cohort: cohortOf(r.cohort),
  }));

  /**
   * Build the published views over ONE cohort's counter rows, applying the full suppression
   * pipeline (per-cell `minCell`, per-board `dashboardMin`). Because the counters are keyed by
   * cohort at ingestion, a cohort's numbers are inherently suppressed against that cohort's own
   * counts and can never leak a sub-k cell.
   */
  const viewsFor = (
    cohort: Exclude<CohortKey, "all">,
  ): { views: StatView[]; total: number; published: boolean } => {
    const total = responseTotals
      .filter((r) => r.cohort === cohort)
      .reduce((sum, r) => sum + r.responses, 0);
    if (total < dashboardMin) return { views: [], total, published: false };

    const cohortNational = nationalRows.filter((r) => r.cohort === cohort);
    const cohortState = stateRows.filter((r) => r.cohort === cohort);
    const presentStates = STATE_ORDER.filter((code) =>
      cohortState.some((r) => r.stateCode === code),
    );

    const partyViews: PartyStatView[] = PARTY_VIEWS.map((view): PartyStatView => {
      const geos: StatGeo[] = [];
      // National marginal — the DB view already summed across all states (incl. the unknown-state
      // and national-only sensitive rows) and gated at k, so these are published as-is.
      const dimNational = cohortNational.filter((r) => r.dimension === view.dimension);
      const national = partyBuckets(
        dimNational,
        view.dimension,
        view.buckets,
        partyOrder,
        partyLabel,
        minCell,
      );
      if (national.length > 0)
        geos.push({ scope: "national", code: null, label: "Australia", buckets: national });

      // Sensitive dimensions are stored national-only (analysis-plan key rule); no state roll-up
      // exists for them, and none is ever computed.
      if (!SENSITIVE_DIMENSIONS.has(view.dimension)) {
        const dimState = cohortState.filter((r) => r.dimension === view.dimension);

        // COMPLEMENTARY SUPPRESSION across the geography hierarchy: decide, per (bucket, party)
        // series, whether the published states may stand. If they do not fully reconstruct the
        // national marginal, the whole series' per-state cells are suppressed so a hidden remainder
        // cannot be differenced out (complementaryStateSuppression).
        const marginalOf = new Map<string, number>(); // seriesKey → national marginal
        for (const r of dimNational)
          marginalOf.set(
            seriesKey(r.bucket, r.party),
            (marginalOf.get(seriesKey(r.bucket, r.party)) ?? 0) + r.n,
          );
        const seriesStateCells = new Map<string, { stateCode: string; count: number }[]>();
        for (const r of dimState) {
          const key = seriesKey(r.bucket, r.party);
          const list = seriesStateCells.get(key) ?? [];
          list.push({ stateCode: r.stateCode, count: r.n });
          seriesStateCells.set(key, list);
        }
        const suppressedSeries = new Set<string>();
        for (const [key, cells] of seriesStateCells) {
          const kept = complementaryStateSuppression(marginalOf.get(key) ?? null, cells);
          if (kept.length === 0) suppressedSeries.add(key);
        }

        for (const code of presentStates) {
          const inState = dimState.filter((r) => r.stateCode === code);
          const buckets = partyBuckets(
            inState,
            view.dimension,
            view.buckets,
            partyOrder,
            partyLabel,
            minCell,
            suppressedSeries,
          );
          if (buckets.length > 0) {
            geos.push({ scope: "state", code, label: STATE_LABELS[code] ?? code, buckets });
          }
        }
      }
      return { kind: "party", id: view.id, title: view.title, dimension: view.dimension, geos };
    }).filter((v) => v.geos.length > 0);

    // Proposition views: national stance distribution per proposition, straight from the stance
    // counters. Demographic × proposition crosses are not collected, so they cannot be published.
    // Withdrawn questions are disabled outputs (ADR 0008) and are not published.
    const propositionViews: PropositionStatView[] = [];
    for (const q of activeQuestions(dataset.questions)) {
      const counts = new Map<string, number>();
      for (const r of propositionRows) {
        if (r.cohort !== cohort || r.propositionId !== q.id) continue;
        counts.set(r.stance, (counts.get(r.stance) ?? 0) + r.n);
      }
      const bucket = suppressBucket(
        "overall",
        "Overall",
        counts,
        stanceOrder,
        stanceLabel,
        minCell,
      );
      if (!bucket) continue;
      propositionViews.push({
        kind: "proposition",
        id: `proposition-${q.id}`,
        title: q.text,
        propositionId: q.id,
        geos: [{ scope: "national", code: null, label: "Australia", buckets: [bucket] }],
      });
    }

    return { views: [...partyViews, ...propositionViews], total, published: true };
  };

  const total = responseTotals.reduce((sum, r) => sum + r.responses, 0);
  const year = opts.electionYear !== undefined ? String(opts.electionYear) : opts.electionId;

  // One cohort per collection context actually present, each suppressed over its OWN counters.
  //
  // There is deliberately NO combined "all" cohort. Publishing a combined cell-view alongside the
  // per-cohort cell-views would let an attacker recover a suppressed cohort's sub-k cell by
  // DIFFERENCING (the cohorts are a strict partition, so `all − Σ other cohorts` reconstructs the
  // remaining one, including cells suppressed within it). Showing cohorts only, separately, both
  // closes that hole and keeps cohorts analysed separately. Contexts follow
  // COHORT_META order.
  const presentCohorts = new Set([
    ...responseTotals.map((r) => r.cohort),
    ...propositionRows.map((r) => r.cohort),
  ]);
  const cohorts: CohortStats[] = COHORT_META.filter((m) => presentCohorts.has(m.key)).map((m) => {
    const built = viewsFor(m.key);
    return {
      key: m.key,
      label: m.label,
      disclosure: m.disclosure(year),
      totalResponses: built.total,
      published: built.published,
      views: built.views,
    };
  });

  // Top-level views mirror the sole cohort when there is exactly one (no differencing risk — nothing
  // to difference against). With more than one cohort we publish NO combined cell-view, only the
  // per-cohort ones. The bare total is not attribute data, so it is safe to surface.
  const views = cohorts.length === 1 ? cohorts[0]!.views : [];

  // Content-addressed release id over the disclosive payload (cohorts + top-level views), so the id
  // is immutable per published content and changes only when the data does. The whole file is hashed
  // into the deploy's release manifest (publicStatsHash), making tampering detectable end-to-end.
  const payloadDigest = createHash("sha256")
    .update(JSON.stringify({ electionId: opts.electionId, minCell, views, cohorts }))
    .digest("hex");

  return {
    schemaVersion: 3,
    generatedAt: opts.generatedAt,
    electionId: opts.electionId,
    electionLabel: opts.electionLabel ?? opts.electionId,
    minCell,
    release: {
      releaseId: `rel-${opts.electionId}-${payloadDigest.slice(0, 16)}`,
      k: minCell,
      suppressionRules: SUPPRESSION_RULES,
      date: opts.generatedAt.slice(0, 10),
    },
    totalResponses: total,
    published: cohorts.some((c) => c.published),
    views,
    cohorts,
  };
}
