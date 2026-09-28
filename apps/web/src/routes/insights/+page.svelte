<script lang="ts">
  import { goto } from "$app/navigation";
  import Meta from "$lib/components/Meta.svelte";
  import InsightsClosed from "$lib/components/InsightsClosed.svelte";
  import InsightsLead from "$lib/components/InsightsLead.svelte";
  import ProvenanceNotice from "$lib/components/ProvenanceNotice.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import {
    DEFAULT_MIN_CELL,
    count,
    electionPill,
    geoFor,
    initialElection,
    insightsClosed,
    listedElections,
    pct,
    propParts,
    readIndex,
    readStats,
    updatedOn,
    type CohortStats,
    type PartyView,
    type PropositionView,
    type StatsFile,
    type StatsIndex,
  } from "$lib/insights";
  import { INSIGHTS_COPY } from "$lib/insights-copy";
  import { now } from "$lib/now.svelte";
  import { insightsDatasetGraph } from "$lib/structured-data";
  import { fill } from "$lib/template";
  import { electionById, electionPhase } from "@how2vote/data-schema";

  let index = $state<StatsIndex | null>(null);
  let stats = $state<StatsFile | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let selectedId = $state<string>("");
  // The selected collection-context cohort key (e.g. "all", "historical").
  let selectedCohort = $state<string>("");
  // Per party-view selected geography code; null / absent = national.
  let geoByView = $state<Record<string, string | null>>({});

  const listed = $derived(listedElections(index));
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

  // Closed on election day (`insightsClosed`), off the ticking `now`, so a tab left open flips at
  // the boundary without a reload.
  const closed = $derived(insightsClosed(now.current));

  async function loadIndex(): Promise<void> {
    try {
      const res = await fetch("/stats/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("index unavailable");
      const file = readIndex(await res.json());
      if (!file) throw new Error("unknown stats schema");
      index = file;
      await selectElection(initialElection(file));
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
      const file = readStats(await res.json());
      if (!file) throw new Error("unknown stats schema");
      stats = file;
      selectedCohort = file.cohorts[0]?.key ?? "all";
    } catch {
      stats = null; // fall through to the per-election "not enough yet" state
    } finally {
      loading = false;
    }
  }

  const updated = $derived(stats ? updatedOn(stats.generatedAt) : "");
</script>

<Meta />

<!-- schema.org Dataset for the published survey aggregates, in the prerendered HTML (not gated on
     the figures' fetch) so crawlers and Google Dataset Search see it. -->
<StructuredData node={insightsDatasetGraph()} />

<TopBar label={INSIGHTS_COPY.top} onback={() => goto("/")} backLabel={INSIGHTS_COPY.back} />

<article class="insights">
  <h1>{INSIGHTS_COPY.title}</h1>
  {#if closed}
    <InsightsClosed />
  {:else}
    <InsightsLead min={stats?.minCell ?? DEFAULT_MIN_CELL} />

    {#if index && listed.length > 1}
      <div class="elections" role="group" aria-label={INSIGHTS_COPY.elections}>
        {#each listed as e (e.id)}
          <button
            type="button"
            class="pill"
            class:active={e.id === selectedId}
            class:awaiting={!e.published}
            aria-pressed={e.id === selectedId}
            onclick={() => selectElection(e.id)}
          >
            {electionPill(e.label)}
          </button>
        {/each}
      </div>
    {/if}

    {#if failed}
      <p class="empty">{INSIGHTS_COPY.failed}</p>
    {:else if loading && !stats}
      <p class="empty">{INSIGHTS_COPY.loading}</p>
    {:else if stats && stats.published}
      {#if selectedId}
        <ProvenanceNotice electionId={selectedId} />
      {/if}

      {#if cohorts.length > 1}
        <div class="cohorts" role="group" aria-label={INSIGHTS_COPY.cohorts}>
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
        {fill(INSIGHTS_COPY.updated, {
          election: stats.electionLabel,
          date: updated,
          count: count(activeCohort?.totalResponses ?? 0),
        })}
      </p>
      {#if activeCohort?.disclosure}
        <p class="cohort-note ui">{activeCohort.disclosure}</p>
      {/if}
      {#if activeCohort && !activeCohort.published}
        <p class="empty">{INSIGHTS_COPY.withheld}</p>
      {/if}

      {#if partyViews.length > 0}
        <h2 class="section-head">{INSIGHTS_COPY.parties}</h2>
        {#each partyViews as view (view.id)}
          {@const geo = geoFor(view, geoByView[view.id] ?? null)}
          <section class="view">
            <h3 class="view-title">{view.title}</h3>
            {#if view.geos.length > 1}
              <div class="geos" role="group" aria-label={INSIGHTS_COPY.regions}>
                {#each view.geos as g (g.code ?? "national")}
                  <button
                    type="button"
                    class="pill sm"
                    class:active={g.code === (geoByView[view.id] ?? null)}
                    aria-pressed={g.code === (geoByView[view.id] ?? null)}
                    onclick={() => (geoByView = { ...geoByView, [view.id]: g.code })}
                  >
                    {g.scope === "national" ? INSIGHTS_COPY.national : (g.code ?? g.label)}
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
                        aria-label={fill(INSIGHTS_COPY.bar, {
                          label: cell.label,
                          pct: p,
                          shown: bucket.shown,
                        })}
                      >
                        <span class="fill" style:width={`${p}%`}></span>
                      </div>
                    </li>
                  {/each}
                </ul>
                <p class="note ui">{fill(INSIGHTS_COPY.of, { shown: count(bucket.shown) })}</p>
              </div>
            {/each}
          </section>
        {/each}
      {/if}

      {#if propositionViews.length > 0}
        <h2 class="section-head">{INSIGHTS_COPY.propositions}</h2>
        <div class="legend ui" aria-hidden="true">
          <span class="key"><span class="sw agree"></span>{INSIGHTS_COPY.agree}</span>
          <span class="key"><span class="sw neutral"></span>{INSIGHTS_COPY.neutral}</span>
          <span class="key"><span class="sw disagree"></span>{INSIGHTS_COPY.disagree}</span>
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
                aria-label={fill(INSIGHTS_COPY.split, {
                  agree: a,
                  neutral: n,
                  disagree: d,
                  shown: p.shown,
                })}
              >
                {#if a > 0}<span class="seg-a agree" style:width={`${a}%`}></span>{/if}
                {#if n > 0}<span class="seg-a neutral" style:width={`${n}%`}></span>{/if}
                {#if d > 0}<span class="seg-a disagree" style:width={`${d}%`}></span>{/if}
              </div>
              <p class="note ui">
                {fill(INSIGHTS_COPY.tally, {
                  agree: a,
                  neutral: n,
                  disagree: d,
                  shown: count(p.shown),
                })}
              </p>
            </li>
          {/each}
        </ul>
      {/if}

      {#if partyViews.length > 0 || propositionViews.length > 0}
        <p class="footnote ui">{INSIGHTS_COPY.footnote}</p>
      {/if}
    {:else}
      <p class="empty">
        {#if selectedUpcoming}
          {fill(INSIGHTS_COPY.upcoming, { election: selectedLabel })}
        {:else}
          {INSIGHTS_COPY.empty}
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
