<script lang="ts">
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { submitContact, type SubmitResult } from "$lib/forms";

  let name = $state("");
  let email = $state("");
  let message = $state("");
  let status = $state<"idle" | "sending" | SubmitResult>("idle");

  const canSend = $derived(
    Boolean(name.trim() && email.trim() && message.trim()) && status !== "sending",
  );

  async function send(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSend) return;
    status = "sending";
    status = await submitContact({ name, email, message });
    if (status === "ok") {
      name = "";
      email = "";
      message = "";
    }
  }
</script>

<Meta />

<ContentPage title="Contact">
  <p>
    Questions, corrections, or something not working? Send us a message and we'll get back to you.
    For a quick note on any screen you can also use the <strong>Feedback</strong> button.
  </p>

  {#if status === "ok"}
    <p class="ok" role="status">
      Thanks for getting in touch — your message has been sent. If you left an email, we'll reply
      there.
    </p>
  {:else}
    <form onsubmit={send} novalidate>
      <label class="ui" for="c-name">Name</label>
      <input id="c-name" type="text" bind:value={name} autocomplete="name" required />

      <label class="ui" for="c-email">Email</label>
      <input id="c-email" type="email" bind:value={email} autocomplete="email" required />

      <label class="ui" for="c-message">Message</label>
      <textarea id="c-message" bind:value={message} rows="6" required></textarea>

      {#if status === "offline"}
        <p class="note warn ui" role="status">
          You're offline. This site works without a connection, but sending a message needs one —
          please try again once you're back online.
        </p>
      {:else if status === "error"}
        <p class="note warn ui" role="status">
          Sorry, that didn't send. Please check your connection and try again.
        </p>
      {/if}

      <button type="submit" class="btn ui" disabled={!canSend}>
        {status === "sending" ? "Sending…" : "Send message"}
      </button>

      <p class="challenge-note">
        This form is protected by a privacy-preserving anti-spam check computed on your device — no
        third-party CAPTCHA or tracker is loaded. Your message is sent to us by email through our
        hosting provider and is not stored by this site.
      </p>
    </form>
  {/if}
</ContentPage>

<style>
  form {
    display: flex;
    flex-direction: column;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink2);
    margin: 16px 0 6px;
  }
  input,
  textarea {
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
  .note {
    font-size: 14px;
    line-height: 1.5;
    margin: 16px 0 0;
  }
  .warn {
    color: var(--ink);
  }
  .ok {
    color: var(--ink);
  }
  .btn {
    align-self: flex-start;
    margin-top: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 22px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-size: 15px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
