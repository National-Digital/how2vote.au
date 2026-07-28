<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { ELECTIONS } from "@how2vote/data-schema";
  import { isNativeShell, storeListingUrl } from "$lib/channel";
  import { now } from "$lib/now.svelte";
  import { assessStaleness } from "$lib/staleness";

  // The dismissal is remembered against the dataVersion it was shown for (in the how2vote:
  // namespace, so it is backed up / cleared like all other on-device state).
  const DISMISS_KEY = "how2vote:stale-dismissed:v1";

  let dismissedVersion = $state<string | null>(null);
  onMount(() => {
    now.start(); // slow wall-clock; the verdict must be able to flip as a poll approaches
    try {
      dismissedVersion = localStorage.getItem(DISMISS_KEY);
    } catch {
      /* storage blocked — treat as not dismissed */
    }
  });

  // Pure, channel-independent verdict (staleness.ts). Only the REMEDY below differs by channel.
  const verdict = $derived(assessStaleness(ELECTIONS, now.current));
  const show = $derived(
    browser && verdict.level !== "none" && verdict.dataVersion !== dismissedVersion,
  );
  const storeUrl = $derived(storeListingUrl());

  function dismiss(): void {
    dismissedVersion = verdict.dataVersion;
    try {
      localStorage.setItem(DISMISS_KEY, verdict.dataVersion);
    } catch {
      /* storage blocked — dismissal is session-only, acceptable */
    }
  }

  function reload(): void {
    location.reload();
  }
</script>

{#if show}
  <aside class="stale ui" class:prominent={verdict.level === "prominent"} aria-live="polite">
    <p class="msg">
      {#if verdict.level === "prominent"}
        This app's candidate data (from {verdict.dataVersion}) is from before nominations were
        finalised, so the ballot may be incomplete.
      {:else}
        This app's candidate data is from {verdict.dataVersion}. A newer version may be available.
      {/if}
    </p>
    <div class="actions">
      {#if isNativeShell && storeUrl}
        <!-- User-initiated OS handoff to the store listing — no version lookup, no network. -->
        <a class="act" href={storeUrl} rel="noopener">Update</a>
      {:else if !isNativeShell}
        <button type="button" class="act" onclick={reload}>Reload</button>
      {/if}
      <button type="button" class="dismiss" onclick={dismiss}>Dismiss</button>
    </div>
  </aside>
{/if}

<style>
  .stale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding: 10px var(--gutter);
    border-bottom: 1px solid var(--line);
    background: var(--paper2, var(--paper));
    font-size: 13px;
    color: var(--ink2);
  }
  .stale.prominent {
    border-bottom-width: 2px;
    border-bottom-color: var(--ink);
    color: var(--ink);
  }
  .msg {
    margin: 0;
    flex: 1 1 260px;
    line-height: 1.45;
  }
  .actions {
    display: flex;
    gap: 10px;
    flex: 0 0 auto;
  }
  .act,
  .dismiss {
    font: inherit;
    cursor: pointer;
    background: none;
    border: 0;
    padding: 4px 6px;
    min-height: 24px;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .dismiss {
    color: var(--ink3);
  }
</style>
