<script lang="ts">
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { browser, version } from "$app/environment";
  import {
    CURRENT_ELECTION_ID,
    electionById,
    isPollingDayNoticeWindow,
  } from "@how2vote/data-schema";
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import StructuredData from "$lib/components/StructuredData.svelte";
  import { election } from "$lib/election.svelte";
  import { CONTROL_PLANE_SCHEMA_VERSION } from "$lib/governance/control-plane";
  import { PUBLIC_SIGNATORIES, signatoryPersonGraph } from "$lib/governance/signatories";
  import { LICENCES, ORG } from "$lib/org";
  import { now } from "$lib/now.svelte";
  import { RESEARCH_CONSENT_VERSION, RESEARCH_SCHEMA_VERSION } from "$lib/research/consent";
  import { SOURCE_REPO_URL } from "$lib/structured-data";

  /** The LinkedIn profile from a signatory's verified external identities, if any. */
  const linkedinOf = (sameAs: string[]) => sameAs.find((u) => u.includes("linkedin.com"));

  const manifest = $derived(election.manifest);
  const label = $derived(election.meta.label);

  const dateFmt = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

  // Version-pinned links into the open-source repo. The deploy tags each release v<version>, so a
  // citation resolves to the EXACT shipped file; a dev build falls back to the default branch.
  const repoRef = $derived(version && !version.includes("dev") ? `v${version}` : "main");
  const repoDir = (path: string): string => `${SOURCE_REPO_URL}/tree/${repoRef}/${path}`;

  // The dataset's retrieval date, for the citation line (absent for an election with no snapshot).
  const retrievedAt = $derived(
    manifest.provenance?.retrievedAt ? dateFmt(manifest.provenance.retrievedAt) : "",
  );

  // The build stamp lives ONLY in /release-manifest.json (emitted at deploy, after prerender), so it
  // can't be imported at build time — fetch it client-side and show the build date + short commit.
  // The page degrades gracefully when it's absent (e.g. a dev build has no manifest): the line hides.
  type ReleaseManifest = { generatedAt?: string; gitCommit?: string };
  let release = $state<ReleaseManifest | null>(null);
  const buildDate = $derived(release?.generatedAt ? dateFmt(release.generatedAt) : "");
  const shortCommit = $derived(
    release?.gitCommit && release.gitCommit !== "unknown" ? release.gitCommit.slice(0, 8) : "",
  );

  // Completion counts come from the SAME published, k-suppressed stats index as /insights, and are
  // held back on election day (00:00–8 pm AEST) exactly as Insights is, so this page can't become a
  // side channel around that closure. Driven by the CURRENT election and the ticking clock.
  type IndexEntry = { id: string; label: string; published: boolean; totalResponses: number };
  type StatsIndex = { schemaVersion: number; elections: IndexEntry[] };
  const currentMeta = electionById(CURRENT_ELECTION_ID)!;
  const closed = $derived(isPollingDayNoticeWindow(currentMeta, now.current));
  let statsIndex = $state<StatsIndex | null>(null);
  // Only elections whose aggregates clear the disclosure threshold; a below-k election is withheld
  // (its raw total could single someone out), matching the published-only gating on /insights.
  const publishedCompletes = $derived(statsIndex?.elections.filter((e) => e.published) ?? []);
  const totalCompletes = $derived(publishedCompletes.reduce((sum, e) => sum + e.totalResponses, 0));

  // Both fetches run only in the browser after hydration (the page is prerendered), each once. The
  // build stamp is unconditional; the stats index is skipped while Insights is closed, so the
  // withheld counts never reach the browser. The effect re-runs as the clock ticks, so a tab left
  // open across the election-day 8 pm boundary (closed → open) kicks the stats load only then.
  let buildRequested = false;
  let statsRequested = false;
  $effect(() => {
    now.start();
    if (!browser) return;
    if (!buildRequested) {
      buildRequested = true;
      void fetch("/release-manifest.json", { cache: "no-cache" })
        .then((res) => (res.ok ? res.json() : null))
        .then((m) => (release = m))
        .catch(() => {});
    }
    if (!closed && !statsRequested) {
      statsRequested = true;
      void fetch("/stats/index.json", { cache: "no-cache" })
        .then((res) => (res.ok ? res.json() : null))
        .then((file) => (statsIndex = file?.schemaVersion === 2 ? file : null))
        .catch(() => {});
    }
  });
</script>

<Meta />

<ContentPage title="About">
  <p>
    How2Vote is an independent tool that turns the public record of parliament into a personal
    comparison and voting plan. Its one job is to report what parliament actually did and let you
    compare it with your own views — nothing more.
  </p>

  <h2>Built to be even-handed</h2>
  <p>
    How2Vote aims to favour no party. It applies the same published, deterministic method to every
    party and candidate, and it is deliberately two-tone — ink on paper, with no colour anywhere —
    so match quality is never dressed up as party allegiance; a build-time check keeps it that way.
    We don't claim the method is the only reasonable way to read the public record: which issues to
    include and how to describe a parliamentary division involve editorial judgement, set out in
    full on the <a href="/methodology">How it works</a> page.
  </p>

  <h2>Open and checkable</h2>
  <p>
    The source code is open under the <strong>{LICENCES.app.shortName}</strong> licence, and the
    compiled vote dataset is published under the <strong>{LICENCES.data.shortName}</strong>. Every
    proposition links to the divisions behind it, the scoring is covered by tests that pin its
    results, and the dataset carries a checksum and a data vintage so you can check exactly what the
    comparison was built from.
  </p>
  <p>
    You can read the source at
    <ExternalLink href={SOURCE_REPO_URL}>{SOURCE_REPO_URL}</ExternalLink>
    (with its build instructions and per-domain data licences). The versions and content hashes this build
    was made from are recorded below.
  </p>

  <h2>Versions</h2>
  <p>
    For the record — and to pin exactly what governed the site at a point in time — this build runs
    under:
  </p>
  <ul>
    <li>
      <strong>Application</strong> — {version}{#if buildDate}, built {buildDate}{#if shortCommit}{" "}(commit
          <code>{shortCommit}</code>){/if}{/if}
    </li>
    <li>
      <strong>Scoring methodology</strong> — {manifest.methodologyVersion} (for the {label} card)
    </li>
    <li><strong>Compliance policy</strong> — {manifest.compliancePolicyVersion}</li>
    <li>
      <strong>{label} dataset</strong> — {manifest.dataVersion} (checksum
      <code>{manifest.checksum}</code>)
    </li>
    <li><strong>Survey submission schema</strong> — v{RESEARCH_SCHEMA_VERSION}</li>
    <li><strong>Survey consent notice</strong> — {RESEARCH_CONSENT_VERSION}</li>
    <li><strong>Control-plane schema</strong> — v{CONTROL_PLANE_SCHEMA_VERSION}</li>
  </ul>
  <p>
    <!-- rel="external": generated at deploy (not present at prerender time), so the crawler must skip it. -->
    The machine-readable
    <ExternalLink href="/release-manifest.json" rel="external">release manifest</ExternalLink>
    records these alongside the git commit and content hashes of every legal, governance and dataset artefact
    this build shipped.
  </p>

  <h2>Data vintage</h2>
  <p>
    The <strong>{label}</strong> card is built from divisions up to
    <strong>{manifest.dataVersion}</strong>
    ({manifest.counts["questions"]} propositions,
    {manifest.counts["parties"]} parties and independents). Older elections are scored on the parliamentary
    record as it stood at that election. Vote data © They Vote For You (OpenAustralia Foundation), ODbL.
  </p>

  <h2>For researchers</h2>
  <p>
    If you're citing or building on this tool, the parts you'll need are public and versioned. The
    method is described in full on <a href="/methodology">How it works</a>; every dated change to
    it, alongside the log of data corrections, is on the <a href="/corrections">Corrections</a>
    page. The survey aggregates — the disclosure threshold that governs them, and the questions they can
    and can't answer — are set out on <a href="/insights">What the numbers say</a>, with the method
    behind them (the estimand registry, the disclosure controls and the ethics and statistical
    standards it meets) on <a href="/research">Research methods</a>.
  </p>
  <p>
    To cite a result, pin the dataset it was built from — <strong>{label}</strong>, version
    <strong>{manifest.dataVersion}</strong>{#if retrievedAt}, retrieved {retrievedAt}{/if}. The
    checksum listed under Versions and the
    <!-- rel="external": generated at deploy (not present at prerender time), so the crawler must skip it. -->
    <ExternalLink href="/release-manifest.json" rel="external">release manifest</ExternalLink>
    fix the exact bytes, so a saved reference stays reproducible.
  </p>
  <p>
    The design and governance decisions behind the site — from the age-first eligibility gate to the
    aggregate-only research store — are recorded as
    <ExternalLink href={repoDir("docs/adr")}>Architecture Decision Records</ExternalLink>
    in the source repository.
  </p>

  {#if !closed && totalCompletes > 0}
    <h2>How many people have taken part</h2>
    <p>
      People have completed the optional post-comparison survey
      <strong>{totalCompletes.toLocaleString("en-AU")}</strong>
      times across the elections we publish{#if publishedCompletes.length > 1}:{:else}.{/if}
    </p>
    {#if publishedCompletes.length > 1}
      <ul>
        {#each publishedCompletes as e (e.id)}
          <li>
            <strong>{e.label.replace(" Federal Election", "")}</strong> — {e.totalResponses.toLocaleString(
              "en-AU",
            )}
          </li>
        {/each}
      </ul>
    {/if}
    <p>
      These are the same published, aggregate-only counts behind
      <a href="/insights">What the numbers say</a>; small groups are withheld, and it is a
      self-selected sample, not a representative poll.
    </p>
  {/if}

  <h2>Who makes it</h2>
  <p>
    How2Vote is built by {ORG.tradingName} ({ORG.legalName}, ABN {ORG.abn}, ACN {ORG.acn}). It is
    not produced, approved, registered or endorsed by any political party, candidate, or the
    Australian Electoral Commission. Read our <a href="/terms">Terms of use</a>,
    <a href="/privacy">Privacy policy</a>
    and
    <a href="/accessibility">Accessibility statement</a>.
  </p>
  <p>Accountability for How2Vote's compliance sign-offs rests with:</p>
  <ul>
    {#each PUBLIC_SIGNATORIES as person (person.id)}
      {@const linkedin = linkedinOf(person.sameAs)}
      <li id={person.id}>
        <strong>{person.legalName}</strong> — {person.jobTitle}, {person.org}{#if linkedin}{" "}(<ExternalLink
            href={linkedin}
            ariaLabel={`${person.legalName} on LinkedIn`}>LinkedIn</ExternalLink
          >){/if}
      </li>
    {/each}
  </ul>
  <StructuredData node={signatoryPersonGraph()} />
</ContentPage>

<style>
  /* Version/commit/checksum values are long unbreakable hex tokens. Let them break so the
     provenance list reflows with no horizontal scrollbar at narrow widths (WCAG 1.4.10 reflow,
     tested at 320px in e2e/a11y.spec.ts). */
  code {
    overflow-wrap: anywhere;
  }
</style>
