<script lang="ts">
  // A link that opens in a new tab, and says so before you click it.
  //
  // Two audiences, one cue:
  //   - the ↗ glyph, for anyone scanning the page;
  //   - visually-hidden text inside the accessible name, so a screen reader announces "… (opens in
  //     a new tab), link" rather than dropping the reader into an unexplained new context (WCAG
  //     3.2.5). It is inside the <a> deliberately — a sibling would not be part of the name.
  //
  // The wording is channel-aware, because the behaviour is. On the web a new tab is exactly what
  // happens. In the Capacitor shells this opens an IN-APP browser instead (see below), which is
  // neither a tab nor leaving the app, so the cue says what it is.
  // Same-origin targets (the release manifest) stay a new tab on every channel.
  //
  // link-conventions.test.ts fails the build if a raw target="_blank" appears anywhere else,
  // so a link cannot quietly go back to being unannounced.
  import type { Snippet } from "svelte";
  import { inAppBrowserFor, isNativeShell } from "$lib/channel";

  let {
    href,
    class: className = "",
    rel = "",
    icon = true,
    ariaLabel = "",
    children,
  }: {
    href: string;
    /** Forwarded to the anchor, so call sites keep their own styling hooks. */
    class?: string;
    /** Extra rel tokens (e.g. "external" for URLs that do not exist at prerender time). */
    rel?: string;
    /** Set false where a visible glyph would be wrong — inside an image link, say. */
    icon?: boolean;
    /**
     * An accessible name that REPLACES the link text. Pass it here rather than putting aria-label
     * on a call site: aria-label overrides everything inside the element, so a hidden cue span
     * would simply not be announced. This appends the cue to the label instead.
     */
    ariaLabel?: string;
    children: Snippet;
  } = $props();

  const offOrigin = $derived(/^[a-z]+:\/\//i.test(href));
  const cue = $derived(
    offOrigin && isNativeShell ? "opens in an in-app browser" : "opens in a new tab",
  );
  const relValue = $derived(
    ["noopener", "noreferrer", ...rel.split(/\s+/).filter(Boolean)].join(" "),
  );
  const label = $derived(ariaLabel ? `${ariaLabel} (${cue})` : undefined);

  /**
   * In the shells, open the page over the app instead of handing it to the system browser.
   *
   * `inAppBrowserFor` is null on the web, null when the plugin is unregistered, and null for a URL
   * an in-app browser must not be given (`market://`, `mailto:`, a relative path). That is a
   * NARROWER test than `offOrigin` above: a store URL is off-origin so it earns the cue, but it is
   * an OS handoff and routing it into a browser view would make the tap do nothing.
   *
   * The cue derives from the CHANNEL, not from whether the plugin answers, because a registered
   * shell always has it; the null branch is defence in depth and falls back to a plain new tab.
   */
  function onclick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const browser = inAppBrowserFor(href);
    if (!browser) return;
    event.preventDefault();
    // A rejection here would otherwise swallow the click entirely — the reader tapped a link and
    // nothing happened. Fall back to the pre-plugin behaviour rather than to silence.
    void browser.open({ url: href }).catch(() => {
      window.open(href, "_blank", "noopener,noreferrer");
    });
  }
</script>

<a {href} class={className} target="_blank" rel={relValue} aria-label={label} {onclick}
  >{@render children()}{#if icon}<span class="ext" aria-hidden="true">&nbsp;↗</span
    >{/if}{#if !label}<span class="visually-hidden"> ({cue})</span>{/if}</a
>

<style>
  /* Keeps the glyph from being mistaken for part of the link text, and stops it wrapping onto a
     line of its own. */
  .ext {
    font-size: 0.85em;
    line-height: 1;
    white-space: nowrap;
  }
</style>
