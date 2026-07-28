<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { CURRENT_ELECTION_ID } from "@how2vote/data-schema";
  import StoreBadges from "$lib/components/StoreBadges.svelte";
  import { AUTHORISATION, DATA_SOURCE, LICENCES, ORG } from "$lib/org";
  import { consent } from "$lib/privacy/consent.svelte";
  import { hasConfigurableConsent } from "$lib/privacy/registry";
  import { saved } from "$lib/saved.svelte";

  // Hubs for the current election's data-derived pages — the crawl entry points for the long-tail
  // electorate / issue / party pages. Present on every screen so the whole tree is reachable and
  // internally linked from anywhere on the site.
  const e = CURRENT_ELECTION_ID;

  // One-line footer credit on every screen and print: two parallel copyright notices — the
  // application (National Digital, AGPL-3.0) and the vote data (They Vote For You, the minimum ODbL
  // attribution TVFY requires). Both name a holder and link their licence (a licence obligation, not
  // decoration). The data vintage lives on the card itself (where print integrity needs it).

  // The application credit runs from the project's first commit (2019) to the build year, injected
  // at build time (__BUILD_YEAR__, see vite.config.ts) so it reflects when the site was last built
  // — its last change — and never drifts to the visitor's clock. A component-side
  // `new Date().getFullYear()` would re-run in the browser at render time and always read the
  // current year. The vote data predates the site, so it carries no range.
  const currentYear = __BUILD_YEAR__;
</script>

<footer class="ui">
  <!-- Navigation first, then the electoral authorisation and copyright fine print below it. -->
  <p class="links">
    <!-- Grouped by adjacency: understand → browse the data → the org → legal/governance last. -->
    <a href="/methodology">How it works</a>
    <a href="/glossary">Glossary</a>
    <a href="/{e}/issues">Where parties stand</a>
    <a href="/{e}/parties">Party records</a>
    <a href="/{e}/electorates">Candidates</a>
    <a href="/insights">Insights</a>
    <a href="/research">Research methods</a>
    <a href="/corrections">Corrections</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
    <a href="/accessibility">Accessibility</a>
    <a href="/privacy">Privacy policy</a>
    <!-- Withdrawing consent is as easy as giving it: reopen settings any time. Sits with the privacy
         policy it belongs to. Shown only when something is actually consent-gated
         (hasConfigurableConsent) — today nothing is, so the trigger is hidden alongside the banner.
         The always-available /privacy page documents the posture regardless. -->
    {#if hasConfigurableConsent}
      <button type="button" class="cookie-settings" onclick={() => consent.openSettings()}>
        Privacy settings
      </button>
    {/if}
    <a href="/terms">Terms of use</a>
    <!-- A personal, device-local shortcut — shown only once the visitor has saved a card. -->
    {#if saved.hydrated && saved.count > 0}
      <a href="/saved">Saved cards</a>
    {/if}
  </p>
  <!-- Store badges (web channel only, hidden until the listings are live — see store-links.ts). -->
  <StoreBadges />
  <p class="credit">
    ©
    <ExternalLink href={ORG.website}>{ORG.tradingName}</ExternalLink>
    2019–{currentYear} (<ExternalLink href={LICENCES.app.url}>{LICENCES.app.shortName}</ExternalLink
    >) · Vote data ©
    <ExternalLink href={DATA_SOURCE.url}>{DATA_SOURCE.name}</ExternalLink>
    ({DATA_SOURCE.publisher}),
    <ExternalLink href={LICENCES.data.url}>{LICENCES.data.shortName}</ExternalLink>
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
