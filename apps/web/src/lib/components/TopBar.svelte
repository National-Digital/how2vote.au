<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    onback,
    backLabel = "Go back",
    right,
  }: {
    label: string;
    onback?: () => void;
    backLabel?: string;
    right?: Snippet;
  } = $props();
</script>

<div class="top ui app-top">
  {#if onback}
    <button type="button" class="back" onclick={onback} aria-label={backLabel}>‹</button>
  {:else}
    <span class="back-spacer"></span>
  {/if}
  <span class="label">{label}</span>
  <span class="right"
    >{#if right}{@render right()}{/if}</span
  >
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px var(--gutter) 10px;
    /* --topbar-h is the bar's resting height, and the fallback the focus scroll-padding uses before
       hydration. It is a FLOOR, not a fixed box: a hard height would clip the label under
       text-only zoom or a browser minimum-font-size — the readers who enlarged the text are
       exactly the ones who would lose it (WCAG 2.2 SC 1.4.4). The bar grows instead, and
       routes/+layout re-measures it so the reservation follows. */
    min-height: var(--topbar-h);
    font-size: 12px;
    color: var(--ink2);
  }
  .label {
    flex: 1;
    text-align: center;
    /* A flex item's automatic minimum is its MIN-CONTENT width, which would push the bar wider
       than the viewport once the text is scaled up (SC 1.4.10). Let it shrink and wrap instead —
       the bar grows in height, which min-height above already allows for. */
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .back,
  .back-spacer {
    flex: none;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .back {
    font-size: 22px;
    line-height: 1;
    color: var(--ink);
    background: none;
    border: 0;
    cursor: pointer;
    border-radius: var(--radius);
  }
  .right {
    flex: none;
    min-width: 32px;
    text-align: right;
  }
</style>
