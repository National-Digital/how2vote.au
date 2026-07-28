<script lang="ts">
  // The authorisation that travels with the plan's PIXELS.
  //
  // The s321D stamp and the archived watermark are `@media print` only, and printing is gated on
  // the acknowledgement — which covers paper but leaves screenshots. Screen capture cannot be
  // intercepted on the web, and platform flags like Android's FLAG_SECURE cover one channel only,
  // so the only lever available on all three is what the captured pixels say.
  //
  // Hence a band fixed to the viewport for as long as the plan is on screen: whatever part of the
  // plan someone captures, the authorisation is in the frame with it.
  //
  // Both strings are single-sourced with the printed stamp and the site footer (org.ts /
  // print-auth.ts), so the screen, the page and the store listing can never state different
  // particulars — the golden-output test pins the wording.
  import { AUTHORISATION } from "$lib/org";
  import { PREFERENCE_SOURCE_NOTICE } from "$lib/print-auth";

  let { archived = false }: { archived?: boolean } = $props();

  let el = $state<HTMLElement | null>(null);

  // Publish the live height as --plan-auth-h, exactly as the consent banner does with
  // --consent-banner-h: the band is viewport-fixed, so without a reservation it would cover the
  // last rows of the ballot and any control revealed by a forward Tab (WCAG 2.2 SC 2.4.11). The
  // height is MEASURED rather than assumed because this text wraps to three or four lines on a
  // narrow phone and more again under a large minimum font size. Cleared on destroy, so leaving
  // the build stage reclaims the space.
  $effect(() => {
    if (!el) return;
    const root = document.documentElement;
    const set = (): void => root.style.setProperty("--plan-auth-h", `${el!.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    // border-box, NOT the default content-box. The height changes both when the text rewraps
    // (content-box) and when the safe-area inset carried in its own padding changes (padding-box
    // only); a content-box observer misses the second entirely and under-reserves by exactly the
    // inset, which is the case the reservation exists for.
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty("--plan-auth-h");
    };
  });
</script>

<div bind:this={el} class="band ui" role="note" aria-label="Authorisation for this voting plan">
  {#if archived}
    <!-- The print watermark's on-screen counterpart. Deliberately NOT the rotated diagonal overlay
         used on paper: over a live, interactive ballot that would sit across the very numbers the
         voter is reading and typing, and it would have to be faint enough to see through — which
         is exactly when it stops being legible in a screenshot. A solid line at the top of the
         band is unmissable in a capture and costs the voter nothing. -->
    <p class="marker">Historical example — not valid for voting</p>
  {/if}
  <p class="auth">{AUTHORISATION} {PREFERENCE_SOURCE_NOTICE}</p>
</div>

<style>
  .band {
    position: fixed;
    left: 0;
    right: 0;
    /* Sits directly above the consent banner while that is live, rather than under it. Both are
       viewport-fixed, and the banner is the more urgent of the two. */
    bottom: var(--consent-banner-h, 0px);
    /* Below the consent banner (20) and the feedback button (20) — an authorisation notice should
       never be what covers a control — but above the page content. */
    z-index: 19;
    background: var(--raise);
    border-top: 1px solid var(--rule);
    /* The band's own bottom inset: it is the last thing above the gesture bar / home indicator. */
    padding: 8px var(--gutter) calc(8px + var(--safe-bottom));
    padding-left: calc(var(--gutter) + var(--safe-left));
    padding-right: calc(var(--gutter) + var(--safe-right));
    text-align: center;
  }
  p {
    margin: 0;
    max-width: var(--sheet);
    margin-inline: auto;
    /* The legal name is long and unbreakable in places; wrapping is always better than a line that
       runs off the side of a screenshot. */
    overflow-wrap: anywhere;
  }
  /* Same scale and colour as the site footer's authorisation (Footer.svelte) — legible fine print,
     not buried. */
  .auth {
    font-size: 11px;
    line-height: 1.4;
    color: var(--ink2);
  }
  .marker {
    font-size: 11.5px;
    font-weight: 700;
    line-height: 1.4;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--ink);
    margin-bottom: 2px;
  }
  /* Print has its own stamp and its own watermark, rendered once at the end of the document and
     gated on the acknowledgement. A viewport-fixed band would repeat on every printed page and
     collide with both. */
  @media print {
    .band {
      display: none !important;
    }
  }
</style>
