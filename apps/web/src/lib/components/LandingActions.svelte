<script lang="ts">
  /**
   * The landing's call to action, in each of its states: a first visit, a quiz part-way through, and
   * a finished one. `Landing.svelte` renders the state that applies; `/states/landing` renders all
   * three so the build holds each one (ADR 0019 D4b). The question numbers are marked with `<data>`
   * so a native renderer can put in the voter's own, and each button names its action (`value`).
   */
  let {
    state,
    next = 0,
    total = 0,
    onstart = () => undefined,
    onresume = () => undefined,
    oncard = () => undefined,
  }: {
    state: "fresh" | "resume" | "complete";
    next?: number;
    total?: number;
    onstart?: () => void;
    onresume?: () => void;
    oncard?: () => void;
  } = $props();
</script>

<div class="cta {state}">
  {#if state === "resume"}
    <button type="button" class="btn" value="resume" onclick={onresume}>
      Continue — question <data value="next">{next}</data> of <data value="total">{total}</data>
    </button>
    <button type="button" class="link" value="start" onclick={onstart}>Start again</button>
  {:else if state === "complete"}
    <button type="button" class="btn" value="card" onclick={oncard}>See my comparison</button>
    <button type="button" class="link" value="start" onclick={onstart}>Start again</button>
  {:else}
    <button type="button" class="btn" value="start" onclick={onstart}
      >See how my views compare</button
    >
    <a class="link" href="/methodology">How the matching works</a>
  {/if}
</div>

<style>
  .cta {
    margin-top: auto;
    padding-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    text-decoration: none;
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
  }
  .link:hover,
  .link:focus-visible {
    color: var(--ink);
  }
</style>
