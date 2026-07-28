<script lang="ts">
  import { consent } from "$lib/privacy/consent.svelte";
  import DocLink from "./DocLink.svelte";

  // "Reject" and "Accept" share the same button variant, so declining is never
  // harder or quieter than accepting, and nothing is pre-selected. A quieter
  // "Manage" opens the granular preferences modal.

  let el = $state<HTMLElement | null>(null);

  // The banner is fixed to the bottom of the viewport, so it would sit on top of
  // any bottom-anchored content (the landing CTA, the card's action buttons).
  // Publish its live height as --consent-banner-h; the sheet reserves exactly
  // that much padding (see app.css) so nothing is ever obscured. Cleared on
  // destroy, so once a choice is made the space is reclaimed.
  $effect(() => {
    if (!el) return;
    const root = document.documentElement;
    const set = (): void => root.style.setProperty("--consent-banner-h", `${el!.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    // border-box, NOT the default content-box. This banner's height changes for two reasons: the
    // copy rewraps, and the gesture-bar inset it carries in its own bottom padding changes. A
    // content-box observer sees only the first, so on an edge-to-edge device it would publish a
    // height short by exactly the inset — under-reserving by the amount the reservation exists for.
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty("--consent-banner-h");
    };
  });
</script>

<!-- A non-modal (aria-modal="false") labelled dialog: it does not steal focus on load, but it is a
     labelled, keyboard-operable dialog (the a11y suite asserts it is reachable and operable without a
     mouse), which is what the "receives focus" concern needs — not a focus trap. -->
<div
  bind:this={el}
  class="banner ui"
  role="dialog"
  aria-modal="false"
  aria-labelledby="consent-title"
  aria-describedby="consent-desc"
>
  <div class="inner">
    <div class="copy">
      <h2 id="consent-title">Your privacy choices</h2>
      <p id="consent-desc">
        A few optional features can be switched on below. They stay off until you choose, store
        nothing on your device until then, and never affect your card. See our
        <!-- Opens over this banner rather than navigating: this is a decision surface, and
             navigating away would abandon the decision with no way back. -->
        <DocLink href="/privacy">privacy notice</DocLink> for what each one does.
      </p>
    </div>
    <div class="actions">
      <button type="button" class="link" onclick={() => consent.openSettings()}>Manage</button>
      <button type="button" class="btn" onclick={() => consent.rejectAll()}>Reject</button>
      <button type="button" class="btn" onclick={() => consent.acceptAll()}>Accept</button>
    </div>
  </div>
</div>

<style>
  .banner {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    background: var(--raise);
    border-top: 1.5px solid var(--rule);
    box-shadow: 0 -2px 18px var(--line);
  }
  .inner {
    max-width: var(--sheet);
    margin: 0 auto;
    padding: 16px var(--gutter) calc(16px + var(--safe-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 {
    font-family: var(--ui);
    font-size: 14px;
    font-weight: 700;
    margin: 0 0 6px;
    color: var(--ink);
  }
  p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink2);
  }
  /* :global because the anchor now belongs to DocLink — Svelte's scoping class is not applied
     across a component boundary, so a bare `a` selector here would silently stop matching and the
     link would lose its underline. */
  .copy :global(a) {
    color: var(--ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn {
    flex: 1;
    min-height: 46px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-size: 14px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
  }
  .link {
    background: none;
    border: 0;
    color: var(--ink2);
    font-size: 13px;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    padding: 8px 4px;
    margin-right: auto;
  }
  .link:hover,
  .link:focus-visible {
    color: var(--ink);
  }

  @media print {
    .banner {
      display: none !important;
    }
  }
</style>
