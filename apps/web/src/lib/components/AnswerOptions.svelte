<script lang="ts">
  import type { AnswerPoints } from "@how2vote/engine";
  import { OPTIONS } from "$lib/answers";

  let {
    current,
    onanswer,
    onskip,
  }: {
    current: { points: AnswerPoints; important: boolean } | undefined;
    onanswer: (points: AnswerPoints) => void;
    onskip: () => void;
  } = $props();

  const isOn = (points: AnswerPoints): boolean =>
    current !== undefined && current.points === points;

  const isSkipOn = $derived(current !== undefined && current.points === 0);
</script>

<div class="opts" role="group" aria-label="Your answer">
  {#each OPTIONS as opt (opt.kind + (opt.kind !== "skip" ? opt.points : ""))}
    {#if opt.kind === "skip"}
      <button
        type="button"
        class="skip"
        class:on={isSkipOn}
        aria-pressed={isSkipOn}
        onclick={onskip}>{opt.label}</button
      >
    {:else}
      <button
        type="button"
        class="opt"
        class:on={isOn(opt.points)}
        aria-pressed={isOn(opt.points)}
        onclick={() => onanswer(opt.points)}
      >
        {opt.label}{#if opt.sub}<small>{opt.sub}</small>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .opts {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .opt {
    display: flex;
    align-items: center;
    min-height: 48px;
    padding: 6px 14px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    background: var(--raise);
    color: var(--ink);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    text-align: left;
    width: 100%;
    cursor: pointer;
    transition:
      background var(--dur-confirm) ease-out,
      color var(--dur-confirm) ease-out;
  }
  .opt small {
    font-weight: 400;
    color: var(--ink2);
    margin-left: auto;
    font-size: 11px;
    padding-left: 8px;
    text-align: right;
  }
  .opt.on {
    background: var(--ink);
    color: var(--on-fill);
  }
  .opt.on small {
    color: var(--on-fill);
    opacity: 0.8;
  }
  .skip {
    text-align: center;
    font-size: 13px;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    padding: 12px 0 2px;
    background: none;
    border: 0;
    cursor: pointer;
    font-family: var(--ui);
    width: 100%;
  }
  .skip.on {
    color: var(--ink);
    font-weight: 600;
  }
  .skip:hover,
  .skip:focus-visible {
    color: var(--ink);
  }
</style>
