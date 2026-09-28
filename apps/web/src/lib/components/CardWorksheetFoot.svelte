<script lang="ts">
  /**
   * The plan's footer, which travels with it: the preference order is the voter's, National Digital
   * authorises the template, when and from what it was built, and the data credits. The card renders
   * it; the build renders it into `states/card.html` for each kind of election, with its values
   * `marked` for the iOS app to fill (ADR 0019 D4b).
   */
  let {
    built,
    label,
    dataVersion,
    version,
    archived,
    attribution,
    marked = false,
  }: {
    built: string;
    label: string;
    dataVersion: string;
    version: string;
    archived: boolean;
    attribution: string;
    marked?: boolean;
  } = $props();
</script>

{#snippet value(name: string, text: string)}{#if marked}<data value={name}>{text}</data
    >{:else}{text}{/if}{/snippet}

<p>
  <b>Preference order selected by the user.</b> You chose every number — How2Vote does not recommend a
  candidate or a preference order. This how-to-vote plan is published and authorised by National Digital,
  which authorises the fixed plan template and comparison it contains. A voting plan is not a ballot paper
  and does not cast a vote.
</p>
<p>
  Built {@render value("built", built)} · {@render value("label", label)} (AEC) · data {@render value(
    "data",
    dataVersion,
  )} · app
  {@render value("version", version)}.
  {#if archived}
    This is a historical demonstration of an election that has already been held — it cannot be used
    to vote.
  {:else}
    Candidates and ballot order can change — always check your actual ballot paper and the current
    AEC instructions before voting.
  {/if}
</p>
<!-- Data attribution travels with the printed worksheet (ODbL/AEC obligation): the worksheet
     footer is NOT hidden in print, so the required credits appear on the printed output too. -->
<p class="worksheet-attribution">
  Vote data © {@render value("attribution", attribution)}. Candidates and ballot: Australian
  Electoral Commission.
</p>
