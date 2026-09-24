<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import StoreBadges from "$lib/components/StoreBadges.svelte";
  import { consent } from "$lib/privacy/consent.svelte";
  import { hasConfigurableConsent } from "$lib/privacy/registry";
  import { saved } from "$lib/saved.svelte";
  import { AUTHORISATION, footerCredit, footerLinks } from "$lib/site-chrome";

  // The links, credit and authorisation are shared with the iOS native core (site-chrome.ts), so the
  // two renderings cannot drift. The credit runs to the build year (__BUILD_YEAR__, vite.config.ts),
  // never the visitor's clock.
  const links = $derived(footerLinks(saved.hydrated ? saved.count : 0));
  const credit = footerCredit(__BUILD_YEAR__);
</script>

<footer class="ui">
  <!-- Navigation first, then the electoral authorisation and copyright fine print below it. -->
  <p class="links">
    {#each links as link (link.href)}
      <a href={link.href}>{link.label}</a>
      <!-- Withdrawing consent is as easy as giving it, so the settings sit with the privacy policy.
           Shown only when something is actually consent-gated (hasConfigurableConsent). -->
      {#if link.href === "/privacy" && hasConfigurableConsent}
        <button type="button" class="cookie-settings" onclick={() => consent.openSettings()}>
          Privacy settings
        </button>
      {/if}
    {/each}
  </p>
  <!-- Store badges (web channel only, hidden until the listings are live — see store-links.ts). -->
  <StoreBadges />
  <p class="credit">
    {#each credit as part, i (i)}{#if part.href}<ExternalLink href={part.href}
          >{part.text}</ExternalLink
        >{:else}{part.text}{/if}{/each}
  </p>
  <!-- Electoral authorisation for the site and the comparison content National Digital publishes
       (Commonwealth Electoral Act 1918 s 321D). Town + state only, no street address. Shown on every
       screen. It covers only what National Digital publishes; a user-authored voting plan carries the
       voter's OWN s321D authorisation, entered before print and stamped on the printed page (see
       docs/adr/0010) — the site footer is print-hidden, so the two authorisations never collide. -->
  <p class="auth">{AUTHORISATION}</p>
</footer>

<style>
  footer {
    /* Bottom padding reserves room for the fixed feedback button (40px, ~14px inset, bottom-right)
       so it never overlaps a footer link or the authorisation — WCAG 2.5.8 / 2.4.11. */
    padding: 18px var(--gutter) 56px;
    border-top: 1px solid var(--line);
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink3);
    text-align: center;
  }
  p {
    margin: 0 0 6px;
  }
  /* The electoral authorisation must be legible, not buried — slightly stronger than the credit
     line, and it stays visible on the printed card and share pages. */
  .auth {
    font-size: 11px;
    color: var(--ink2);
  }
  /* Fine-print scale so the whole credit — minimum ODbL attribution plus the National Digital
     credit — stays on a single line down to typical phone widths. */
  .credit {
    font-size: 10.5px;
    letter-spacing: -0.005em;
  }
  .links {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
    /* Separate the menu from the authorisation + copyright fine print below it. */
    margin-bottom: 18px;
  }
  a,
  .cookie-settings {
    color: var(--ink2);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* WCAG 2.2 SC 2.5.8 Target Size (Minimum): the nav links sit 16px apart (< 24px), so the spacing
     exception does not rescue them — give each a 24px-tall hit area without changing the type. Only
     the .links row and the cookie-settings button; the inline .auth/.credit links are exempt (inline
     in sentence prose). */
  .links a,
  .cookie-settings {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }
  a:hover,
  a:focus-visible,
  .cookie-settings:hover,
  .cookie-settings:focus-visible {
    color: var(--ink);
  }
  .cookie-settings {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
</style>
