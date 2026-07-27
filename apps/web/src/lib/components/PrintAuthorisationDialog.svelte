<script lang="ts">
  import { tick } from "svelte";
  import { ORG } from "$lib/org";

  // The print acknowledgement modal — National Digital authoriser model (see docs/adr/0010). The
  // printed how-to-vote plan carries National Digital's authorisation, so this step no longer
  // collects the user's name/town/State. It confirms three things before the plan is printed: the
  // plan is authorised by National Digital, the preference order is the user's own selection, and it
  // is not a ballot paper. Declaration prose is subject to final legal sign-off before public
  // release. This is a real modal: it traps focus, restores it on close and closes on Escape (a11y),
  // following the ConsentSettings pattern. Nothing here is persisted or transmitted.
  let { onconfirm, oncancel }: { onconfirm: () => void; oncancel: () => void } = $props();

  // The acknowledgement must be ticked before the print can proceed — local to the modal, which
  // mounts fresh each time it opens.
  let ack = $state(false);

  let dialog = $state<HTMLElement | null>(null);
  const previouslyFocused = typeof document !== "undefined" ? document.activeElement : null;

  const canConfirm = $derived(ack);

  function focusables(): HTMLElement[] {
    if (!dialog) return [];
    return Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      oncancel();
      return;
    }
    if (event.key !== "Tab") return;
    // Focus trap: wrap Tab / Shift+Tab within the dialog.
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function confirm(): void {
    if (!canConfirm) return;
    onconfirm();
  }

  // Open behaviour: lock body scroll, move focus into the dialog. Cleanup on close restores both.
  $effect(() => {
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    void tick().then(() => {
      const items = focusables();
      (items[0] ?? dialog)?.focus();
    });
    return () => {
      body.style.overflow = prevOverflow;
      const target = previouslyFocused as HTMLElement | null;
      if (target && target.isConnected) target.focus();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Backdrop: click outside the panel cancels. Keyboard users use Esc (handled above). -->
<div
  class="backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) oncancel();
  }}
>
  <div
    class="panel print-gate ui"
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-labelledby="print-auth-title"
    tabindex="-1"
  >
    <h2 id="print-auth-title">Before you print your how-to-vote plan</h2>
    <p class="pg-lead">
      This how-to-vote plan is published and authorised by {ORG.tradingName}, the operator of
      How2Vote. The preference order on it is your own selection — {ORG.tradingName} does not choose or
      recommend a preference order. National Digital's authorisation is printed on the plan; your numbers
      are shown as your own choice.
    </p>
    <p class="pg-privacy">
      A voting plan is not a ballot paper. Copy your numbers onto the official paper at the polling
      place and follow the AEC's instructions. Nothing you do here is saved to this device or
      uploaded.
    </p>

    <label class="pg-ack">
      <input type="checkbox" bind:checked={ack} />
      <span>
        I understand this plan is authorised by {ORG.tradingName}, the preference order is my own
        selection, and it is not a ballot paper.
      </span>
    </label>

    <div class="pg-actions">
      <button type="button" class="btn" disabled={!canConfirm} onclick={confirm}>
        Print my plan
      </button>
      <button type="button" class="btn ghost" onclick={oncancel}>Cancel</button>
    </div>
  </div>
</div>

<style>
  /* True modal overlay so the print acknowledgement is unmissable and traps focus (a11y).
     Print-hidden — only the worksheet and its authorisation stamp ever print. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: var(--scrim);
    overflow-y: auto;
  }
  .panel {
    width: 100%;
    max-width: 460px;
    max-height: calc(100vh - 40px);
    overflow-y: auto;
    padding: 20px;
    background: var(--raise);
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
  }
  .panel:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  h2 {
    font-size: 18px;
    margin: 0 0 10px;
  }
  .pg-lead,
  .pg-privacy {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.55;
    margin: 0 0 10px;
  }
  .pg-ack {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    font-size: 13px;
    color: var(--ink);
    line-height: 1.45;
    margin: 14px 0;
    cursor: pointer;
  }
  .pg-ack input {
    margin-top: 2px;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
  }
  .pg-actions {
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
  @media print {
    .backdrop {
      display: none !important;
    }
  }
</style>
