<script lang="ts">
  import type { MatchBand } from "@how2vote/engine";
  import {
    alignmentPresentation,
    groupByFederalGroup,
    PARTY_ALIGNMENT_QUALIFIER,
  } from "$lib/candidate-alignment";

  // THE alignment surface. Alignment figures live here — at PARTY level, in their own panel — and
  // NOT on individual candidate rows: a party's recorded parliamentary voting is not evidence of an
  // individual candidate's personal views or future votes, and a figure printed beside a candidate's
  // name reads as a score OF that candidate (defamation / political-misattribution risk). Every
  // figure is derived through the shared, fail-closed alignmentPresentation() — an independent /
  // unmapped party, a party with no record, or a party suspended for a correction shows a text badge,
  // never a fabricated number. The shared PARTY_ALIGNMENT_QUALIFIER is rendered visibly so the
  // party-not-candidate limit cannot drift from the single source.
  type PartyAlignment = {
    /** AEC party/group name, as printed. */
    party: string;
    /** Resolved party key, or null (dropped upstream — the panel only receives mapped parties). */
    partyKey: string | null;
    score: number;
    band: MatchBand;
    /** Alignment withdrawn pending a correction / right of reply. */
    suspended: boolean;
    /** Registered-family label (e.g. "Coalition"); members render together, each keeps its figure. */
    federalGroup?: string;
    /** Short state/territory suffix for a state branch (e.g. "Qld", "NT"). */
    region?: string;
  };

  // `ballotOrdered` describes what the row order MEANS, so the neutrality copy can be accurate: a
  // House/Senate panel is in printed ballot order (default), while the ballot-less panel has no
  // ballot yet and is in registration order with any registered family grouped together. Either way
  // the order is never a ranking — that reassurance is constant.
  let {
    parties,
    caption,
    ballotOrdered = true,
  }: { parties: PartyAlignment[]; caption: string; ballotOrdered?: boolean } = $props();

  const rows = $derived(
    parties.map((pty) => ({
      party: pty.party,
      partyKey: pty.partyKey,
      suspended: pty.suspended,
      region: pty.region,
      federalGroup: pty.federalGroup,
      presentation: alignmentPresentation({
        partyKey: pty.partyKey,
        party: pty.party,
        score: pty.score,
        band: pty.band,
        suspended: pty.suspended,
      }),
    })),
  );

  // Registered families (e.g. the Coalition brands) render together under one neutral heading; every
  // other party is its own block. Grouping keeps each member's figure and never ranks.
  const blocks = $derived(groupByFederalGroup(rows));
</script>

<section class="party-panel ui" aria-labelledby="pp-{caption.replace(/\s+/g, '-').toLowerCase()}">
  <h4 class="pp-caption" id="pp-{caption.replace(/\s+/g, '-').toLowerCase()}">{caption}</h4>
  <p class="pp-label">
    <b>Party voting record — not the candidate's personal position.</b> Each figure is how often a
    party's recorded parliamentary votes align with your answers, as evidence only. Parties are
    listed {ballotOrdered
      ? "in the order they appear on the ballot paper"
      : "in registration order, with any registered family shown together"}, <b>not</b> ranked by alignment
    — nothing here is ranked or recommended.
  </p>

  {#snippet partyRow(row: (typeof rows)[number])}
    <li class="pp-row">
      <span class="pp-party"
        >{row.party || "Unnamed group"}{#if row.region}<span class="pp-region">
            &nbsp;({row.region})</span
          >{/if}</span
      >
      <span
        class="align ui tnum"
        class:dot={row.presentation.kind === "no-party-record"}
        class:held={row.presentation.kind === "suspended"}
      >
        {#if row.presentation.showScore}
          <span class="pct">{row.presentation.score}%</span>
          <span class="lbl">{row.presentation.badge}</span>
        {:else}
          {row.presentation.badge}
        {/if}
      </span>
      <span class="visually-hidden">
        {row.party}: {row.presentation.detail} This is the party's recorded voting, not this candidate's
        personal position — evidence only, not a recommended preference.
      </span>
    </li>
  {/snippet}

  {#if rows.length > 0}
    <ul class="pp-list">
      {#each blocks as block (block.kind === "group" ? `group:${block.label}` : (block.row.partyKey ?? block.row.party))}
        {#if block.kind === "single"}
          {@render partyRow(block.row)}
        {:else}
          <!-- A registered family (the Coalition brands) shown together. Neutral, factual grouping:
               a heading and each member's own figure, never a pooled or ranked total (CEA 1918 s351). -->
          <li class="pp-group">
            <p class="pp-group-head">
              <span class="pp-group-name">{block.label}</span>
              <span class="pp-group-note">
                Registered {block.label} parties — shown together, each with its own record. Not ranked.
              </span>
            </p>
            <ul class="pp-list pp-group-list">
              {#each block.rows as row (row.partyKey ?? row.party)}
                {@render partyRow(row)}
              {/each}
            </ul>
          </li>
        {/if}
      {/each}
    </ul>
  {:else}
    <p class="pp-empty">No party voting records are available to compare for this ballot.</p>
  {/if}

  <p class="pp-qualifier">{PARTY_ALIGNMENT_QUALIFIER}</p>
</section>

<style>
  /* The party panel is deliberately quiet and uniform — every party is formatted identically, so no
     party is crowned or presented as a winner (CEA 1918 s351). */
  .party-panel {
    margin-top: 14px;
    padding: 12px 14px;
    border: 1px solid var(--line2);
    border-radius: var(--radius);
    background: var(--fill2, transparent);
  }
  .pp-caption {
    font-family: var(--ui);
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin: 0 0 6px;
    color: var(--ink);
  }
  .pp-label {
    font-size: 12px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 0 0 10px;
  }
  .pp-label b {
    color: var(--ink);
  }
  .pp-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .pp-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    align-items: center;
  }
  .pp-party {
    font-family: var(--ui);
    font-size: 13.5px;
    color: var(--ink);
    min-width: 0;
  }
  /* State/territory suffix on a branch name (e.g. "LNP (Qld)") — muted, so it reads as context, not
     a second figure. */
  .pp-region {
    color: var(--ink2);
    font-weight: 400;
  }
  /* A registered family (e.g. the Coalition) — a neutral heading over its member rows. Deliberately
     quiet and NOT emphasised: the family is a factual grouping, never a crowned/aggregate winner. */
  .pp-group {
    list-style: none;
    padding: 0;
    border-bottom: 1px solid var(--line);
  }
  .pp-group-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 10px 0 6px;
  }
  .pp-group-name {
    font-family: var(--ui);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--ink);
  }
  .pp-group-note {
    font-size: 11px;
    color: var(--ink2);
    line-height: 1.45;
  }
  /* Member rows sit under the heading with a quiet rule, showing membership without ranking. */
  .pp-group-list {
    margin: 0 0 4px;
    padding-left: 12px;
    border-left: 2px solid var(--line2);
  }
  .pp-group-list .pp-row:last-child {
    border-bottom: 0;
  }
  .align {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--ink2);
    border: 1px solid var(--line2);
    border-radius: 4px;
    padding: 4px 8px;
    white-space: nowrap;
  }
  /* No party record / suspended both show text only, never a figure — kept visually consistent. */
  .align.dot {
    border-style: dotted;
  }
  .align.held {
    border-style: dashed;
  }
  .pct {
    font-weight: 700;
    color: var(--ink);
  }
  /* The unit label sits after the figure and reads as one phrase: "31% alignment". Every shown
     figure carries the same label, so parties read as ranked off one scale. */
  .lbl {
    font-weight: 500;
    font-size: 11px;
    color: var(--ink2);
  }
  .pp-empty {
    font-size: 12px;
    color: var(--ink2);
    margin: 0;
  }
  .pp-qualifier {
    font-size: 11.5px;
    color: var(--ink2);
    line-height: 1.5;
    margin: 10px 0 0;
  }
</style>
