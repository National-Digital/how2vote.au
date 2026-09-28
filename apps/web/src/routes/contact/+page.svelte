<script lang="ts">
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import ContactIntro from "$lib/components/ContactIntro.svelte";
  import { CONTACT_COPY, CONTACT_TITLE } from "$lib/contact-copy";
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

<ContentPage title={CONTACT_TITLE}>
  <ContactIntro />

  {#if status === "ok"}
    <p class="ok" role="status">
      {CONTACT_COPY.sent}
    </p>
  {:else}
    <form onsubmit={send} novalidate>
      <label class="ui" for="c-name">{CONTACT_COPY.name}</label>
      <input id="c-name" type="text" bind:value={name} autocomplete="name" required />

      <label class="ui" for="c-email">{CONTACT_COPY.email}</label>
      <input id="c-email" type="email" bind:value={email} autocomplete="email" required />

      <label class="ui" for="c-message">{CONTACT_COPY.message}</label>
      <textarea id="c-message" bind:value={message} rows="6" required></textarea>

      {#if status === "offline"}
        <p class="note warn ui" role="status">
          {CONTACT_COPY.offline}
        </p>
      {:else if status === "error"}
        <p class="note warn ui" role="status">
          {CONTACT_COPY.error}
        </p>
      {/if}

      <button type="submit" class="btn ui" disabled={!canSend}>
        {status === "sending" ? CONTACT_COPY.sending : CONTACT_COPY.send}
      </button>

      <p class="challenge-note">
        {CONTACT_COPY.challenge}
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
