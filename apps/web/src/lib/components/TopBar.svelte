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

<div class="top ui">
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
    font-size: 12px;
    color: var(--ink2);
  }
  .label {
    flex: 1;
    text-align: center;
  }
  .back,
  .back-spacer {
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
    min-width: 32px;
    text-align: right;
  }
</style>
