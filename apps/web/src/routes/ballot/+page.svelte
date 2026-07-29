<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import ElectorateMap from "$lib/components/ElectorateMap.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import Progress from "$lib/components/Progress.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { NATIONAL_BALLOT, STATES, loadData, stateName, type Data } from "$lib/data";
  import { election } from "$lib/election.svelte";
  import { manifestFor } from "$lib/manifest";
  import { quiz } from "$lib/quiz.svelte";

  let step = $state<1 | 2 | 3>(1);
  let chosenState = $state<string | null>(null);
  let chosenElectorate = $state<string | null>(null);
  let filter = $state("");

  // The state grid (STATES) is dataset-free and renders immediately; the electorate list needs the
  // dataset, so we start loading it up front — it is usually ready by the time a state is picked.
  let data = $state<Data | null>(null);
  let loadError = $state(false);
  onMount(() => {
    // A provisional/upcoming election ships no ballot (no electorates), so there is nothing to pick:
    // set the sentinel national ballot and go straight to the questions. Detected from the tiny
    // manifest (no dataset needed), so this forwards before any electorate UI can flash.
    if ((manifestFor(election.id).counts["electorates"] ?? 0) === 0) {
      quiz.setBallot(NATIONAL_BALLOT.state, NATIONAL_BALLOT.electorate);
      void goto("/quiz");
      return;
    }
    void loadData(election.id)
      .then((d) => {
        data = d;
        quiz.syncQuestions(d.activeQuestionIds);
      })
      .catch(() => {
        loadError = true;
      });
  });

  // State picker is shown alphabetically (STATES itself is kept in ballot-paper order).
  const states = [...STATES].sort((a, b) => a.code.localeCompare(b.code));

  const list = $derived(chosenState && data ? data.electoratesFor(chosenState) : []);
  const filtered = $derived(
    list.filter((e) => e.electorate.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  function pickState(code: string): void {
    chosenState = code;
    filter = "";
    step = 2;
  }

  function pickElectorate(electorate: string): void {
    if (!chosenState) return;
    chosenElectorate = electorate;
    step = 3;
  }

  function confirm(): void {
    if (!chosenState || !chosenElectorate) return;
    quiz.setBallot(chosenState, chosenElectorate);
    goto("/quiz");
  }

  function back(): void {
    if (step === 3) {
      step = 2;
      chosenElectorate = null;
    } else if (step === 2) {
      step = 1;
      chosenState = null;
    } else {
      goto("/");
    }
  }
</script>

<Meta />

<TopBar label={`Your ballot · ${step} of 3`} onback={back} />
<Progress value={step} max={3} label="Ballot setup progress" />

<div class="body">
  {#if step === 1}
    <h1>Where will you vote?</h1>
    <div class="states">
      {#each states as s (s.code)}
        <button type="button" class="state" onclick={() => pickState(s.code)}>
          <b>{s.code}</b><span>{s.name}</span>
        </button>
      {/each}
    </div>
    <p class="note ui">Your answers stay on this device until you choose to share your card.</p>
  {:else if step === 2 && loadError}
    <h1>Your federal electorate</h1>
    <p class="note ui" role="alert">
      Couldn't load the electorate list. Please check your connection and
      <a href="/ballot" onclick={() => location.reload()}>try again</a>.
    </p>
  {:else if step === 2 && !data}
    <h1>Your federal electorate</h1>
    <p class="note ui" role="status">Loading electorates…</p>
  {:else if step === 2}
    <h1>Your federal electorate</h1>
    <div class="search ui">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        bind:value={filter}
        placeholder={`Search ${list.length} ${chosenState} electorates…`}
        aria-label="Search electorates"
        autocomplete="off"
      />
    </div>
    <ul class="rows ui">
      {#each filtered as e (e.electorate)}
        <li>
          <button type="button" onclick={() => pickElectorate(e.electorate)}>
            <b>{e.electorate}</b><span>{chosenState}</span>
          </button>
        </li>
      {:else}
        <li class="empty">No electorate matches “{filter}”.</li>
      {/each}
    </ul>
    <p class="note ui">
      Not sure? <ExternalLink href="https://check.aec.gov.au/"
        >Look up your electorate on the AEC website</ExternalLink
      > — your progress is kept.
    </p>
  {:else if chosenState && chosenElectorate}
    <h1>{chosenElectorate}</h1>
    <p class="sub ui">Federal electorate in {stateName(chosenState)}</p>
    <ElectorateMap electionId={election.id} stateCode={chosenState} electorate={chosenElectorate} />
    <div class="confirm ui">
      <button type="button" class="btn" onclick={confirm}>This is my electorate — start</button>
      <button type="button" class="link" onclick={back}>Choose a different electorate</button>
    </div>
  {/if}
</div>

<style>
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px var(--gutter) 20px;
  }
  h1 {
    font-size: 25px;
    margin: 8px 0 4px;
  }
  .states {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 18px;
  }
  .state {
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    min-height: 60px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px 14px;
    background: var(--raise);
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    font-family: var(--ui);
  }
  .state b {
    font-size: 16px;
  }
  .state span {
    font-size: 10.5px;
    color: var(--ink3);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    min-height: 50px;
    padding: 8px 14px;
    margin: 14px 0 4px;
    color: var(--ink3);
  }
  .search input {
    flex: 1;
    border: 0;
    background: none;
    font-size: 15px;
    color: var(--ink);
    outline: none;
  }
  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-y: auto;
  }
  .rows li button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 50px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: none;
    font-size: 15.5px;
    color: var(--ink);
    cursor: pointer;
    text-align: left;
    padding: 4px 2px;
  }
  .rows li button span {
    font-size: 12px;
    color: var(--ink3);
  }
  .empty {
    padding: 16px 2px;
    color: var(--ink2);
    font-size: 14px;
  }
  .note {
    font-size: 12.5px;
    color: var(--ink3);
    margin-top: 16px;
  }
  .note a {
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .sub {
    font-size: 13.5px;
    color: var(--ink2);
    margin: 0;
  }
  .confirm {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 18px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 54px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 16px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
  }
  .link {
    text-align: center;
    font-family: var(--ui);
    font-size: 13.5px;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    background: none;
    border: 0;
    cursor: pointer;
    min-height: 46px;
  }
  .link:hover,
  .link:focus-visible {
    color: var(--ink);
  }
</style>
