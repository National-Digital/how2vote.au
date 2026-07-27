<script lang="ts">
  import { onMount } from "svelte";
  import Logo from "$lib/components/Logo.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { quiz } from "$lib/quiz.svelte";
  import {
    readOfflineCapability,
    type OfflineCapability,
    type OfflineCheck,
  } from "$lib/offline-status";

  // The steps we report on, in flow order. Each maps to a precached route; the dataset that powers
  // scoring is bundled into the app itself, so if these pages are cached, the card fully works.
  const CHECKS: OfflineCheck[] = [
    { path: "/", label: "The How2Vote app" },
    { path: "/ballot", label: "Choosing your electorate" },
    { path: "/quiz", label: "The 50 questions" },
    { path: "/review", label: "Reviewing your answers" },
    { path: "/card", label: "Your card & shared links" },
  ];

  let online = $state(true);
  let cap = $state<OfflineCapability | null>(null);

  onMount(() => {
    online = navigator.onLine;
    const sync = () => (online = navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    void refresh();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  });

  async function refresh(): Promise<void> {
    cap = await readOfflineCapability(CHECKS);
  }

  // Reactive so it updates the moment the quiz store hydrates (layout onMount) or the visitor
  // reconnects. `ready` means every step is cached — the whole card can be built with no signal.
  const ready = $derived(cap?.ready ?? false);
  const installed = $derived(cap?.installed ?? false);
  const resumable = $derived(
    quiz.hydrated && quiz.hasBallot && !quiz.complete && quiz.recorded > 0,
  );

  const heading = $derived(
    online
      ? "How2Vote works offline"
      : ready
        ? "You're offline — How2Vote still works"
        : "You're offline",
  );
</script>

<Meta />

<div class="wrap">
  <header class="top ui">
    <Logo size="sm" />
    <span class="pill" class:off={!online} aria-live="polite">{online ? "Online" : "Offline"}</span>
  </header>

  <div class="body">
    <h1>{heading}</h1>

    {#if online}
      <p class="lede">
        This tool is built to run entirely on your device. Once you've opened it, the questions, the
        scoring and your card all keep working with no connection — handy in a polling place with no
        signal.
      </p>
    {:else if ready}
      <p class="lede">
        Everything you need is saved on this device. You can build your voting comparison, review
        your answers, and open a shared link — all with no connection.
      </p>
    {:else if installed}
      <p class="lede">
        Some of the app is saved on this device, but not all of it yet. Reconnect once and the rest
        will be saved for next time.
      </p>
    {:else}
      <p class="lede">
        This page hasn't been saved to your device yet. Reconnect once — after that, How2Vote keeps
        working offline on its own.
      </p>
    {/if}

    {#if cap?.supported}
      <ul class="checks ui" aria-label="What's available offline">
        {#each cap.items as item (item.path)}
          <li class:on={item.available}>
            <span class="mark" aria-hidden="true">{item.available ? "✓" : "–"}</span>
            <span class="what">{item.label}</span>
            <span class="state">{item.available ? "Saved" : "Not saved yet"}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="cta">
      {#if resumable}
        <a class="btn" href="/quiz">Continue my comparison</a>
      {:else}
        <a class="btn" href="/ballot">Build my comparison</a>
      {/if}
      <a class="link" href="/saved">Cards saved on this device</a>
      {#if !online}
        <button type="button" class="link" onclick={() => location.reload()}>Check again</button>
      {/if}
    </div>

    <p class="foot ui">
      A connection is only needed for the optional research survey and cookieless usage analytics —
      never for building or reading your card.
    </p>
  </div>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px var(--gutter) 6px;
  }
  .pill {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink2);
    border: 1px solid var(--line2);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .pill.off {
    border-style: dashed;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px var(--gutter) 32px;
  }
  h1 {
    font-size: clamp(26px, 6.5vw, 31px);
    line-height: 1.15;
    margin: 0;
  }
  .lede {
    font-size: 15px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 14px 0 0;
  }
  .checks {
    list-style: none;
    margin: 22px 0 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .checks li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 0;
    border-bottom: 1px solid var(--line);
    font-size: 14px;
    color: var(--ink3);
  }
  .checks li.on {
    color: var(--ink);
  }
  .mark {
    flex: 0 0 auto;
    width: 20px;
    text-align: center;
    font-weight: 700;
    color: var(--ink2);
  }
  .checks li.on .mark {
    color: var(--ink);
  }
  .what {
    flex: 1;
  }
  .state {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink3);
  }
  .cta {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 26px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 50px;
    border: 0;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .link {
    text-align: center;
    color: var(--ink2);
    font-family: var(--ui);
    font-size: 14px;
    text-decoration: underline;
    text-underline-offset: 3px;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .foot {
    font-size: 12px;
    color: var(--ink3);
    line-height: 1.5;
    margin: 24px 0 0;
  }
</style>
