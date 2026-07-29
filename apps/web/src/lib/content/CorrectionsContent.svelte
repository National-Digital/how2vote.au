<script lang="ts">
  // The body of /corrections, in $lib/content so the same markup renders on the page and in the
  // dialog raised by an in-flow `<DocLink href="/corrections">`. A second copy would let the two
  // state different things about the same correction.
  //
  // Public mirror of docs/corrections.md (correction log) and docs/methodology-changelog.md
  // (scoring-method history). Kept factual and in sync with those files.
  import DocLink from "$lib/components/DocLink.svelte";
  import ExternalLink from "$lib/components/ExternalLink.svelte";
  import { ORG } from "$lib/org";
  import { METHODOLOGY_VERSION } from "$lib/provenance";

  const lastUpdated = "14 July 2026";

  // The published correction log. One row per published correction: date, election, what was wrong,
  // what changed, the data version before/after, and who verified it. Empty pre-launch.
  type Correction = {
    date: string;
    election: string;
    issue: string;
    change: string;
    dataVersion: string;
    verifiedBy: string;
  };
  const corrections: Correction[] = [];

  // The methodology-change log — dated, versioned scoring-method changes (see the changelog file).
  type MethodologyChange = { version: string; date: string; summary: string };
  const methodologyChanges: MethodologyChange[] = [
    {
      version: "2026.1",
      date: "2026-07-14",
      summary:
        "First published method: 1–5 recorded party positions banded from They Vote For You agreement figures; per-question distance scoring with a 10× extremely-important weight; merged/renamed parties combined by adding raw earned and possible points before rounding.",
    },
  ];
</script>

<p class="updated">Last updated: {lastUpdated}</p>

<p>
  How2Vote publishes every correction it makes and every change to its scoring method, so you can
  see what changed and when. The current scoring method is
  <strong>methodology {METHODOLOGY_VERSION}</strong> (see
  <DocLink href="/methodology">how it works</DocLink>).
</p>

<h2>Reporting an error</h2>
<p>
  If you spot something wrong — a wrong candidate, a party mapping, ballot order, or an alignment
  figure — tell us through the <a href="/contact">contact page</a> or by email at
  <a href="mailto:{ORG.email}">{ORG.email}</a>. The channel is monitored during a campaign.
</p>
<p>
  We aim to respond to a correction report within <strong>five business days</strong>, and within
  <strong>one business day during an election period</strong>. Where a fix cannot be made
  immediately, we can switch the affected function to comparison-only rather than leave a
  ballot-order error in a printable plan.
</p>

<h2>Correction log</h2>
<p>
  Each published correction is recorded here: the date, the election, what was wrong, what changed,
  the data version before and after, and who verified it.
</p>
{#if corrections.length === 0}
  <p><em>No corrections yet — pre-launch.</em></p>
{:else}
  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Election</th>
          <th>Issue</th>
          <th>Change</th>
          <th>Data version</th>
          <th>Verified by</th>
        </tr>
      </thead>
      <tbody>
        {#each corrections as c (c.date + c.issue)}
          <tr>
            <td>{c.date}</td>
            <td>{c.election}</td>
            <td>{c.issue}</td>
            <td>{c.change}</td>
            <td>{c.dataVersion}</td>
            <td>{c.verifiedBy}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<h2>Methodology change log</h2>
<p>
  Changes to the scoring method are dated and versioned. A pure data refresh (new divisions, a new
  election's ballots) does not change the method version.
</p>
<ul>
  {#each methodologyChanges as m (m.version)}
    <li>
      <strong>{m.version}</strong> ({m.date}) — {m.summary}
    </li>
  {/each}
</ul>

<h2>What is preserved for every score</h2>
<p>
  So any figure can be checked or reconstructed, we keep, for every score: the source snapshot it
  was compiled from (the committed dataset carries a tamper-evident checksum and a data vintage),
  the exact parliamentary divisions behind each proposition, and the proposition wording used. Every
  proposition and party record on the site links back to the divisions on
  <ExternalLink href="https://theyvoteforyou.org.au/">They Vote For You</ExternalLink>.
</p>

<style>
  .updated {
    font-size: 13px;
    color: var(--ink3);
    margin-top: -4px;
  }
  .tablewrap {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
  }
  th,
  td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line, var(--wash));
    vertical-align: top;
  }
  th {
    color: var(--ink);
    font-weight: 600;
  }
</style>
