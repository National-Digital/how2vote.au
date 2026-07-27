<script lang="ts">
  import { tick } from "svelte";
  import { consent } from "$lib/privacy/consent.svelte";
  import {
    servicesForCategory,
    visibleCategories,
    type ConsentCategory,
    type ConsentState,
  } from "$lib/privacy/registry";

  // Local, editable copy of the decision, seeded from the committed state. The
  // modal mounts fresh each time it opens, so this always reflects the current
  // choice without any re-seed effect. Strictly-necessary is shown always-on;
  // consent-required categories get a toggle (off by default before any choice).
  let draft = $state<ConsentState>({ ...consent.state });

  let dialog = $state<HTMLElement | null>(null);
  const previouslyFocused = typeof document !== "undefined" ? document.activeElement : null;

  function toggle(id: ConsentCategory): void {
    draft = { ...draft, [id]: !draft[id] };
  }

  function focusables(): HTMLElement[] {
    if (!dialog) return [];
    return Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      consent.closeSettings();
      return;
    }
    if (event.key !== "Tab") return;
    // Focus trap: wrap Tab / Shift+Tab within the dialog.
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Open behaviour: lock body scroll, move focus into the dialog. Cleanup on
  // close restores both. Runs once because the component only exists while open.
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

<!-- Backdrop: click outside the panel closes. Keyboard users use Esc (handled above). -->
<div
  class="backdrop"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) consent.closeSettings();
  }}
>
  <div
    class="panel ui"
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-labelledby="consent-settings-title"
    tabindex="-1"
  >
    <header>
      <h2 id="consent-settings-title">Privacy preferences</h2>
      <button
        type="button"
        class="close"
        aria-label="Close preferences"
        onclick={() => consent.closeSettings()}>×</button
      >
    </header>

    <p class="intro">
      Choose what How2Vote may use. Strictly necessary items keep the tool working and are always
      on. Everything else is off unless you turn it on, and your choice never changes your card.
    </p>

    <ul class="cats">
      {#each visibleCategories as category (category.id)}
        {@const catServices = servicesForCategory(category.id)}
        <li class="cat">
          <div class="cat-head">
            <label class="cat-label" for={`consent-${category.id}`}>{category.label}</label>
            {#if category.consentRequired}
              <input
                id={`consent-${category.id}`}
                type="checkbox"
                checked={Boolean(draft[category.id])}
                onchange={() => toggle(category.id)}
                aria-label={`Allow ${category.label.toLowerCase()}`}
              />
            {:else}
              <span class="always">Always active</span>
            {/if}
          </div>
          <p class="cat-desc">{category.description}</p>
          {#if catServices.length > 0}
            <ul class="services">
              {#each catServices as service (service.id)}
                <li>
                  <span class="svc-name">{service.name}</span>
                  <span class="svc-desc">{service.purpose}</span>
                  <a href={service.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
                    {service.provider} privacy policy<span aria-hidden="true"> ↗</span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>

    <footer>
      <button type="button" class="btn ghost" onclick={() => consent.rejectAll()}>Reject all</button
      >
      <button type="button" class="btn ghost" onclick={() => consent.acceptAll()}>Accept all</button
      >
      <button type="button" class="btn" onclick={() => consent.savePreferences(draft)}
        >Save choices</button
      >
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: var(--scrim);
    padding: 0;
  }
  .panel {
    width: 100%;
    max-width: var(--sheet);
    max-height: 90dvh;
    overflow-y: auto;
    background: var(--raise);
    border-top-left-radius: 14px;
    border-top-right-radius: 14px;
    padding: 18px var(--gutter) calc(18px + env(safe-area-inset-bottom, 0px));
  }
  @media (min-width: 720px) {
    .backdrop {
      align-items: center;
    }
    .panel {
      border-radius: 14px;
      max-height: 84dvh;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  h2 {
    font-family: var(--ui);
    font-size: 18px;
    font-weight: 700;
  }
  .close {
    background: none;
    border: 0;
    font-size: 26px;
    line-height: 1;
    color: var(--ink2);
    cursor: pointer;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .intro {
    font-size: 13px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 0 0 14px;
  }
  .cats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cat {
    border-top: 1px solid var(--line);
    padding: 14px 0;
  }
  .cat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .cat-label {
    font-size: 14.5px;
    font-weight: 700;
    color: var(--ink);
  }
  .always {
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink3);
  }
  input[type="checkbox"] {
    /* WCAG 2.2 SC 2.5.8 Target Size (Minimum): 24×24 (the row label is associated by `for=`, a
       separate box, so the checkbox must meet the size on its own). */
    width: 24px;
    height: 24px;
    accent-color: var(--ink);
    cursor: pointer;
    flex: 0 0 auto;
  }
  .cat-desc {
    font-size: 12.5px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 6px 0 0;
  }
  .services {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .services li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 12px;
    border-left: 1.5px solid var(--line);
  }
  .svc-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .svc-desc {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.45;
  }
  .services a {
    font-size: 12px;
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
    width: fit-content;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1.5px solid var(--rule);
  }
  .btn {
    flex: 1 1 auto;
    min-height: 46px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-size: 14px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
    padding: 0 14px;
  }
  .btn.ghost {
    background: transparent;
    color: var(--ink);
    border: 1.5px solid var(--rule);
  }

  @media print {
    .backdrop {
      display: none !important;
    }
  }
</style>
