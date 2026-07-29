<script lang="ts">
  // A glossary word in body copy. Clicking it answers the question WHERE THE READER IS, instead of
  // sending them to the glossary page and leaving them to find their way back — on /card that
  // navigation would abandon a plan the reader is part-way through building.
  //
  // Why a popover and not a tooltip: `title=` is invisible to touch, invisible to keyboards and
  // unstyleable, and a hover-only panel fails the same way on the phones most of this app's
  // readers use — plus WCAG 2.2 SC 1.4.13 wants hover content dismissible and persistent. A
  // click/tap/Enter-activated popover behaves identically on every input, which is the whole point.
  //
  // The anchor stays a REAL link to /glossary#id: the deep links are load-bearing (they are the
  // no-JS fallback, they survive "open in new tab", and other pages cite them). Only a plain
  // primary click is intercepted — the same contract as DocLink.
  import type { Snippet } from "svelte";
  import { glossaryEntry } from "$lib/content/glossary";
  import { modal } from "$lib/modal";

  let { id, children }: { id: string; children: Snippet } = $props();

  const href = $derived(`/glossary#${id}`);

  /**
   * Imported with the component, NOT loaded on click — the opposite of the choice DocLink makes for
   * the policy documents, and measured rather than assumed. The whole term list is 3.7 KB of text;
   * splitting it out cost 0.3 KB MORE in total bytes (a small chunk compresses far worse on its
   * own) to keep ~1.4 KB off a first paint that has already fetched a 29 KB dataset. The document
   * bodies are 8.7 KB and worth splitting; this is not.
   */
  const entry = $derived(glossaryEntry(id));

  let anchor = $state<HTMLAnchorElement | null>(null);
  // HTMLElement, not HTMLSpanElement: the popover API and the measurement below are element-generic,
  // and the tag is a layout/validity choice (see the markup note) that this type should not restate.
  let panel = $state<HTMLElement | null>(null);
  let open = $state(false);
  let release: (() => void) | undefined;

  /**
   * Park the panel under (or over) the word. Native popovers live in the top layer and do not
   * follow their invoker, so this runs again on scroll and resize — a definition that drifts away
   * from the word it defines is worse than one that is not anchored at all.
   */
  function place(): void {
    const el = panel;
    const a = anchor;
    if (!el || !a) return;
    const r = a.getBoundingClientRect();
    // Scrolled out of sight: there is nothing left to anchor to, so stop pretending.
    if (r.bottom < 0 || r.top > window.innerHeight) {
      hide();
      return;
    }
    const gutter = 12;
    const width = Math.min(360, window.innerWidth - gutter * 2);
    el.style.width = `${width}px`;
    const left = Math.min(Math.max(gutter, r.left), window.innerWidth - width - gutter);
    el.style.left = `${left}px`;
    // Below the word by default; above it when the space below cannot hold the panel.
    const h = el.offsetHeight;
    const below = window.innerHeight - r.bottom - gutter;
    el.style.top = below >= h || r.top - gutter < h ? `${r.bottom + 8}px` : `${r.top - h - 8}px`;
  }

  function hide(): void {
    panel?.hidePopover();
  }

  function onclick(event: MouseEvent): void {
    // Anything that is not a plain primary click is the reader asking for the glossary page.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // An id with no matching entry falls through to the page rather than swallowing the click and
    // doing nothing. link-conventions.test.ts makes this unreachable, but the glossary page is
    // always a correct answer and a dead link is never one.
    const el = panel;
    if (!entry || !el) return;
    event.preventDefault();
    el.showPopover();
    place();
    // Enter on the link opens this too, so focus has to land inside, or a keyboard reader would be
    // left with an open panel they can neither read nor close.
    el.focus();
  }

  /**
   * The native `toggle` event is the single source of truth for open/closed: the panel can also be
   * dismissed by Escape or an outside click, neither of which routes through our own code.
   */
  function ontoggle(event: ToggleEvent): void {
    open = event.newState === "open";
    if (open) {
      // Suspend the app's global keyboard shortcuts while this owns the keyboard — the quiz binds
      // bare digits on `window`, and focus is inside the panel.
      release ??= modal.open();
      window.addEventListener("scroll", place, { capture: true, passive: true });
      window.addEventListener("resize", place, { passive: true });
    } else {
      release?.();
      release = undefined;
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
      // Put the reader back on the word they were reading — but ONLY if focus would otherwise be
      // lost. Chromium returns focus to the invoker itself when a popover holding focus closes, so
      // this is a fallback for engines that do not (notably the WKWebView the iOS shell runs in,
      // which the e2e suite never exercises). Guarding on it matters: an unconditional focus()
      // would yank focus back here from whatever the reader clicked to light-dismiss the panel.
      const active = document.activeElement;
      if (!active || active === document.body) anchor?.focus();
    }
  }

  // A popover left open when this unmounts would keep the shortcuts suspended for good.
  $effect(() => () => {
    release?.();
    release = undefined;
    window.removeEventListener("scroll", place, { capture: true });
    window.removeEventListener("resize", place);
  });
</script>

<a bind:this={anchor} {href} class="term" {onclick} aria-expanded={entry ? open : undefined}
  >{@render children()}</a
>

{#if entry}
  <!-- popover="auto": the browser supplies the top layer, light dismiss and Escape. `dialog` (not
       `alertdialog`) because it is non-modal and the page behind stays live and scrollable.
       EVERY element here is a span, deliberately. A glossary term sits inside running prose, so this
       whole subtree is rendered inside a <p>, where the HTML parser treats a <div> (or a nested <p>)
       as an implicit </p>: the paragraph is cut in two and the prose after the term is re-parented
       out of it. That is invalid markup on every prerendered page, it loses the paragraph's styling
       mid-sentence, and it makes hydration bail out and re-render the page client-side. Spans are
       phrasing content, so they nest legally; the block layout is restored in CSS below.
       scripts/check-html-nesting.mjs fails the build if this regresses. -->
  <span
    bind:this={panel}
    popover="auto"
    {ontoggle}
    class="pop"
    role="dialog"
    aria-label="Definition: {entry.term}"
    tabindex="-1"
  >
    <span class="dfn"><strong>{entry.term}</strong> {entry.def}</span>
    <span class="foot">
      <a class="more" {href} onclick={hide}>Full glossary</a>
      <button type="button" class="x" onclick={hide}>Close</button>
    </span>
  </span>
{/if}

<style>
  /* A dotted underline: still unmistakably a link, but distinguished from the solid underline the
     app uses for "this goes somewhere". */
  .term {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }

  .pop {
    position: fixed;
    /* Overridden by place(); these are the pre-measurement values, and the fallback if a browser
       fires no toggle event. */
    inset: auto;
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--raise);
    color: var(--ink);
    box-shadow: 0 6px 24px rgb(0 0 0 / 18%);
    font-family: var(--ui);
  }
  .pop:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  /* Spans by necessity (see the markup note), so the block layout they replace is restored here.
     `.pop` needs no display rule: `position: fixed` blockifies it. */
  .dfn {
    display: block;
    margin: 0;
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink2);
  }
  .dfn strong {
    color: var(--ink);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 6px;
  }
  .more,
  .x {
    font-size: 13px;
    /* A 44px target without a 44px-tall control (WCAG 2.5.8). */
    padding: 12px 2px;
    background: none;
    border: 0;
    cursor: pointer;
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
    font-family: inherit;
  }
  .more:hover,
  .more:focus-visible,
  .x:hover,
  .x:focus-visible {
    color: var(--ink);
  }

  /* Paper has no interaction: the definition is not part of the document being printed. */
  @media print {
    .pop {
      display: none !important;
    }
  }
</style>
