<script lang="ts">
  import { goto } from "$app/navigation";
  import {
    CURRENT_ELECTION_ID,
    ELECTIONS,
    electionById,
    electionPhase,
    isPollingDayNoticeWindow,
  } from "@how2vote/data-schema";
  import Meta from "$lib/components/Meta.svelte";
  import InsightsClosed from "$lib/components/InsightsClosed.svelte";
  import ProvenanceNotice from "$lib/components/ProvenanceNotice.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { now } from "$lib/now.svelte";
  import { insightsDatasetGraph, serializeJsonLd } from "$lib/structured-data";

  // schema.org Dataset for the published survey aggregates — emitted in the prerendered HTML (not
  // gated on the client-side fetch below) so crawlers and Google Dataset Search see it. Built and
  // escaped in $lib/structured-data.
  const datasetJsonLd = serializeJsonLd(insightsDatasetGraph());

  // Shape of the static /stats/* assets, generated at build time by the data pipeline
  // (packages/data-pipeline generate-stats). Defined locally because it is the shape of fetched
  // assets, not a runtime module import. Mirrors StatsFile (schemaVersion 3) / StatsIndex
  // (schemaVersion 2) in stats.ts.
  type StatCell = { key: string; label: string; count: number };
  type StatBucket = { key: string; label: string; shown: number; cells: StatCell[] };
  type StatGeo = {
    scope: "national" | "state";
    code: string | null;
    label: string;
    buckets: StatBucket[];
  };
  type PartyView = {
    kind: "party";
    id: string;
    title: string;
    dimension: string;
    sensitive: boolean;
    geos: StatGeo[];
  };
  type PropositionView = {
    kind: "proposition";
    id: string;
    title: string;
    propositionId: number;
    geos: StatGeo[];
  };
  type StatView = PartyView | PropositionView;
  // A collection-context cohort: responses collected at one stage of the AEC timetable,
  // independently k-anonymised by the generator so switching to it can never reveal a sub-k cell.
  type CohortStats = {
    key: string;
    label: string;
    disclosure: string;
    totalResponses: number;
    published: boolean;
    views: StatView[];
  };
  type StatsFile = {
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
  type IndexEntry = { id: string; label: string; published: boolean; totalResponses: number };
  type StatsIndex = { schemaVersion: number; generatedAt: string; elections: IndexEntry[] };

  let index = $state<StatsIndex | null>(null);
  let stats = $state<StatsFile | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let selectedId = $state<string>("");
  // The selected collection-context cohort key (e.g. "all", "historical").
  let selectedCohort = $state<string>("");
  // Per party-view selected geography code; null / absent = national.
  let geoByView = $state<Record<string, string | null>>({});

  // Pills to offer: every registry election, with its index stats when present. A registry election
  // the (stale) index omits — e.g. the upcoming "next" comparison — still shows, so it's acknowledged.
  const listed = $derived(
    ELECTIONS.map(
      (m) =>
        index?.elections.find((e) => e.id === m.id) ?? {
          id: m.id,
          label: m.label,
          published: false,
          totalResponses: 0,
        },
    ),
  );
  const selectedMeta = $derived(selectedId ? electionById(selectedId) : undefined);
  const selectedUpcoming = $derived(
    selectedMeta ? electionPhase(selectedMeta) === "upcoming" : false,
  );
  const selectedLabel = $derived(selectedMeta?.label ?? "this election");
  const cohorts = $derived<CohortStats[]>(stats?.cohorts ?? []);
  // The cohort currently shown — the selected one, else the first emitted cohort. The generator
  // emits per-context cohorts in a fixed order and never a combined "all" cohort. All views/totals
  // below read from THIS cohort only.
  const activeCohort = $derived<CohortStats | null>(
    cohorts.find((c) => c.key === selectedCohort) ?? cohorts[0] ?? null,
  );
  const partyViews = $derived(
    (activeCohort?.views.filter((v): v is PartyView => v.kind === "party") ?? []) as PartyView[],
  );
  const propositionViews = $derived(
    (activeCohort?.views.filter((v): v is PropositionView => v.kind === "proposition") ??
      []) as PropositionView[],
  );

  // Insights are closed on election day, from 00:00 until the last national poll close (8 pm AEST),
  // so live analysis isn't published while people are still voting. Keyed off the ticking `now` vs
  // each registered election's fixed polling day — not the toggled-to view, and not the `current`
  // flag (which is now an as-yet-undated upcoming placeholder with no polling day). A past election's
  // window is always in the past, so only a genuinely live polling day can match; a tab left open
  // flips at the boundary without a reload. See docs/adr/0014-election-day-notice.md.
  const closed = $derived(ELECTIONS.some((m) => isPollingDayNoticeWindow(m, now.current)));

  async function loadIndex(): Promise<void> {
    try {
      const res = await fetch("/stats/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("index unavailable");
      const file = (await res.json()) as StatsIndex;
      if (file.schemaVersion !== 2) throw new Error("unknown stats schema");
      index = file;
      // Prefer an election with published results; otherwise open on the current one so an
      // as-yet-empty upcoming election is acknowledged rather than leaving the page blank.
      const first = file.elections.find((e) => e.published);
      await selectElection(first ? first.id : CURRENT_ELECTION_ID);
    } catch {
      failed = true;
      loading = false;
    }
  }

  // Load only while the page is open. When closed we make no /stats request at all, so the withheld
  // aggregates never reach the browser. `now.start()` is idempotent; the effect re-runs as the clock
  // ticks, so crossing 8 pm (window → open) kicks the first load then.
  let requested = false;
  $effect(() => {
    now.start();
    if (closed) {
      loading = false;
      return;
    }
    if (requested) return;
    requested = true;
    void loadIndex();
  });

  async function selectElection(id: string): Promise<void> {
    if (id === selectedId && stats) return;
    selectedId = id;
    loading = true;
    stats = null;
    geoByView = {};
    try {
      const res = await fetch(`/stats/${id}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error("election stats unavailable");
      const file = (await res.json()) as StatsFile;
      if (file.schemaVersion !== 3) throw new Error("unknown stats schema");
      // Defensive: an older file without cohorts is treated as a single "all" cohort.
      if (!file.cohorts || file.cohorts.length === 0) {
        file.cohorts = file.published
          ? [
              {
                key: "all",
                label: "All responses",
                disclosure: "",
                totalResponses: file.totalResponses,
                published: file.published,
                views: file.views,
              },
            ]
          : [];
      }
      stats = file;
      selectedCohort = file.cohorts[0]?.key ?? "all";
    } catch {
      stats = null; // fall through to the per-election "not enough yet" state
    } finally {
      loading = false;
    }
  }

  const updated = $derived(
    stats
      ? new Date(stats.generatedAt).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "",
  );

  const pct = (n: number, total: number): number => (total > 0 ? Math.round((n / total) * 100) : 0);

  /** The geography currently shown for a party view (selected state, else national). */
  const geoFor = (view: PartyView): StatGeo =>
    view.geos.find((g) => g.code === (geoByView[view.id] ?? null)) ?? view.geos[0];

  /** Ordered agree/neutral/disagree cells for a proposition's overall bucket. */
  function propParts(view: PropositionView): {
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
</script>

<Meta />

<svelte:head>
  {@html `<script type="application/ld+json">${datasetJsonLd}</script>`}
</svelte:head>

<TopBar label="Insights" onback={() => goto("/")} backLabel="Back to start" />

<article class="insights">
  <h1>What the numbers say</h1>
  {#if closed}
    <InsightsClosed />
  {:else}
    <p class="lead">
      These figures come from the optional survey people answer after building a comparison.
      Everything here is aggregate only, and descriptive — never a prediction. A figure is shown
      only when its group is large enough that a single response cannot be singled out (at least {stats?.minCell ??
        10} responses); smaller groups are withheld entirely. You can filter by when responses were collected,
      and groups are never combined across those periods without saying so. See
      <a href="/research">how these figures are made</a> and
      <a href="/privacy">how we handle survey data</a>.
    </p>

    {#if index && listed.length > 1}
      <div class="elections" role="group" aria-label="Choose an election">
        {#each listed as e (e.id)}
          <button
            type="button"
            class="pill"
            class:active={e.id === selectedId}
            class:awaiting={!e.published}
            aria-pressed={e.id === selectedId}
            onclick={() => selectElection(e.id)}
          >
            {e.label.replace(" Federal Election", "")}
          </button>
        {/each}
      </div>
    {/if}

    {#if failed}
      <p class="empty">Insights aren't available right now. Please try again later.</p>
    {:else if loading && !stats}
      <p class="empty">Loading…</p>
    {:else if stats && stats.published}
      {#if selectedId}
        <ProvenanceNotice electionId={selectedId} />
      {/if}

      {#if cohorts.length > 1}
        <div class="cohorts" role="group" aria-label="Show responses by when they were collected">
          {#each cohorts as c (c.key)}
            <button
              type="button"
              class="pill sm"
              class:active={c.key === selectedCohort}
              aria-pressed={c.key === selectedCohort}
              onclick={() => (selectedCohort = c.key)}
            >
              {c.label}
            </button>
          {/each}
        </div>
      {/if}

      <p class="updated ui">
        {stats.electionLabel} · updated {updated} · {(
          activeCohort?.totalResponses ?? 0
        ).toLocaleString("en-AU")} responses
      </p>
      {#if activeCohort?.disclosure}
        <p class="cohort-note ui">{activeCohort.disclosure}</p>
      {/if}
      {#if activeCohort && !activeCohort.published}
        <p class="empty">
          Not enough responses in this group yet to show without identifying individuals — try “All
          responses”, or check back later.
        </p>
      {/if}

      {#if partyViews.length > 0}
        <h2 class="section-head">How party match lines up with who people are</h2>
        {#each partyViews as view (view.id)}
          {@const geo = geoFor(view)}
          <section class="view">
            <h3 class="view-title">{view.title}</h3>
            {#if view.geos.length > 1}
              <div class="geos" role="group" aria-label="Choose a region">
                {#each view.geos as g (g.code ?? "national")}
                  <button
                    type="button"
                    class="pill sm"
                    class:active={g.code === (geoByView[view.id] ?? null)}
                    aria-pressed={g.code === (geoByView[view.id] ?? null)}
                    onclick={() => (geoByView = { ...geoByView, [view.id]: g.code })}
                  >
                    {g.scope === "national" ? "Australia" : (g.code ?? g.label)}
                  </button>
                {/each}
              </div>
            {/if}
            {#each geo.buckets as bucket (bucket.key)}
              <div class="bucket">
                <h4 class="ui">{bucket.label}</h4>
                <ul>
                  {#each bucket.cells as cell (cell.key)}
                    {@const p = pct(cell.count, bucket.shown)}
                    <li>
                      <div class="row ui">
                        <span class="name">{cell.label}</span>
                        <span class="figure">{p}%</span>
                      </div>
                      <div
                        class="bar"
                        role="img"
                        aria-label={`${cell.label}: ${p}% of ${bucket.shown} shown responses`}
                      >
                        <span class="fill" style:width={`${p}%`}></span>
                      </div>
                    </li>
                  {/each}
                </ul>
                <p class="note ui">of {bucket.shown.toLocaleString("en-AU")} shown responses</p>
              </div>
            {/each}
          </section>
        {/each}
      {/if}

      {#if propositionViews.length > 0}
        <h2 class="section-head">How respondents answered each issue</h2>
        <div class="legend ui" aria-hidden="true">
          <span class="key"><span class="sw agree"></span>Agree</span>
          <span class="key"><span class="sw neutral"></span>Neutral</span>
          <span class="key"><span class="sw disagree"></span>Disagree</span>
        </div>
        <ul class="props">
          {#each propositionViews as view (view.id)}
            {@const p = propParts(view)}
            {@const a = pct(p.agree, p.shown)}
            {@const n = pct(p.neutral, p.shown)}
            {@const d = pct(p.disagree, p.shown)}
            <li class="prop">
              <p class="prop-text">{view.title}</p>
              <div
                class="seg"
                role="img"
                aria-label={`Agree ${a}%, neutral ${n}%, disagree ${d}%, of ${p.shown} shown responses`}
              >
                {#if a > 0}<span class="seg-a agree" style:width={`${a}%`}></span>{/if}
                {#if n > 0}<span class="seg-a neutral" style:width={`${n}%`}></span>{/if}
                {#if d > 0}<span class="seg-a disagree" style:width={`${d}%`}></span>{/if}
              </div>
              <p class="note ui">
                Agree {a}% · Neutral {n}% · Disagree {d}% · of {p.shown.toLocaleString("en-AU")} shown
              </p>
            </li>
          {/each}
        </ul>
      {/if}

      {#if partyViews.length > 0 || propositionViews.length > 0}
        <p class="footnote ui">
          Percentages are of responses shown in each group, after small groups are withheld, so they
          may not cover every response received. Because the sample is people who chose to use this
          tool, it is not a representative poll. Responses are grouped by when they were collected
          and never combined across those groups without saying so.
        </p>
      {/if}
    {:else}
      <p class="empty">
        {#if selectedUpcoming}
          The {selectedLabel} is newly open for comparisons — no survey responses have been collected
          yet. Results appear here, as privacy-protected aggregates, once enough people contribute.
        {:else}
          Not enough responses yet to show anything without identifying individuals. Check back
          after more people have built their comparisons.
        {/if}
      </p>
    {/if}
  {/if}
</article>

<style>
  .insights {
    padding: 8px var(--gutter) 32px;
    font-size: 16px;
    line-height: 1.6;
  }
  h1 {
    font-size: 28px;
    margin: 8px 0 12px;
  }
  .lead {
    color: var(--ink2);
    margin: 0 0 8px;
  }
  .lead a {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .elections {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 0 6px;
  }
  .geos {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 12px;
  }
  .cohorts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 2px 0 8px;
  }
  .cohort-note {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 0 0 16px;
    padding-left: 10px;
    border-left: 3px solid var(--rule);
  }
  .updated + .cohort-note {
    margin-top: -12px;
  }
  .pill {
    min-height: 40px;
    padding: 6px 16px;
    border: 1.5px solid var(--rule);
    border-radius: 20px;
    background: var(--raise);
    color: var(--ink);
    font-family: var(--ui);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .pill.sm {
    min-height: 32px;
    padding: 3px 12px;
    font-size: 12.5px;
    border-radius: 16px;
  }
  .pill.active {
    background: var(--ink);
    color: var(--on-fill);
    border-color: var(--ink);
  }
  /* No published results yet (e.g. the upcoming comparison): dashed to read as "awaiting". */
  .pill.awaiting {
    border-style: dashed;
  }
  .pill.awaiting.active {
    border-style: solid;
  }
  .updated {
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink3);
    margin: 4px 0 20px;
  }
  .empty {
    color: var(--ink2);
    margin: 20px 0;
  }
  .section-head {
    font-size: 15px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--ink2);
    border-top: 1px solid var(--line);
    padding-top: 18px;
    margin: 30px 0 14px;
  }
  .view {
    margin: 0 0 28px;
  }
  .view-title {
    font-size: 20px;
    margin: 0 0 12px;
  }
  .bucket {
    margin: 0 0 16px;
  }
  h4 {
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink2);
    margin: 0 0 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    margin: 0 0 8px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    margin-bottom: 3px;
  }
  .name {
    color: var(--ink);
    font-weight: 600;
  }
  .figure {
    color: var(--ink2);
    font-variant-numeric: tabular-nums;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--wash);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ink);
  }
  .note {
    font-size: 11.5px;
    color: var(--ink3);
    margin: 4px 0 0;
  }
  /* Proposition support: one segmented bar per issue. Neutrality holds — all segments are the same
     ink, distinguished only by opacity (a shade, never a hue), so no party or valence colour. */
  .legend {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--ink2);
    margin: 0 0 12px;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--ink);
  }
  .props {
    margin: 0;
  }
  .prop {
    margin: 0 0 16px;
  }
  .prop-text {
    font-size: 14px;
    color: var(--ink);
    margin: 0 0 6px;
  }
  .seg {
    display: flex;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    background: var(--wash);
  }
  .seg-a {
    height: 100%;
    background: var(--ink);
  }
  .agree {
    opacity: 1;
  }
  .neutral {
    opacity: 0.5;
  }
  .disagree {
    opacity: 0.22;
  }
  .sw.neutral {
    opacity: 0.5;
  }
  .sw.disagree {
    opacity: 0.22;
  }
  .footnote {
    font-size: 12px;
    color: var(--ink3);
    border-top: 1px solid var(--line);
    padding-top: 14px;
    margin-top: 24px;
  }
</style>
