<script lang="ts">
  import { goto } from "$app/navigation";
  import ClearMyData from "$lib/components/ClearMyData.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import { saved } from "$lib/saved.svelte";
  import { SAVED_COPY } from "$lib/saved-copy";
  import { savedRows } from "$lib/saved-rows";
  import { around, fill } from "$lib/template";

  let confirmingClear = $state(false);

  const rows = $derived(savedRows(saved.items));
  const [howBefore, howAfter] = around(SAVED_COPY.how);

  function clearAll(): void {
    saved.clear();
    confirmingClear = false;
  }
</script>

<Meta />

<TopBar label={SAVED_COPY.title} onback={() => goto("/")} backLabel={SAVED_COPY.back} />

<div class="page">
  <h1>{SAVED_COPY.title}</h1>

  {#if !saved.hydrated}
    <p class="muted ui" aria-live="polite">{SAVED_COPY.loading}</p>
  {:else if saved.count === 0}
    <p class="lede">{SAVED_COPY.none}</p>
    <p class="muted">{howBefore}<strong>{SAVED_COPY.action}</strong>{howAfter}</p>
    <a class="btn" href="/ballot">{SAVED_COPY.build}</a>
  {:else}
    <p class="muted">{SAVED_COPY.kept}</p>

    <ul class="list">
      {#each rows as card (card.url)}
        <li>
          <a class="open" href={card.url}>
            <span class="name">{card.electorate}</span>
            <span class="meta ui">
              {fill(SAVED_COPY.meta, { state: card.state, date: card.date })}
            </span>
          </a>
          <button
            type="button"
            class="del ui"
            onclick={() => saved.remove(card.url)}
            aria-label={fill(SAVED_COPY.removal, { electorate: card.electorate })}
          >
            {SAVED_COPY.remove}
          </button>
        </li>
      {/each}
    </ul>

    <div class="clear ui">
      {#if confirmingClear}
        <span class="ask">{fill(SAVED_COPY.ask, { count: saved.count })}</span>
        <button type="button" class="danger" onclick={clearAll}>{SAVED_COPY.confirm}</button>
        <button type="button" class="cancel" onclick={() => (confirmingClear = false)}
          >{SAVED_COPY.cancel}</button
        >
      {:else}
        <button type="button" class="cancel" onclick={() => (confirmingClear = true)}>
          {SAVED_COPY.clear}
        </button>
      {/if}
    </div>
  {/if}

  <!-- The one global device-data control: clears EVERY on-device store + the offline
       caches, not just saved cards. Shown regardless of whether any card is saved so it is always
       reachable via the footer's "Saved cards" link. -->
  <ClearMyData />
</div>

<style>
  .page {
    padding: 8px var(--gutter) 28px;
  }
  h1 {
    font-size: 28px;
    margin: 8px 0 14px;
  }
  .lede {
    font-size: 16px;
    margin: 0 0 10px;
  }
  .muted {
    font-size: 13.5px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 16px;
  }
  .muted :global(strong) {
    color: var(--ink);
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 50px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .open {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  .name {
    font-size: 16px;
    font-weight: 600;
  }
  .open:hover .name,
  .open:focus-visible .name {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .meta {
    font-size: 12px;
    color: var(--ink3);
  }
  .del {
    flex: 0 0 auto;
    background: none;
    border: 1px solid var(--line2);
    border-radius: var(--radius);
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink2);
    cursor: pointer;
  }
  .del:hover,
  .del:focus-visible {
    color: var(--ink);
    border-color: var(--rule);
  }
  .clear {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 18px;
  }
  .ask {
    font-size: 13px;
    color: var(--ink2);
  }
  .danger,
  .cancel {
    background: none;
    border: 0;
    padding: 6px 0;
    font-family: var(--ui);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .danger {
    color: var(--ink);
  }
</style>
