<script lang="ts">
  /**
   * A stage-dependent part of the landing — its lede or its steps — which differ between an
   * upcoming, a live and an archived election. `Landing.svelte` renders it for the election's stage
   * now; `/states/landing` renders every stage for every election, so the build holds each one and
   * the iOS app can show the one its engine reports (ADR 0019 D4b).
   */
  import { electionById, electionPhase, type ElectionPhase } from "@how2vote/data-schema";
  import { manifestFor } from "$lib/manifest";

  let {
    electionId,
    part,
    phase,
  }: { electionId: string; part: "lede" | "steps"; phase?: ElectionPhase } = $props();

  const meta = $derived(electionById(electionId)!);
  const count = $derived(manifestFor(electionId).counts["questions"] ?? 0);
  // The election's stage from the single AEC-timetable classifier the card uses, so the landing and
  // the card cannot disagree about liveness. An upcoming election is a PROVISIONAL comparison against
  // the current Parliament's record, with no ballot yet.
  const stage = $derived(phase ?? electionPhase(meta));
  const isPast = $derived(stage === "archived");
  const isUpcoming = $derived(stage === "upcoming");
  const electorateLess = $derived((manifestFor(electionId).counts["electorates"] ?? 0) === 0);

  // The step rail adapts to the flow: an electorate-less provisional quiz has no ballot step.
  const steps = $derived(
    electorateLess
      ? [
          { n: "1 · Answer", d: `${count} questions, ~5 min` },
          { n: "2 · Compare", d: "See how you compare" },
        ]
      : [
          { n: "1 · Ballot", d: "Find your electorate" },
          { n: "2 · Answer", d: `${count} questions, ~5 min` },
          { n: "3 · Compare", d: isPast ? "Review the record" : "See how you compare" },
        ],
  );
</script>

<div class="stage" id="{part}-{electionId}-{stage}">
  {#if part === "lede"}
    <p class="lede">
      {#if isUpcoming}
        Answer {count} real questions the current Parliament has voted on and see how your views compare
        with the parties' recorded votes.{" "}<span class="past"
          >The next federal election hasn't been announced yet, so this is a provisional comparison
          against the current Parliament — the questions may change, and there are no candidates or
          printable how-to-vote plan yet.</span
        >
      {:else}
        Answer {count} real questions parliament has voted on and see how your views compare with the
        parties' recorded votes, for your {meta.year} ballot — House and Senate.{#if isPast}{" "}<span
            class="past"
            >This election has already been held — what follows is a historical comparison, scored
            on the record as it stood then.</span
          >{/if}
      {/if}
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
