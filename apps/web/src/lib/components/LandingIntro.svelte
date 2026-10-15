<script lang="ts">
  /**
   * A stage-dependent part of the landing — its lede or its steps — worded for the election's stage
   * (`$lib/election-stage`). `Landing.svelte` renders it for the election's phase now;
   * `/states/landing` renders every phase for every election, so the build holds each one and the
   * iOS app can show the one its engine reports (ADR 0019 D4b).
   */
  import { electionById, electionPhase, type ElectionPhase } from "@how2vote/data-schema";
  import { ballotFor } from "$lib/ballots";
  import { manifestFor } from "$lib/manifest";
  import { landingCopy } from "$lib/stage-copy";

  let {
    electionId,
    part,
    phase,
  }: { electionId: string; part: "lede" | "steps"; phase?: ElectionPhase } = $props();

  const meta = $derived(electionById(electionId)!);
  // The phase from the single AEC-timetable classifier the card uses, so the landing and the card
  // cannot disagree about liveness; the section is keyed by it for the iOS app.
  const shown = $derived(phase ?? electionPhase(meta));
  const copy = $derived(
    landingCopy({
      meta,
      phase: shown,
      ballot: ballotFor(electionId),
      count: manifestFor(electionId).counts["questions"] ?? 0,
    }),
  );
  const lede = $derived(copy.lede);
  const steps = $derived(copy.steps);
</script>

<div class="stage" id="{part}-{electionId}-{shown}">
  {#if part === "lede"}
    <p class="lede">
      {lede.lead}{#if lede.note}{" "}<span class="past">{lede.note}</span>{/if}
    </p>
  {:else}
    <ol class="steps ui">
      {#each steps as s (s.n)}
        <li><b>{s.n}</b>{s.d}</li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .past {
    color: var(--ink3);
  }
  .lede {
    font-size: 15px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 14px 0 0;
  }
  .steps {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 8px;
    margin: 8px 0 0;
  }
  .steps li {
    flex: 1;
    border-top: 2px solid var(--rule);
    padding-top: 8px;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--ink2);
  }
  .steps b {
    display: block;
    color: var(--ink);
    font-size: 12px;
    margin-bottom: 2px;
  }
</style>
