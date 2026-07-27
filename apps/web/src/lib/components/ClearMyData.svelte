<script lang="ts">
  /**
   * The one "clear all my How2Vote data on this device" control. A single action wipes
   * every on-device store — in-progress quiz, saved comparisons, selected election, theme, Terms
   * acknowledgement, privacy choice and the age-eligibility bit — plus the offline app caches, then
   * reloads to a clean landing so nothing survives in memory either.
   *
   * Two-step confirm (mirrors the /saved "Clear all" pattern): the destructive action is never one
   * click away, and the button is inert while the wipe runs so it can't fire twice.
   */
  import { clearLocalDeviceData } from "$lib/privacy/local-data";

  let confirming = $state(false);
  let clearing = $state(false);

  async function clearEverything(): Promise<void> {
    if (clearing) return;
    clearing = true;
    await clearLocalDeviceData();
    // Hard-reload to a clean landing: every store re-hydrates from the now-empty storage, so no
    // in-memory residue (a loaded quiz, a saved list) can outlive the wipe.
    window.location.assign("/");
  }
</script>

<section class="clear-data ui" aria-labelledby="clear-data-h">
  <h2 id="clear-data-h">Clear all your data on this device</h2>
  <p class="lede">
    How2Vote keeps everything in this browser — there is no account and nothing is uploaded. This
    removes all of it from this device in one step:
  </p>
  <ul class="what">
    <li>your in-progress quiz answers and selected electorate;</li>
    <li>every comparison you saved on this device;</li>
    <li>your selected election and light/dark theme;</li>
    <li>your Terms acknowledgement and privacy choices;</li>
    <li>your age-eligibility confirmation; and</li>
    <li>the offline copy of the app and dataset stored for use without a connection.</li>
  </ul>
  <p class="note">
    This clears this device only. It cannot take back a link you have already shared: a share link
    carries its answers inside the link itself, so once you send it, it stays with whoever received
    it.
  </p>

  <div class="actions">
    {#if confirming}
      <span class="ask">Permanently clear everything on this device?</span>
      <button type="button" class="danger" disabled={clearing} onclick={clearEverything}>
        {clearing ? "Clearing…" : "Yes, clear everything"}
      </button>
      <button type="button" class="cancel" disabled={clearing} onclick={() => (confirming = false)}>
        Cancel
      </button>
    {:else}
      <button type="button" class="cancel start" onclick={() => (confirming = true)}>
        Clear all How2Vote data on this device
      </button>
    {/if}
  </div>
</section>

<style>
  .clear-data {
    margin: 20px 0 4px;
    padding: 16px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
  }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
  }
  .lede {
    font-size: 13.5px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 8px;
  }
  .what {
    margin: 0 0 10px;
    padding-left: 20px;
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.5;
  }
  .what li {
    margin: 2px 0;
  }
  .note {
    font-size: 12.5px;
    color: var(--ink3);
    line-height: 1.5;
    margin: 0 0 12px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
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
  .cancel.start {
    border: 1.5px solid var(--line2);
    border-radius: var(--radius);
    padding: 10px 14px;
    text-decoration: none;
    color: var(--ink);
  }
  .danger:disabled,
  .cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
