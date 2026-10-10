<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { DIST_CHANNEL } from "$lib/channel";
  import { STORE_LINKS } from "$lib/store-links";

  // Official, unmodified store badges. Apple's and Google's brand rules both require the stock
  // artwork; F-Droid's badge is CC-BY-SA-3.0, and any modified version must carry that licence, so
  // it is used unmodified too. All three designs are dark panels with a white keyline, legible on
  // the light and dark schemes alike, so one asset serves both modes. Rendered on the WEB channel
  // only, and each badge only once its own listing URL exists (store-links.ts) — a channel that is
  // not published yet advertises nothing.
  const show =
    DIST_CHANNEL === "web" && (STORE_LINKS.appStore || STORE_LINKS.playStore || STORE_LINKS.fDroid);
</script>

{#if show}
  <div class="badges">
    <p class="get ui">Also available as an app:</p>
    <p class="row">
      {#if STORE_LINKS.appStore}
        <ExternalLink href={STORE_LINKS.appStore} icon={false}>
          <img src="/badges/app-store.svg" alt="Download on the App Store" height="40" />
        </ExternalLink>
      {/if}
      {#if STORE_LINKS.playStore}
        <ExternalLink href={STORE_LINKS.playStore} icon={false}>
          <img
            class="padded"
            src="/badges/google-play.png"
            alt="Get it on Google Play"
            height="40"
          />
        </ExternalLink>
      {/if}
      {#if STORE_LINKS.fDroid}
        <ExternalLink href={STORE_LINKS.fDroid} icon={false}>
          <img class="padded" src="/badges/f-droid.svg" alt="Get it on F-Droid" height="40" />
        </ExternalLink>
      {/if}
    </p>
    <!-- Required brand attributions for the badge artwork — each names the marks the badge above
         actually carries. Plain descriptive statements; this project itself claims no registered
         marks (see BRAND.md), and no registration symbol appears anywhere (check-brand-trademark).
         Badge provenance and terms: THIRD-PARTY-NOTICES.md. -->
    <p class="marks ui">
      {#if STORE_LINKS.appStore}App Store and the App Store logo are trademarks of Apple Inc.{/if}
      {#if STORE_LINKS.playStore}Google Play and the Google Play logo are trademarks of Google LLC.{/if}
      <!-- F-Droid's badge is CC-BY-SA-3.0, so the credit given is the licence rather than a mark
           attribution. -->
      {#if STORE_LINKS.fDroid}The F-Droid logo is used under CC-BY-SA-3.0.{/if}
    </p>
  </div>
{/if}

<style>
  .badges {
    text-align: center;
    margin: 0 0 14px;
  }
  .get {
    font-size: 11px;
    color: var(--ink3);
    margin: 0 0 8px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    justify-content: center;
    align-items: center;
    margin: 0 0 6px;
  }
  /* 40px is Apple's minimum on-screen badge height; the link carries a 44px target (WCAG 2.5.5). */
  .row :global(a) {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    text-decoration: none;
    overflow: hidden;
  }
  img {
    height: 40px;
    width: auto;
    display: block;
  }
  /* The Google Play and F-Droid artwork sits inside a transparent 41px margin on a 646x250 canvas
     (visible 564x168). Scale so the visible artwork matches the App Store badge's 40px, then
     cancel the margin so the files stay unmodified. */
  img.padded {
    height: calc(40px * 250 / 168);
    margin: calc(40px * -41 / 168);
  }
  .marks {
    font-size: 9.5px;
    color: var(--ink3);
    margin: 0;
  }
</style>
