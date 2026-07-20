/**
 * Build-time content model for the indexable, data-derived pages (electorates, Senate ballots,
 * propositions and party voting records — one set per election).
 *
 * This module is **server-only** (the `.server` suffix keeps it out of the client bundle) precisely
 * so it can statically import the three ~330 KB election datasets: the per-election content routes
 * read their slice through a `+page.server.ts` `load`, which runs only at prerender time, and the
 * result is baked into the static HTML. No dataset chunk is ever shipped to the browser for these
 * pages — unlike the quiz/card flow, which lazy-loads a dataset client-side (see $lib/data).
 *
 * Everything here is factual and neutral by construction: pages report the *recorded* parliamentary
 * position of each party on the same 1–5 scale the methodology already publishes, sourced and linked
 * to They Vote For You. There is no match score, no ranking by valence, and no colour — consistent
 * with the project's neutrality guarantee (enforced separately by the CSS neutrality lint and by
 * content.server.test.ts, which asserts these routes never touch the scoring engine).
 */
import type { Dataset, Party, PartyKey, Position } from "@how2vote/data-schema";
import {
  ELECTIONS,
  NO_DATA,
  activeQuestions,
  buildPartyResolver,
  electionById,
} from "@how2vote/data-schema";
import { slugify } from "@how2vote/engine";
import { STATES, stateName } from "./data";
import { SITE_URL, SITE_NAME } from "./seo";

/** A glob key like "…/data/dist/2025/dataset.json" (relative or absolute) → the election id "2025". */
const idFromGlobKey = (path: string): string => path.replace(/.*\/dist\//, "").split("/")[0]!;

/**
 * Every built dataset, keyed by election id. Server-only (the `.server` suffix keeps it out of the
 * client bundle), so eagerly bundling all datasets at build time is fine — they are baked into the
 * prerendered HTML and never shipped to the browser (the quiz/card flow lazy-loads instead; see
 * $lib/data). Data-driven via an eager glob, not a hand-kept list: adding an election needs NO edit
 * here — its committed data/dist/[id]/dataset.json is picked up automatically.
 */
const DATASETS = Object.fromEntries(
  Object.entries(
    import.meta.glob("$data/dist/*/dataset.json", { eager: true, import: "default" }),
  ).map(([path, dataset]) => [idFromGlobKey(path), dataset]),
) as Record<string, Dataset>;

export function datasetFor(electionId: string): Dataset | null {
  return DATASETS[electionId] ?? null;
}

/** Human-readable stance for a recorded 1–5 position, phrased as the party's stance on the issue. */
export const STANCE: Record<number, string> = {
  5: "Strongly agrees",
  4: "Agrees",
  3: "Equal merits",
  2: "Disagrees",
  1: "Strongly disagrees",
};

/** They Vote For You policy page for a proposition — its id *is* the TVFY policy id. */
export const tvfyPolicy = (id: number): string => `https://theyvoteforyou.org.au/policies/${id}`;

/** URL slug for a party (from its display name) and a proposition (from its wording). */
export const partySlug = (p: Party): string => slugify(p.displayName);
export const issueSlug = (text: string): string => slugify(text);
export const stateSlug = (code: string): string => code.toLowerCase();

/** Clamp text to `max` chars at a word boundary, appending an ellipsis. Used for the generated
 * titles/descriptions so a long proposition or party name is never cut mid-word. */
function clamp(s: string, max: number, floor: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > floor ? at : max - 1).trimEnd()}…`;
}

/** Clamp a generated meta description to the 160-char policy at a word boundary. */
const clampDesc = (s: string): string => clamp(s, 160, 120);
/** Clamp a generated page title to a Google-friendly length at a word boundary. */
const clampTitle = (s: string): string => clamp(s, 65, 40);

export type Seo = { title: string; description: string };

/** Parties (and independents) with at least one recorded position this election — the ones a
 * voting-record page can actually be built for. Offices never appear. */
function scoredParties(ds: Dataset): Party[] {
  const scored = new Set<string>();
  for (const q of activeQuestions(ds.questions)) {
    for (const [key, pos] of Object.entries(q.positions)) {
      if (pos !== NO_DATA) scored.add(key);
    }
  }
  // Parties off the AEC register (deregistered/renamed) are dropped from every content surface — for a
  // ballot-less upcoming election this stops a party that cannot contest appearing on the party pages,
  // the party hub, and (via partyHrefs) the issue stance lists. Empty for an election with a ballot.
  const deregistered = new Set((ds.parties.deregistered ?? []).map((d) => d.key));
  return ds.parties.parties.filter(
    (p) => p.kind !== "office" && scored.has(p.key) && !deregistered.has(p.key),
  );
}

/** Party-key → generated party-page href, for the parties that have a record this election. */
function partyHrefs(electionId: string, ds: Dataset): Map<PartyKey, string> {
  const map = new Map<PartyKey, string>();
  for (const p of scoredParties(ds)) map.set(p.key, `/${electionId}/parties/${partySlug(p)}`);
  return map;
}

/** States that actually appear on this election's ballot, in ballot-paper order. */
function ballotStates(ds: Dataset): { code: string; name: string }[] {
  const present = new Set(ds.ballots.electorates.map((e) => e.state.toUpperCase()));
  return STATES.filter((s) => present.has(s.code));
}

// ─── Entry enumerators (drive prerendering; every returned param combination is a page) ──────────

export const electionEntries = (): { election: string }[] =>
  ELECTIONS.map((e) => ({ election: e.id }));

export function electorateEntries(): { election: string; electorate: string }[] {
  const out: { election: string; electorate: string }[] = [];
  for (const { id } of ELECTIONS) {
    const ds = DATASETS[id]!;
    for (const e of ds.ballots.electorates)
      out.push({ election: id, electorate: slugify(e.electorate) });
  }
  return out;
}

export function senateEntries(): { election: string; state: string }[] {
  const out: { election: string; state: string }[] = [];
  for (const { id } of ELECTIONS) {
    for (const s of ballotStates(DATASETS[id]!))
      out.push({ election: id, state: stateSlug(s.code) });
  }
  return out;
}

export function issueEntries(): { election: string; issue: string }[] {
  const out: { election: string; issue: string }[] = [];
  for (const { id } of ELECTIONS) {
    for (const q of activeQuestions(DATASETS[id]!.questions))
      out.push({ election: id, issue: issueSlug(q.text) });
  }
  return out;
}

export function partyEntries(): { election: string; party: string }[] {
  const out: { election: string; party: string }[] = [];
  for (const { id } of ELECTIONS) {
    for (const p of scoredParties(DATASETS[id]!)) out.push({ election: id, party: partySlug(p) });
  }
  return out;
}

// ─── Page builders (return the exact, serialisable slice each route renders) ─────────────────────

export type ElectorateHub = {
  seo: Seo;
  label: string;
  year: number;
  states: {
    code: string;
    name: string;
    senateHref: string;
    electorates: { name: string; href: string }[];
  }[];
};

export function buildElectorateHub(electionId: string): ElectorateHub | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const states = ballotStates(ds).map((s) => ({
    code: s.code,
    name: s.name,
    senateHref: `/${electionId}/senate/${stateSlug(s.code)}`,
    electorates: ds.ballots.electorates
      .filter((e) => e.state.toUpperCase() === s.code)
      .sort((a, b) => a.electorate.localeCompare(b.electorate))
      .map((e) => ({
        name: e.electorate,
        href: `/${electionId}/electorates/${slugify(e.electorate)}`,
      })),
  }));
  const count = ds.ballots.electorates.length;
  return {
    seo: {
      title: `Electorates & candidates — ${meta.shortLabel} — how2vote`,
      description: clampDesc(
        `Every candidate standing in all ${count} federal House electorates at the ${meta.label}, by state, plus each state's Senate ballot.`,
      ),
    },
    label: meta.label,
    year: meta.year,
    states,
  };
}

export type Candidate = {
  position: number;
  candidate: string;
  party: string;
  partyHref: string | null;
};
export type ElectoratePage = {
  seo: Seo;
  electorate: string;
  stateName: string;
  year: number;
  label: string;
  hubHref: string;
  senateHref: string;
  candidates: Candidate[];
};

export function buildElectoratePage(electionId: string, slug: string): ElectoratePage | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const electorate = ds.ballots.electorates.find((e) => slugify(e.electorate) === slug);
  if (!electorate) return null;

  const resolver = buildPartyResolver(ds.parties.parties);
  const hrefs = partyHrefs(electionId, ds);
  const candidates: Candidate[] = ds.ballots.house
    .filter((c) => c.division.trim().toLowerCase() === electorate.electorate.trim().toLowerCase())
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const key = resolver.resolve(c);
      return {
        position: c.position,
        candidate: c.candidate,
        party: c.party,
        partyHref: key ? (hrefs.get(key) ?? null) : null,
      };
    });

  return {
    seo: {
      title: `${electorate.electorate} candidates — ${meta.shortLabel} — how2vote`,
      description: clampDesc(
        `Everyone on the House of Representatives ballot in ${electorate.electorate}, ${stateName(electorate.state)}, at the ${meta.label} — ${candidates.length} candidates and their parties.`,
      ),
    },
    electorate: electorate.electorate,
    stateName: stateName(electorate.state),
    year: meta.year,
    label: meta.label,
    hubHref: `/${electionId}/electorates`,
    senateHref: `/${electionId}/senate/${stateSlug(electorate.state)}`,
    candidates,
  };
}

export type SenateGroup = { group: string; candidates: Candidate[] };
export type SenatePage = {
  seo: Seo;
  stateName: string;
  year: number;
  label: string;
  hubHref: string;
  groups: SenateGroup[];
};

export function buildSenatePage(electionId: string, state: string): SenatePage | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const code = state.toUpperCase();
  if (!STATES.some((s) => s.code === code)) return null;

  const resolver = buildPartyResolver(ds.parties.parties);
  const hrefs = partyHrefs(electionId, ds);
  const byGroup = new Map<string, Candidate[]>();
  for (const c of ds.ballots.senate) {
    if (c.state.toUpperCase() !== code) continue;
    const key = resolver.resolve(c);
    const row: Candidate = {
      position: c.position,
      candidate: c.candidate,
      party: c.party,
      partyHref: key ? (hrefs.get(key) ?? null) : null,
    };
    const rows = byGroup.get(c.group);
    if (rows) rows.push(row);
    else byGroup.set(c.group, [row]);
  }
  if (byGroup.size === 0) return null;

  const groups: SenateGroup[] = [...byGroup.entries()]
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
    .map(([group, candidates]) => ({
      group,
      candidates: candidates.sort((x, y) => x.position - y.position),
    }));
  const total = groups.reduce((n, g) => n + g.candidates.length, 0);

  return {
    seo: {
      title: `${stateName(code)} Senate candidates — ${meta.shortLabel} — how2vote`,
      description: clampDesc(
        `The full Senate ballot for ${stateName(code)} at the ${meta.label} — all ${total} candidates, by group, as printed on the paper.`,
      ),
    },
    stateName: stateName(code),
    year: meta.year,
    label: meta.label,
    hubHref: `/${electionId}/electorates`,
    groups,
  };
}

export type IssueHub = {
  seo: Seo;
  label: string;
  year: number;
  issues: { text: string; href: string }[];
};

export function buildIssueHub(electionId: string): IssueHub | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const issues = activeQuestions(ds.questions).map((q) => ({
    text: q.text,
    href: `/${electionId}/issues/${issueSlug(q.text)}`,
  }));
  return {
    seo: {
      title: `Where parties stand — ${meta.shortLabel} — how2vote`,
      description: clampDesc(
        `The ${issues.length} parliamentary propositions behind the ${meta.label} how2vote scoring, and how every party is recorded voting on each.`,
      ),
    },
    label: meta.label,
    year: meta.year,
    issues,
  };
}

export type IssuePage = {
  seo: Seo;
  text: string;
  year: number;
  label: string;
  hubHref: string;
  tvfy: string;
  divisionCount?: number;
  divisionFirst?: string;
  divisionLast?: string;
  /** Parties grouped by their recorded stance, strongest agreement first. */
  bands: { position: number; stance: string; parties: { name: string; href: string }[] }[];
  /** Factual Q&A pairs (which parties agree/disagree, on what basis) for FAQPage structured data. */
  faqs: { question: string; answer: string }[];
};

export function buildIssuePage(electionId: string, slug: string): IssuePage | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const q = activeQuestions(ds.questions).find((x) => issueSlug(x.text) === slug);
  if (!q) return null;

  const hrefs = partyHrefs(electionId, ds);
  const named = (key: string): { name: string; href: string } | null => {
    const p = ds.parties.parties.find((x) => x.key === key);
    const href = hrefs.get(key as PartyKey);
    return p && href ? { name: p.displayName, href } : null;
  };

  const bands = [5, 4, 3, 2, 1].map((position) => {
    const parties = Object.entries(q.positions)
      .filter(([, pos]) => pos === (position as Position))
      .map(([key]) => named(key))
      .filter((x): x is { name: string; href: string } => x !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { position, stance: STANCE[position]!, parties };
  });

  // Factual FAQ built straight from the bands — every party in each direction is listed (no
  // cherry-picking), so the Q&A carries the public record and no editorial signal.
  const names = (positions: number[]): string =>
    bands
      .filter((b) => positions.includes(b.position))
      .flatMap((b) => b.parties.map((p) => p.name))
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
  const agree = names([5, 4]);
  const disagree = names([2, 1]);
  const faqs = [
    {
      question: `Which parties are recorded agreeing with “${q.text}”?`,
      answer: agree
        ? `On their recorded parliamentary votes, these are scored as agreeing: ${agree}.`
        : "No party or independent with a parliamentary record is scored as agreeing.",
    },
    {
      question: `Which parties are recorded disagreeing with “${q.text}”?`,
      answer: disagree
        ? `On their recorded parliamentary votes, these are scored as disagreeing: ${disagree}.`
        : "No party or independent with a parliamentary record is scored as disagreeing.",
    },
  ];
  if (q.divisionCount) {
    faqs.push({
      question: "What is this based on?",
      answer: `${q.divisionCount} recorded division${q.divisionCount === 1 ? "" : "s"} in federal parliament, sourced from They Vote For You.`,
    });
  }

  return {
    seo: {
      title: clampTitle(`How parties voted: ${q.text}`),
      description: clampDesc(
        `How every party and independent in federal parliament is recorded voting on this issue at the ${meta.label}: “${q.text}” Sourced from They Vote For You.`,
      ),
    },
    text: q.text,
    year: meta.year,
    label: meta.label,
    hubHref: `/${electionId}/issues`,
    tvfy: tvfyPolicy(q.id),
    divisionCount: q.divisionCount,
    divisionFirst: q.divisionFirst,
    divisionLast: q.divisionLast,
    bands,
    faqs,
  };
}

export type PartyHub = {
  seo: Seo;
  label: string;
  year: number;
  parties: { name: string; href: string; independent: boolean }[];
};

export function buildPartyHub(electionId: string): PartyHub | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const parties = scoredParties(ds)
    .map((p) => ({
      name: p.displayName,
      href: `/${electionId}/parties/${partySlug(p)}`,
      independent: p.kind === "independent",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    seo: {
      title: `Party voting records — ${meta.shortLabel} — how2vote`,
      description: clampDesc(
        `Every party and independent with a federal parliamentary voting record scored for the ${meta.label} — ${parties.length} in all. See how each one voted.`,
      ),
    },
    label: meta.label,
    year: meta.year,
    parties,
  };
}

export type PartyPage = {
  seo: Seo;
  name: string;
  independent: boolean;
  year: number;
  label: string;
  hubHref: string;
  rows: { text: string; href: string; stance: string; tvfy: string }[];
  /**
   * Merge transparency: how this entity is combined with others for scoring.
   * `absorbs` — this record is the survivor others fold into; `absorbed` — it is counted as part of
   * another. `null` when it stands alone. `with` names the other entities (linked if they have a page).
   */
  merge: { role: "absorbs" | "absorbed"; with: { name: string; href: string | null }[] } | null;
  /**
   * Registered-name / branch consolidation: the distinct AEC-registered names and branches
   * this one record combines (e.g. state branches of the same party). Read-only transparency — it
   * does not affect scoring. Empty when the party appears under a single name.
   */
  aliases: string[];
};

/** How `key` is combined for scoring this election — the other named, registry-known entities. */
function mergeFor(
  electionId: string,
  ds: Dataset,
  key: PartyKey,
  hrefs: Map<PartyKey, string>,
): PartyPage["merge"] {
  const byKey = new Map(ds.parties.parties.map((p) => [p.key, p]));
  const link = (k: string): { name: string; href: string | null } | null => {
    const p = byKey.get(k as PartyKey);
    return p ? { name: p.displayName, href: hrefs.get(k as PartyKey) ?? null } : null;
  };
  const mergers = ds.parties.merges
    .filter((m) => m.master === key)
    .map((m) => link(m.merger))
    .filter((x): x is { name: string; href: string | null } => x !== null);
  if (mergers.length > 0) return { role: "absorbs", with: mergers };

  const asMerger = ds.parties.merges.find((m) => m.merger === key);
  const master = asMerger ? link(asMerger.master) : null;
  if (master) return { role: "absorbed", with: [master] };
  return null;
}

export function buildPartyPage(electionId: string, slug: string): PartyPage | null {
  const meta = electionById(electionId);
  const ds = DATASETS[electionId];
  if (!meta || !ds) return null;
  const party = scoredParties(ds).find((p) => partySlug(p) === slug);
  if (!party) return null;

  const rows = activeQuestions(ds.questions)
    .map((q) => {
      const pos = q.positions[party.key];
      if (pos === undefined || pos === NO_DATA) return null;
      return {
        text: q.text,
        href: `/${electionId}/issues/${issueSlug(q.text)}`,
        stance: STANCE[pos]!,
        tvfy: tvfyPolicy(q.id),
      };
    })
    .filter((x): x is { text: string; href: string; stance: string; tvfy: string } => x !== null);

  return {
    seo: {
      title: `${party.displayName} voting record — ${meta.shortLabel} — how2vote`,
      description: clampDesc(
        `How ${party.displayName} is recorded voting in federal parliament across the ${rows.length} propositions scored for the ${meta.label}, linked to They Vote For You.`,
      ),
    },
    name: party.displayName,
    independent: party.kind === "independent",
    year: meta.year,
    label: meta.label,
    hubHref: `/${electionId}/parties`,
    rows,
    merge: mergeFor(electionId, ds, party.key, partyHrefs(electionId, ds)),
    // Registered-name / branch consolidation, excluding the display name itself.
    aliases: party.aliases.filter((a) => a.toLowerCase() !== party.displayName.toLowerCase()),
  };
}

// ─── URL enumeration for sitemap.xml / llms.txt ──────────────────────────────────────────────────

/** Past-election landing paths (`/2019`, `/2022`); the current election's landing lives at `/`. */
export const electionLandingPaths = (): string[] =>
  ELECTIONS.filter((e) => !e.current).map((e) => `/${e.id}`);

/** Hub paths for every election (electorates / issues / parties). */
export function hubPaths(): string[] {
  return ELECTIONS.flatMap((e) => [`/${e.id}/electorates`, `/${e.id}/issues`, `/${e.id}/parties`]);
}

/** Every data-derived detail path across all elections (electorates, Senate, issues, parties). */
export function detailPaths(): string[] {
  return [
    ...electorateEntries().map((x) => `/${x.election}/electorates/${x.electorate}`),
    ...senateEntries().map((x) => `/${x.election}/senate/${x.state}`),
    ...issueEntries().map((x) => `/${x.election}/issues/${x.issue}`),
    ...partyEntries().map((x) => `/${x.election}/parties/${x.party}`),
  ];
}

/** All indexable content paths derived from the datasets, for the sitemap. */
export const contentPaths = (): string[] => [
  ...electionLandingPaths(),
  ...hubPaths(),
  ...detailPaths(),
];

// ─── /llms-full.txt — fully generated factual corpus (no hand-authored content) ─────────────────

/**
 * The complete, machine-readable data export for /llms-full.txt: every election's propositions,
 * party/independent voting records and candidate ballots, generated entirely from the committed
 * datasets. Nothing here is hand-written — it is the dataset rendered as plain text, so an answer
 * engine can cite the primary facts directly. Non-partisan by construction: recorded positions on
 * the 1–5 scale, no match score or ranking.
 */
export function fullCorpus(): string {
  const out: string[] = [
    `# ${SITE_NAME} — full data export`,
    `Generated from the committed dataset (${SITE_URL}). Every position below is a party's or independent's recorded parliamentary voting record, sourced from They Vote For You and placed on a 1–5 scale (strongly disagree … strongly agree). It is the record, not a prediction or endorsement; how2vote does not recommend a candidate or party. Candidate lists are as declared by the Australian Electoral Commission.`,
  ];

  for (const meta of ELECTIONS) {
    const ds = DATASETS[meta.id]!;
    out.push(`\n## ${meta.label} — data vintage ${ds.questions.dataVersion}`);

    const active = activeQuestions(ds.questions);
    out.push(`\n### Propositions (${active.length})`);
    for (const q of active) {
      const divs = q.divisionCount
        ? ` [${q.divisionCount} division${q.divisionCount === 1 ? "" : "s"}]`
        : "";
      out.push(`- (${q.id}) ${q.text} — ${tvfyPolicy(q.id)}${divs}`);
    }

    out.push(`\n### Party & independent voting records`);
    for (const p of scoredParties(ds).sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      out.push(
        `\n#### ${p.displayName}${p.kind === "independent" ? " (independent)" : ""} — ${SITE_URL}/${meta.id}/parties/${partySlug(p)}`,
      );
      for (const q of activeQuestions(ds.questions)) {
        const pos = q.positions[p.key];
        if (pos === undefined || pos === NO_DATA) continue;
        out.push(`- ${STANCE[pos]}: ${q.text}`);
      }
    }

    out.push(`\n### House candidates by electorate`);
    for (const s of ballotStates(ds)) {
      const seats = ds.ballots.electorates
        .filter((e) => e.state.toUpperCase() === s.code)
        .sort((a, b) => a.electorate.localeCompare(b.electorate));
      for (const e of seats) {
        out.push(
          `\n#### ${e.electorate} (${s.name}) — ${SITE_URL}/${meta.id}/electorates/${slugify(e.electorate)}`,
        );
        for (const c of ds.ballots.house
          .filter((c) => c.division.trim().toLowerCase() === e.electorate.trim().toLowerCase())
          .sort((a, b) => a.position - b.position)) {
          out.push(
            `- ${c.position}. ${c.candidate}${c.party ? ` (${c.party})` : " (Independent)"}`,
          );
        }
      }
    }

    out.push(`\n### Senate candidates by state`);
    for (const s of ballotStates(ds)) {
      out.push(`\n#### ${s.name} — ${SITE_URL}/${meta.id}/senate/${stateSlug(s.code)}`);
      for (const c of ds.ballots.senate
        .filter((c) => c.state.toUpperCase() === s.code)
        .sort((a, b) => a.group.localeCompare(b.group) || a.position - b.position)) {
        out.push(`- [${c.group}] ${c.candidate}${c.party ? ` (${c.party})` : ""}`);
      }
    }
  }

  return out.join("\n") + "\n";
}
