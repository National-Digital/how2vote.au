<script lang="ts">
  // Reusable, versioned Terms-of-Use acceptance gate. Shown when a consequential action
  // (build a plan, create a share link, print, contribute to research) is requested but the current
  // Terms version has not yet been actively accepted. Ticking the affirmation and confirming records
  // a versioned acceptance (version + timestamp) on the device-local store, then runs `onaccept`.
  //
  // The affirmation copy is single-sourced from $lib/terms/terms so the card gate, the survey gate
  // and the copy-lint guard can never drift — and it is a CAPACITY declaration (natural person, not
  // an organisation, not a foreign campaigner), so the "who may use the Service" limit is actively
  // affirmed at every gated action.
  import DocLink from "./DocLink.svelte";
  import { termsAcceptance } from "$lib/terms.svelte";
  import { TERMS_ACCEPTANCE_LABEL, TERMS_GATE_INTRO, TERMS_GATE_LABEL } from "$lib/terms/terms";

  let { onaccept, oncancel }: { onaccept: () => void; oncancel: () => void } = $props();

  let checked = $state(false);

  function confirm(): void {
    if (!checked) return;
    termsAcceptance.accept();
    onaccept();
  }
</script>

<div class="terms-gate ui" role="group" aria-label={TERMS_GATE_LABEL}>
  <p>
    <!-- Opens over the gate: navigating away to read the terms would discard the pending
         acceptance and leave no route back to it. -->
    {TERMS_GATE_INTRO} See our <DocLink href="/terms">Terms of Use</DocLink>.
  </p>
  <label class="terms-check">
    <input type="checkbox" bind:checked />
    <span>{TERMS_ACCEPTANCE_LABEL}</span>
  </label>
  <div class="terms-actions">
    <button type="button" class="btn" disabled={!checked} onclick={confirm}>
      Accept and continue
    </button>
    <button type="button" class="btn ghost" onclick={oncancel}> Cancel </button>
  </div>
</div>

<style>
  .terms-gate {
    margin: 4px var(--gutter) 0;
    padding: 14px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
  }
  .terms-gate p {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 10px;
  }
  /* :global because the anchor now belongs to DocLink — Svelte's scoping class is not applied
     across a component boundary, so a bare descendant selector would silently stop matching. */
  .terms-gate :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .terms-check {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-size: 13px;
    color: var(--ink);
    line-height: 1.45;
    margin-bottom: 12px;
    cursor: pointer;
  }
  .terms-check input {
    margin-top: 2px;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
  }
  .terms-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 50px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink);
    border: 1.5px solid var(--rule);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
