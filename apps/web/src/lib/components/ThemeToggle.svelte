<script lang="ts">
  import { theme } from "$lib/theme.svelte";

  // An icon toggle: a sun when the resolved theme is light, a moon when it is dark — the glyph shows
  // the *current* mode. It stays accessible because the button keeps a text label (aria-label) and
  // announces its state via aria-pressed, so screen readers get everything the icon conveys.
  const isDark = $derived(theme.resolved() === "dark");
</script>

<button
  type="button"
  class="ui toggle"
  onclick={() => theme.toggle()}
  aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
  aria-pressed={isDark}
  title={isDark ? "Switch to light theme" : "Switch to dark theme"}
>
  {#if isDark}
    <!-- Moon -->
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 13.2A8 8 0 1 1 10.8 4a6.5 6.5 0 0 0 9.2 9.2Z" />
    </svg>
  {:else}
    <!-- Sun -->
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"
      />
    </svg>
  {/if}
</button>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: 0;
    padding: 0;
    color: var(--ink2);
    cursor: pointer;
    border-radius: var(--radius);
  }
  .toggle:hover,
  .toggle:focus-visible {
    color: var(--ink);
  }
</style>
