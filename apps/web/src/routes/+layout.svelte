<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { env } from "$env/dynamic/public";
  import { CURRENT_ELECTION_ID, electionById } from "@how2vote/data-schema";
  import FeedbackWidget from "$lib/components/FeedbackWidget.svelte";
  import Footer from "$lib/components/Footer.svelte";
  import JsonLd from "$lib/components/JsonLd.svelte";
  import ConsentBanner from "$lib/components/ConsentBanner.svelte";
  import ConsentSettings from "$lib/components/ConsentSettings.svelte";
  import { ageGate } from "$lib/age.svelte";
  import { election } from "$lib/election.svelte";
  import { quiz } from "$lib/quiz.svelte";
  import { saved } from "$lib/saved.svelte";
  import { theme } from "$lib/theme.svelte";
  import { consent } from "$lib/privacy/consent.svelte";
  import { hasConfigurableConsent } from "$lib/privacy/registry";
  import { registerWebmcpTools } from "$lib/webmcp";

  let { children } = $props();

  // The age-first gate (docs/adr/0011, as amended by docs/adr/0012) precedes every route that creates or
  // exposes quiz / answer / research / share / print state, in two tiers:
  //   - EXPLORE — the quiz + comparison (an educational result). Open to an adult OR an under-18 who
  //     chose to explore (ageGate.canExplore). `/card` is here so under-18s reach the COMPARE stage;
  //     the BUILD/print/share/save chokepoints inside it are gated separately on ageGate.canVote.
  //   - ADULT_ONLY — building/saving a how-to-vote plan and the research survey. 18+ only
  //     (ageGate.canVote). An under-18 never reaches these: no card, no research.
  // Anything not permitted for the visitor's capability is redirected to /start. Fail-closed and
  // centralised; the per-action gate on /card is defence-in-depth behind this.
  const EXPLORE_ROUTES = new Set(["/ballot", "/quiz", "/review", "/card"]);
  const ADULT_ONLY_ROUTES = new Set(["/survey", "/saved"]);

  // PR-preview deploys build with PUBLIC_NOINDEX=1 so the pr-N.*.pages.dev
  // previews are never indexed. Production (how2vote.au) builds without it.
  const noindex = env.PUBLIC_NOINDEX === "1";

  // Offline-PWA update prompt. The service worker no longer activates a new build mid-session (it
  // would strand an in-flight quiz), so we surface a reload prompt when a new version has installed
  // and is waiting, and apply it only on the user's action.
  let swUpdateReady = $state(false);
  function applyUpdate(): void {
    void navigator.serviceWorker
      ?.getRegistration()
      .then((reg) => reg?.waiting?.postMessage("SKIP_WAITING"));
  }

  onMount(() => {
    theme.hydrate();
    saved.hydrate();
    // Read the one-bit age-eligibility acknowledgement before the guard below can act on it, so a
    // returning adult resumes without re-declaring and a fresh device fails closed to the gate.
    ageGate.hydrate();
    // Hydrate the consent store from the device. Usage is now measured by cookieless Cloudflare Web
    // Analytics at the edge (no gtag, no cookie, no client tag), so there is nothing to consent to
    // by default and the banner stays hidden (see hasConfigurableConsent below). The store and its UI
    // are kept intact and dormant so a future consent-gated service is a one-line registry edit, not
    // a rebuild; hydrate() still reads any prior decision so it is honoured the moment that happens.
    consent.hydrate();
    // Expose the read-only WebMCP tools to any browser AI agent. No-op where the API is absent, and
    // it never loads a dataset until a tool is actually invoked, so it stays off the LCP path.
    registerWebmcpTools();

    // Watch for a waiting service-worker update and reload once the user applies it.
    if ("serviceWorker" in navigator) {
      let reloading = false;
      // Whether a worker already controls this page at load. On the very first visit the newly
      // installed worker claims control and fires `controllerchange` — that is NOT an update and
      // must not reload the page (doing so reloads every first-time visit and breaks in-flight
      // navigation). Only reload when a controller was already present, i.e. an update took over.
      const hadController = navigator.serviceWorker.controller !== null;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });
      const controlled = (): boolean => navigator.serviceWorker.controller !== null;
      void navigator.serviceWorker.getRegistration().then((reg) => {
        if (!reg) return;
        if (reg.waiting && controlled()) swUpdateReady = true;
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && controlled()) swUpdateReady = true;
          });
        });
      });
    }

    // Keep the display awake while a page is open so long-form reading isn't cut short by the screen
    // dimming. Progressive enhancement; the platform drops the lock whenever the tab is hidden.
    if ("wakeLock" in navigator) {
      let sentinel: WakeLockSentinel | null = null;
      const acquire = async (): Promise<void> => {
        // Only succeeds while visible; a denied lock (e.g. low battery) must never break the page.
        if (document.visibilityState !== "visible") return;
        try {
          sentinel = await navigator.wakeLock.request("screen");
        } catch {
          sentinel = null;
        }
      };
      // The lock is dropped on hide, so re-request it each time the page becomes visible.
      const onVisibility = (): void => {
        if (document.visibilityState === "visible") void acquire();
      };
      document.addEventListener("visibilitychange", onVisibility);
      void acquire();
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        void sentinel?.release().catch(() => undefined);
        sentinel = null;
      };
    }
  });

  // The active election is driven by the URL: a per-election landing (`/2019`) selects that
  // election; the home page (`/`) is always the current election; any other route (the quiz/card
  // flow) keeps the running selection, falling back to the persisted one on a direct load. The quiz
  // then follows, swapping to that election's own saved progress. Idempotent — cheap to re-run.
  let bootstrapped = false;
  $effect(() => {
    const param = page.params.election;
    if (param && electionById(param)) election.set(param);
    else if (page.route.id === "/") election.set(CURRENT_ELECTION_ID);
    else if (!bootstrapped) election.hydrate();
    bootstrapped = true;
    quiz.useElection(election.id);
  });

  // Age-first gate. Once the acknowledgement is hydrated, a route the visitor's capability does not
  // permit is bounced to /start (remembering the destination so they continue where they were
  // headed after answering). Confirmed adults may go anywhere, so they short-circuit; otherwise an
  // adult-only route is always blocked, and an explore route is blocked unless the visitor has
  // chosen explore mode. Runs after hydration only, so it never fights the prerendered HTML.
  $effect(() => {
    if (!ageGate.ready || ageGate.confirmed) return;
    const id = page.route.id;
    if (!id) return;
    const blocked = ADULT_ONLY_ROUTES.has(id) || (EXPLORE_ROUTES.has(id) && !ageGate.canExplore);
    if (blocked) {
      ageGate.intend(location.pathname + location.search + location.hash);
      void goto("/start");
    }
  });
</script>

<svelte:head>
  {#if noindex}
    <meta name="robots" content="noindex, nofollow" />
  {/if}
</svelte:head>

<JsonLd />

<a href="#main" class="skip ui">Skip to content</a>

<div class="sheet">
  <main id="main">
    {@render children()}
  </main>
  <Footer />
  <FeedbackWidget />
</div>

<!-- Post-hydration only (consent.ready), so neither appears in the prerendered HTML. The banner
     shows until a choice is made; the preferences modal is reachable any time from the footer.
     Both are additionally gated on hasConfigurableConsent — a registry-derived flag that is true
     only when some consent-required category has a live service. Today nothing on the site needs
     consent (analytics is edge-side + cookieless; the anti-spam check is self-hosted and
     cookieless), so the flag is false
     and neither surfaces; adding a consent-gated service back to the registry flips it true and the
     UI returns with no code change. -->
{#if hasConfigurableConsent && consent.ready && !consent.hasDecided && !consent.isSettingsOpen}
  <ConsentBanner />
{/if}
{#if hasConfigurableConsent && consent.isSettingsOpen}
  <ConsentSettings />
{/if}

{#if swUpdateReady}
  <div class="sw-update ui" role="status" aria-live="polite">
    <span>A new version of How2Vote is ready.</span>
    <button type="button" onclick={applyUpdate}>Reload</button>
  </div>
{/if}

<style>
  .sw-update {
    position: fixed;
    left: 50%;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    gap: 12px;
    align-items: center;
    max-width: calc(100vw - 24px);
    padding: 10px 12px 10px 16px;
    background: var(--raise);
    color: var(--ink);
    border: 1.5px solid var(--rule);
    border-radius: var(--radius);
    box-shadow: 0 2px 18px var(--line);
    font-family: var(--ui);
    font-size: 0.9rem;
  }
  .sw-update button {
    flex: none;
    padding: 6px 14px;
    background: var(--ink);
    color: var(--on-fill);
    border: none;
    border-radius: var(--radius);
    font: inherit;
    cursor: pointer;
  }
  .skip {
    position: absolute;
    left: 8px;
    top: -60px;
    background: var(--ink);
    color: var(--on-fill);
    padding: 10px 16px;
    border-radius: var(--radius);
    z-index: 10;
    transition: top 120ms ease-out;
  }
  .skip:focus {
    top: 8px;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
