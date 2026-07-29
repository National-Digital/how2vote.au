<script lang="ts">
  // A reference document shown OVER the current page instead of navigating to it.
  //
  // Used where following a link would abandon a decision in progress — the consent banner and the
  // Terms gate both link to a policy page. This is not a general ban on navigation: the footer's
  // links still navigate, and the URLs stay real. `href` is a genuine link, so middle-click,
  // ⌘/Ctrl-click and "open in new tab" all work, and the dialog carries its own link to the full
  // page. Play requires a reachable privacy-policy URL and the compliance register cites these
  // pages by path, so they must stay linkable and printable.
  import type { Snippet } from "svelte";
  import { modal } from "$lib/modal";

  let {
    title,
    href,
    onclose,
    children,
  }: { title: string; href: string; onclose: () => void; children: Snippet } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  const titleId = $derived(`doc-dialog-${title.replace(/\W+/g, "-").toLowerCase()}`);

  /**
   * Every way out goes through the dialog's own close(), never straight to `onclose`.
   *
   * `onclose` unmounts this component, which removes the <dialog> from the DOM rather than closing it
   * while connected — so the browser's "restore focus to the previously focused element" step never
   * runs and focus falls to <body>. Escape is unaffected because it is already a native close: focus
   * is restored before the `close` event calls `onclose`. Routing × and Done through close() gives
   * them the same sequence, so every exit returns focus to the invoker (WCAG 2.2 SC 2.4.3).
   */
  function requestClose(): void {
    const el = dialog;
    if (el?.open) el.close();
    else onclose();
  }

  $effect(() => {
    const el = dialog;
    if (!el) return;
    // showModal(), not the `open` attribute: it is what supplies the focus trap, the inert
    // background and Escape-to-close, none of which we should hand-roll.
    if (!el.open) el.showModal();
    // Suspend the app's global keyboard shortcuts while this is up — key events still reach
    // `window` from inside a modal dialog, so the quiz would answer questions behind it.
    const release = modal.open();
    return () => {
      release();
      if (el.open) el.close();
    };
  });
</script>

<dialog bind:this={dialog} class="doc" aria-labelledby={titleId} {onclose}>
  <div class="head">
    <h2 id={titleId}>{title}</h2>
    <button type="button" class="x" onclick={requestClose} aria-label="Close {title}">×</button>
  </div>

  <!-- The document itself, scrollable. `.prose` is the same global class the route uses, so this is
       the page's typography, not a second look for the same words. -->
  <div class="body prose">
    {@render children()}
  </div>

  <div class="foot">
    <!-- A way out to the real page, for anyone who wants the URL, the print view, or to leave the
         flow deliberately. A same-tab navigation, deliberately: opening a new tab from here would,
         inside the native shells, hand the document to the system browser and drop the reader out
         of the app entirely — a stranger outcome than the navigation they asked for. -->
    <a class="full" {href}>Open the full page</a>
    <button type="button" class="btn" onclick={requestClose}>Done</button>
  </div>
</dialog>

<style>
  .doc {
    /* Near-full-screen on a phone, a tall centred sheet on a wide screen: this is a long document,
       and a small box would make it unreadable in exactly the situation it is raised for. */
    width: min(680px, calc(100vw - 24px));
    max-width: 100%;
    height: min(88dvh, calc(100dvh - 24px));
    max-height: none;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--raise);
    color: var(--ink);
    /* The sheet owns the safe-area insets: a dialog is viewport-positioned, so the page's own
       padding does not reach it and its edges would sit under the system bars on a device. */
    margin: auto;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .doc::backdrop {
    background: var(--scrim);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: calc(12px + var(--safe-top)) 14px 10px 18px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    font-size: 18px;
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .x {
    flex: none;
    width: 44px;
    height: 44px;
    font-size: 24px;
    line-height: 1;
    background: none;
    border: 0;
    color: var(--ink2);
    cursor: pointer;
    border-radius: var(--radius);
  }

  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-left: calc(var(--gutter) + var(--safe-left));
    padding-right: calc(var(--gutter) + var(--safe-right));
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px calc(12px + var(--safe-bottom));
    border-top: 1px solid var(--line);
    font-family: var(--ui);
  }
  .full {
    color: var(--ink2);
    font-size: 13px;
    text-decoration: underline;
    text-underline-offset: 3px;
    /* 44px target without a 44px-tall visual link (WCAG 2.5.8). */
    padding: 12px 4px;
  }
  .full:hover,
  .full:focus-visible {
    color: var(--ink);
  }
  .btn {
    min-height: 44px;
    padding: 0 20px;
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--on-fill);
    font-family: var(--ui);
    font-size: 15px;
    font-weight: 600;
    border: 0;
    cursor: pointer;
  }

  @media print {
    .doc {
      display: none !important;
    }
  }
</style>
