<script lang="ts">
  // A lightweight feedback helper anchored to the paper sheet on every screen. Opens a native
  // <dialog> (built-in focus trap + Escape) with a short message box; posts to Formspree via
  // $lib/formspree. Offline is expected on this PWA and is surfaced as a plain, calm message.
  import { feedbackConfigured, submitFeedback, type SubmitResult } from "$lib/formspree";

  let dialog = $state<HTMLDialogElement | null>(null);
  let name = $state("");
  let email = $state("");
  let message = $state("");
  let status = $state<"idle" | "sending" | SubmitResult>("idle");
  // On a successful send we flash a brief "thanks" then close the dialog automatically. The timer is
  // tracked so a manual close (or Escape) can cancel it and avoid a double close().
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function open(): void {
    status = "idle";
    dialog?.showModal();
  }

  function close(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = undefined;
    dialog?.close();
  }

  function reset(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = undefined;
    name = "";
    email = "";
    message = "";
    status = "idle";
  }

  async function send(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!message.trim() || status === "sending") return;
    status = "sending";
    status = await submitFeedback({
      name,
      email,
      message,
      page: typeof location !== "undefined" ? location.pathname : undefined,
    });
    // Sent: show the confirmation just long enough to be read, then close (reset runs on close).
    if (status === "ok") closeTimer = setTimeout(close, 1400);
  }
</script>

{#if feedbackConfigured}
  <button
    type="button"
    class="fab ui"
    onclick={open}
    aria-haspopup="dialog"
    aria-label="Send feedback"
    title="Send feedback"
  >
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v3.5L11.5 16H20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z"
      />
      <path d="M7.5 9h9" />
      <path d="M7.5 12h6" />
    </svg>
  </button>

  <dialog bind:this={dialog} class="sheet-dialog" aria-labelledby="fb-title" onclose={reset}>
    <div class="head">
      <h2 id="fb-title">Send feedback</h2>
      <button type="button" class="x" onclick={close} aria-label="Close feedback">×</button>
    </div>

    {#if status === "ok"}
      <p class="msg" role="status">Thanks — your feedback is on its way.</p>
      <div class="actions">
        <button type="button" class="btn" onclick={close}>Done</button>
      </div>
    {:else}
      <form onsubmit={send}>
        <label class="ui" for="fb-name">Name <span class="opt">(optional)</span></label>
        <input id="fb-name" type="text" bind:value={name} autocomplete="name" />

        <label class="ui" for="fb-email"
          >Email <span class="opt">(optional, if you'd like a reply)</span></label
        >
        <input id="fb-email" type="email" bind:value={email} autocomplete="email" />

        <label class="ui" for="fb-message">Your feedback</label>
        <textarea
          id="fb-message"
          bind:value={message}
          rows="4"
          required
          placeholder="What's working, what isn't, what's missing?"></textarea>

        {#if status === "offline"}
          <p class="msg warn" role="status">
            You're offline. This page works without a connection, but sending feedback needs one —
            please try again when you're back online.
          </p>
        {:else if status === "error"}
          <p class="msg warn" role="status">
            Sorry, that didn't send. Please check your connection and try again.
          </p>
        {/if}

        <div class="actions">
          <button type="button" class="btn ghost" onclick={close}>Cancel</button>
          <button type="submit" class="btn" disabled={status === "sending" || !message.trim()}>
            {status === "sending" ? "Sending…" : "Send"}
          </button>
        </div>

        <p class="challenge-note">
          Protected by Cloudflare Turnstile; the Cloudflare
          <a
            href="https://www.cloudflare.com/privacypolicy/"
            target="_blank"
            rel="noopener noreferrer">Privacy Policy</a
          >
          and
          <a
            href="https://www.cloudflare.com/website-terms/"
            target="_blank"
            rel="noopener noreferrer">Terms</a
          > apply.
        </p>
      </form>
    {/if}
  </dialog>
{/if}

<style>
  /* A compact circular icon button. On phones it's fixed to the viewport's bottom-right corner as a
     small, unobtrusive affordance (the old wide "✎ Feedback" pill sat over the on-screen controls);
     the icon is deliberately tiny so it clears the left-aligned answer labels beneath it. On wider
     screens the card is a short centred column with a broad margin, so a viewport-fixed button reads
     as floating loose *below* the card — there we anchor it to the card's own bottom-right corner
     instead (the layout renders this inside the `.sheet` positioning context). */
  .fab {
    position: fixed;
    bottom: 14px;
    right: 14px;
    z-index: 20;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    color: var(--on-fill);
    background: var(--ink);
    border: 0;
    border-radius: 999px;
    box-shadow: 0 2px 8px var(--line2);
    cursor: pointer;
  }
  @media (min-width: 720px) {
    .fab {
      position: absolute;
      bottom: 12px;
      right: 12px;
    }
  }
  .fab:hover,
  .fab:focus-visible {
    opacity: 0.92;
  }
  @media print {
    .fab {
      display: none;
    }
  }

  .sheet-dialog {
    width: min(440px, calc(100vw - 32px));
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--raise);
    color: var(--ink);
  }
  /* Two-tone scrim: an ink wash (a dark dim in light mode, a soft frost in dark mode). Kept as a
     token reference so no literal colour is emitted — the neutrality gate forbids raw hues. */
  .sheet-dialog::backdrop {
    background: var(--ink);
    opacity: 0.32;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px 4px;
  }
  h2 {
    font-size: 20px;
  }
  .x {
    width: 32px;
    height: 32px;
    font-size: 22px;
    line-height: 1;
    background: none;
    border: 0;
    color: var(--ink2);
    cursor: pointer;
    border-radius: var(--radius);
  }

  form {
    display: flex;
    flex-direction: column;
    padding: 8px 18px 18px;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink2);
    margin: 12px 0 6px;
  }
  .opt {
    font-weight: 400;
  }
  textarea,
  input {
    font: inherit;
    font-family: var(--ui);
    font-size: 15px;
    color: var(--ink);
    background: var(--paper);
    border: 1.5px solid var(--line2);
    border-radius: var(--radius);
    padding: 10px 12px;
    width: 100%;
    resize: vertical;
  }

  .msg {
    font-family: var(--ui);
    font-size: 14px;
    color: var(--ink2);
    margin: 14px 18px 0;
    line-height: 1.5;
  }
  form .msg {
    margin: 14px 0 0;
  }
  .warn {
    color: var(--ink);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 18px 18px;
  }
  form .actions {
    padding: 16px 0 0;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 18px;
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
    cursor: default;
  }
</style>
