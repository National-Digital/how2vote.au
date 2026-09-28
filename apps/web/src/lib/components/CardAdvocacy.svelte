<script lang="ts">
  /**
   * Under-18 explore mode (ADR 0012): the comparison IS the result. No how-to-vote card is built,
   * printed, shared or saved for someone too young to vote — that would be electoral material for a
   * non-voter. Points to lawful, non-partisan ways to take part instead. The card renders it; the
   * build renders it into `states/card.html` with its values `marked` (ADR 0019 D4b).
   */
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { CIVIC_LINKS } from "$lib/org";

  let {
    age,
    electorate,
    electorateLess,
    marked = false,
  }: {
    age: number | string;
    electorate: string;
    electorateLess: boolean;
    marked?: boolean;
  } = $props();
</script>

{#snippet a()}{#if marked}<data value="age">{age}</data>{:else}{age}{/if}{/snippet}
{#snippet e()}{#if marked}<data value="electorate">{electorate}</data
    >{:else}{electorate}{/if}{/snippet}

<p class="adv-head">
  <b>This comparison is yours to explore — How2Vote won't build you a how-to-vote plan.</b>
</p>
<p>
  You told us you're under {@render a()}, so you can't vote at a federal election yet, and a
  how-to-vote card is material for casting a vote. The comparison above still shows how your answers
  line up with the parties' recorded votes. When you're old enough to vote, come back and build your
  plan.
</p>
<p class="adv-sub"><b>Want your voice heard now?</b></p>
<ul>
  <li>
    <ExternalLink href={CIVIC_LINKS.enrol}>Enrol early with the AEC</ExternalLink>
    — at 16 or 17 you can provisionally enrol, so you're ready to vote the day you turn {@render a()}.
  </li>
  <li>
    <ExternalLink href={CIVIC_LINKS.findMember}>
      {#if electorateLess}Contact your local federal member{:else}Contact the member for {@render e()}{/if}
    </ExternalLink>
    — tell the person who represents your area what matters to you.
  </li>
  <li>
    <ExternalLink href={CIVIC_LINKS.votingRecord}>See how Parliament has voted</ExternalLink>
    — the parliamentary records behind this quiz, on They Vote For You.
  </li>
</ul>
