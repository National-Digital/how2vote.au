<script lang="ts">
  import { version } from "$app/environment";
  import ContentPage from "$lib/components/ContentPage.svelte";
  import Meta from "$lib/components/Meta.svelte";
  import { SOURCE_REPO_URL } from "$lib/structured-data";
  // The research-ethics + statistical-practice register is the machine-readable source of truth
  // (validated by scripts/check-research-ethics.mjs). Imported live so the standards + statuses on
  // this page can never drift from it. The narrative below the standards is a plain-language mirror
  // of docs/research/analysis-plan.md — reconciled by hand, kept close to that document.
  import register from "$docs/research/standards-register.json";

  // Version-pinned links into the open-source repo (as on /about): the deploy tags each release
  // v<version>, so a citation resolves to the EXACT shipped file; a dev build falls back to main.
  const repoRef = version && !version.includes("dev") ? `v${version}` : "main";
  const repoFile = (path: string): string => `${SOURCE_REPO_URL}/blob/${repoRef}/${path}`;

  // A human, honest label for a standard's implementation status. "implemented" is a control we run
  // in code; "pending-evidence" means the control is built but an EXTERNAL determination it depends
  // on (an ethics decision, an Indigenous data-governance decision) has not yet been recorded.
  const statusLabel = (s: string): string =>
    s === "implemented"
      ? "In place"
      : s === "pending-evidence"
        ? "In place — awaiting an external determination"
        : s;

  const sensitiveCount = register.preferNotToSay.sensitiveItems.length;
</script>

<Meta />

<ContentPage title="Research methods">
  <p>
    Some people answer an optional survey after they've built their comparison. This page explains
    what we do with those answers — for anyone citing the figures on
    <a href="/insights">What the numbers say</a>, or checking how the research is run. Everything
    here is aggregate and descriptive; it is never a prediction, and it is not a representative
    poll.
  </p>
  <p>
    The survey is run as a <strong>confirmatory repeated cross-sectional trend series</strong> — the
    design official statistics use — not an open-ended data archive. Under the aggregate-counters
    model (<a
      href={repoFile("docs/adr/0008-aggregate-counters.md")}
      target="_blank"
      rel="noopener noreferrer">ADR-0008</a
    >) the research store holds only the counter tables listed below: the raw answers never leave
    your device, and the server only ever increments totals. Nothing else is collected, so nothing
    else can ever be analysed.
  </p>

  <h2>What it can and can't measure</h2>
  <p>
    The estimands are a closed, pre-registered list — each maps one-to-one to a counter table, and
    new ones can only be added going forward, never computed over past responses. In plain terms, we
    can count:
  </p>
  <ul>
    <li>how many people took part, by election, collection period and state;</li>
    <li>
      top-party match against <strong>one</strong> characteristic at a time (say, age, or education) —
      never two at once;
    </li>
    <li>support for each proposition (agree / neutral / disagree);</li>
    <li>whether people who match a party tend to agree with its positions;</li>
    <li>
      a weighting frame (age × gender × state, with <strong>no</strong> opinion attached) so the whole
      series can be weighted against ABS and AEC benchmarks;
    </li>
    <li>response coverage by electorate (a count only, with no characteristics attached);</li>
    <li>
      which consent notice was in force, and when responses arrived (to the calendar quarter).
    </li>
  </ul>
  <p>
    Because there is no per-person record at any point, there is nothing to cross-tabulate beyond
    these totals — that is a deliberate design property, not a limitation to be worked around. The
    full registry and the question codebook are published:
    <a href={repoFile("docs/research/analysis-plan.md")} target="_blank" rel="noopener noreferrer"
      >analysis plan</a
    >
    ·
    <a href={repoFile("docs/research/codebook.md")} target="_blank" rel="noopener noreferrer"
      >codebook</a
    >.
  </p>

  <h2>Disclosure controls</h2>
  <p>The rule that governs every stored total:</p>
  <blockquote>
    No counter may key an opinion together with a sensitive attribute and a geography finer than
    national.
  </blockquote>
  <p>
    Party match and proposition stances are political opinion. The {sensitiveCount} sensitive characteristics
    (the Privacy Act's sensitive-information categories — union membership, birthplace, language, Indigenous
    status, religion, sexual orientation and the political-opinion items) are therefore stored
    <strong>nationally only</strong>, never against a state or electorate. The nine non-sensitive
    characteristics (age, gender, education, work, household size, children, tenure, income,
    financial security) may be keyed to state. This caps the meaning of the worst case — a single
    small total — at "one person somewhere in Australia".
  </p>
  <p>
    Every time-varying total is also keyed by <strong>collection cohort</strong> (pre-declaration, live
    campaign, post-election, historical), classified against the AEC timetable, so cohorts are suppressed
    independently and never silently combined. On top of that, publication applies a minimum cell size
    (at least 10 responses per cohort), a 50-response board minimum, a rule that shown percentages sum
    only over surviving cells, and a differencing check when figures are regenerated.
  </p>

  <h2>Keeping the series honest</h2>
  <ul>
    <li>
      <strong>Scoring is fixed per wave.</strong> Each election is scored with that election's engine
      and dataset; historical waves are never re-scored. A method change is dual-run for a wave and published
      as a bridged, marked series break.
    </li>
    <li>
      <strong>The instrument is stable.</strong> The question set and its ABS/AES-aligned buckets are
      held steady across waves; an option-set change creates a new codebook version and is documented
      as a series break.
    </li>
    <li>
      <strong>New estimands are additive and forward-only.</strong> Adding a total is a governed change
      to the plan, reviewed against the disclosure rule, and applies only from the next collection.
    </li>
    <li>
      <strong>Every election is reviewed.</strong> After each federal election we confirm the estimands
      are still needed, re-run the disclosure review over anything published, and reassess re-identification
      risk.
    </li>
  </ul>

  <h2>Retention</h2>
  <p>
    The counters are genuinely aggregated statistics that don't relate to an identifiable person, so
    they are retained indefinitely — there is no fixed deletion clock. A clock never mitigated the
    residual risk anyway: a total that is one after five years is one because only one person ever
    matched that combination. That risk is handled by the key rule, publication suppression and
    access control. Deletion is therefore <strong>purpose-based</strong>: a wave's counters are
    deleted when an after-election review finds its purpose has ended, or the privacy impact
    assessment directs it.
  </p>

  <h2>Ethical by construction</h2>
  <p>
    Taking part is voluntary and never a condition of using the tool: the survey is offered only
    after your comparison and plan already exist, and the "skip and build my voting plan" action is
    always there, equally weighted, going straight to your <a href="/card">card</a>. Consent is
    express and opt-in (unticked by default), you must be 18 or over, collection is minimised to the
    aggregate totals above with no direct identifiers, and a "prefer not to say" option is present
    on every question — including all {sensitiveCount} sensitive ones. See the
    <a href="/privacy">privacy policy</a> for how the answers are handled and why a contribution can't
    later be withdrawn once it's merged into the totals.
  </p>

  <h2>Standards we run against</h2>
  <p>
    The research programme is run against these external standards. The current consent notice is
    version <strong>{register.consentVersion}</strong>.
  </p>
  <ul>
    {#each register.standards as s (s.id)}
      <li>
        <strong>
          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
        </strong>
        ({s.publisher}) — {statusLabel(
          s.status,
        )}{#if s.appliesWhen === "indigenous-status-collected"}, because the survey collects
          Aboriginal and Torres Strait Islander status{/if}.
        {#if s.evidence.length > 0}
          <br />
          <span class="evidence"
            >Outstanding: {s.evidence.map((e) => e.description).join("; ")}.</span
          >
        {/if}
      </li>
    {/each}
  </ul>
  <p>
    The machine-readable register that binds each standard to the control and tests that implement
    it is published in full:
    <a
      href={repoFile("docs/research/standards-register.json")}
      target="_blank"
      rel="noopener noreferrer">standards register</a
    >.
  </p>
</ContentPage>

<style>
  /* Match the prose scale; ContentPage styles the surrounding article. */
  blockquote {
    margin: 0 0 14px;
    padding: 8px 0 8px 14px;
    border-left: 3px solid var(--rule, currentColor);
    color: var(--ink);
    font-style: italic;
  }
  .evidence {
    color: var(--ink3, inherit);
    font-size: 0.9em;
  }
</style>
