/**
 * WebMCP tool surface (read-only) for in-browser AI agents.
 *
 * WebMCP (the emerging W3C `modelContext` API — Edge ships it natively, Chrome runs it in
 * an origin trial as of 2026) lets a page expose callable tools to a browser-embedded agent. This
 * registers a small set of **read-only** tools that answer factual questions from the committed
 * dataset — find an electorate, list its candidates, look up a party's recorded position, list the
 * propositions, explain the method. It mirrors the public content pages exactly, so an agent gets
 * the same facts a visitor would, and every result carries the canonical page URL for citation.
 *
 * Deliberately read-only and non-partisan: no tool builds or scores a card (a card must reflect the
 * user's own answers, not an agent's guess), and every answer is the recorded voting record — no
 * match score, no ranking by valence. Registration is progressive: it is a no-op when the API is
 * absent, and the ~330 KB dataset is only fetched (via {@link loadData}) the first time a tool is
 * actually invoked, so it never touches normal page load.
 *
 * Read-only is a boundary, not an omission: do not add a tool that submits the contact or feedback
 * form. Those forms are proof-of-work gated to keep unattended automation off a human inbox, so
 * exposing them here would bypass a deliberate control. Recorded in
 * [ADR-0016](../../../../docs/adr/0016-deliberate-freeze-and-longevity.md) §3.
 *
 * NON-DURABLE / EXPERIMENTAL — do not treat as a supported surface. `modelContext` is a
 * pre-standard API (Chrome origin trial; a W3C Community Group draft, NOT on the Standards Track) and
 * may change or be withdrawn. This module is deliberately built to fail safe — it no-ops where the
 * API is absent, and every fact it returns is also served by the durable surfaces (public content
 * pages, schema.org, llms.txt). If the API rots, this can be deleted with zero user-facing loss. It
 * is intentionally excluded from the project's long-term durability guarantees; see
 * [ADR-0016](../../../../docs/adr/0016-deliberate-freeze-and-longevity.md) §3.
 */
import type { Dataset } from "@how2vote/data-schema";
import { CURRENT_ELECTION_ID, ELECTION_IDS, electionById } from "@how2vote/data-schema";
import { slugify } from "@how2vote/engine";
import { loadData } from "./data";
import { SITE_URL } from "./seo";
import { stateName } from "./data";

/** WebMCP tool result content (a subset of the MCP content shape — text only here). */
type ToolResult = { content: { type: "text"; text: string }[] };
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
};

/** The provider object, wherever the browser happens to hang it (see {@link modelContext}). */
type ModelContext = {
  registerTool(tool: Tool): unknown;
  unregisterTool?(name: string): unknown;
};

declare global {
  interface Navigator {
    /** @deprecated Moved to `document.modelContext`; kept for browsers still on the old location. */
    modelContext?: ModelContext;
  }
  interface Document {
    modelContext?: ModelContext;
  }
}

/** Recorded 1–5 position → the label the methodology uses. */
const LABEL: Record<number, string> = {
  5: "strongly agree",
  4: "agree",
  3: "equal merits",
  2: "disagree",
  1: "strongly disagree",
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

const electorateUrl = (el: string, name: string): string =>
  `${SITE_URL}/${el}/electorates/${slugify(name)}`;
const issueUrl = (el: string, textOf: string): string =>
  `${SITE_URL}/${el}/issues/${slugify(textOf)}`;
const partyUrl = (el: string, name: string): string => `${SITE_URL}/${el}/parties/${slugify(name)}`;

// ─── Pure tool logic (dataset in, text out) — exported so they can be unit-tested without the
//     browser API; the registered tools below are thin wrappers that load the dataset first. ─────

export function findElectorate(
  ds: Dataset,
  election: string,
  args: { query?: string; state?: string },
): string {
  const q = str(args.query).toLowerCase();
  const state = str(args.state).toUpperCase();
  let matches = ds.ballots.electorates.filter(
    (e) =>
      (!state || e.state.toUpperCase() === state) && (!q || e.electorate.toLowerCase().includes(q)),
  );
  matches = matches.sort(
    (a, b) => a.state.localeCompare(b.state) || a.electorate.localeCompare(b.electorate),
  );
  if (matches.length === 0) {
    return `No federal electorate matches that (${ds.ballots.electorates.length} exist). Try part of the name, or a state code like NSW/VIC.`;
  }
  const shown = matches.slice(0, 40);
  const lines = shown.map(
    (e) => `- ${e.electorate} (${stateName(e.state)}): ${electorateUrl(election, e.electorate)}`,
  );
  const more =
    matches.length > shown.length
      ? `\n…and ${matches.length - shown.length} more; narrow the query.`
      : "";
  return `${matches.length} electorate(s) match:\n${lines.join("\n")}${more}`;
}

export function listCandidates(
  ds: Dataset,
  election: string,
  args: { electorate?: string; chamber?: string },
): string {
  const name = str(args.electorate);
  if (!name) return "Provide an electorate name (see how2vote_find_electorate).";
  const electorate =
    ds.ballots.electorates.find((e) => eq(e.electorate, name)) ??
    ds.ballots.electorates.find((e) => slugify(e.electorate) === slugify(name)) ??
    ds.ballots.electorates.find((e) => e.electorate.toLowerCase().includes(name.toLowerCase()));
  if (!electorate) return `No electorate matches “${name}”. Use how2vote_find_electorate first.`;

  const chamber = str(args.chamber).toLowerCase() || "house";
  const parts: string[] = [
    `${electorate.electorate}, ${stateName(electorate.state)} — ${electionById(election)?.label}`,
  ];

  if (chamber === "house" || chamber === "both") {
    const house = ds.ballots.house
      .filter((c) => eq(c.division, electorate.electorate))
      .sort((a, b) => a.position - b.position)
      .map((c) => `  ${c.position}. ${c.candidate}${c.party ? ` (${c.party})` : " (Independent)"}`);
    parts.push(
      `House ballot (${house.length}):\n${house.join("\n")}\n${electorateUrl(election, electorate.electorate)}`,
    );
  }
  if (chamber === "senate" || chamber === "both") {
    const senate = ds.ballots.senate
      .filter((c) => eq(c.state, electorate.state))
      .sort((a, b) => a.group.localeCompare(b.group) || a.position - b.position)
      .map((c) => `  [${c.group}] ${c.candidate}${c.party ? ` (${c.party})` : ""}`);
    parts.push(
      `Senate ballot for ${stateName(electorate.state)} (${senate.length}):\n${senate.join("\n")}\n${SITE_URL}/${election}/senate/${electorate.state.toLowerCase()}`,
    );
  }
  return parts.join("\n\n");
}

export function partyPosition(
  ds: Dataset,
  election: string,
  args: { party?: string; issue?: string },
): string {
  const query = str(args.party);
  if (!query) return "Provide a party or independent name.";
  const norm = (s: string): string => s.trim().toLowerCase();
  const party =
    ds.parties.parties.find((p) => p.kind !== "office" && eq(p.displayName, query)) ??
    ds.parties.parties.find((p) => p.kind !== "office" && eq(p.aecName ?? "", query)) ??
    ds.parties.parties.find(
      (p) =>
        p.kind !== "office" &&
        (norm(p.displayName).includes(norm(query)) ||
          (p.aecName ? norm(p.aecName).includes(norm(query)) : false) ||
          p.aliases.some((a) => norm(a).includes(norm(query)))),
    );
  if (!party)
    return `No party or independent matches “${query}”. See ${SITE_URL}/${election}/parties`;

  const positioned = ds.questions.questions
    .map((q) => ({ q, pos: q.positions[party.key] ?? -1 }))
    .filter(
      (x): x is { q: (typeof ds.questions.questions)[number]; pos: 1 | 2 | 3 | 4 | 5 } =>
        x.pos >= 1,
    );
  if (positioned.length === 0) {
    return `${party.displayName} has no recorded parliamentary voting position in the ${electionById(election)?.label} dataset.`;
  }

  const issue = str(args.issue);
  const rows = (
    issue
      ? positioned.filter((x) => x.q.text.toLowerCase().includes(issue.toLowerCase()))
      : positioned
  ).map(
    (x) =>
      `- “${x.q.text}”: ${LABEL[x.pos]} (record: https://theyvoteforyou.org.au/policies/${x.q.id})`,
  );
  if (issue && rows.length === 0)
    return `${party.displayName} has no recorded position on a proposition matching “${issue}”.`;
  const head = `${party.displayName}${party.kind === "independent" ? " (independent)" : ""} — recorded positions (${rows.length}), ${electionById(election)?.label}:`;
  return `${head}\n${rows.join("\n")}\nFull record: ${partyUrl(election, party.displayName)}`;
}

export function listPropositions(ds: Dataset, election: string): string {
  const lines = ds.questions.questions.map(
    (q, i) =>
      `${i + 1}. ${q.text}\n   ${issueUrl(election, q.text)}  ·  https://theyvoteforyou.org.au/policies/${q.id}`,
  );
  return `The ${ds.questions.questions.length} propositions scored for the ${electionById(election)?.label}, each a real parliamentary policy:\n${lines.join("\n")}`;
}

export function methodology(): string {
  return [
    "How2Vote scores each Australian party on its recorded parliamentary votes (sourced from They Vote For You), then shows that alignment against the candidates on your House and Senate ballot — always in official ballot order. Candidates are never ranked and no preference is recommended.",
    "Each party's members' agreement figures (0–100) per issue are averaged and placed on a five-point scale (1 strongly disagree … 5 strongly agree). Your answers use the same scale; the match is points earned ÷ points possible. The method is public, deterministic and open-source.",
    `Full method: ${SITE_URL}/methodology`,
  ].join("\n\n");
}

// ─── Registration (progressive; no-op where WebMCP is unavailable) ──────────────────────────────

/** Resolve the requested election id to a known one, defaulting to the current election. */
function resolveElection(args: Record<string, unknown>): string {
  const requested = str(args.election);
  return requested && ELECTION_IDS.includes(requested) ? requested : CURRENT_ELECTION_ID;
}

const ELECTION_PROP = {
  election: {
    type: "string",
    enum: ELECTION_IDS,
    description: "Election id (defaults to the current election).",
  },
};

const TOOLS: Tool[] = [
  {
    name: "how2vote_find_electorate",
    description:
      "Find Australian federal electorates (House divisions) by name and/or state, returning each electorate and the URL of its candidate page.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of the electorate name, e.g. 'Wentworth'." },
        state: { type: "string", description: "State/territory code, e.g. NSW, VIC, QLD, ACT." },
        ...ELECTION_PROP,
      },
    },
    execute: async (args) => {
      const e = resolveElection(args);
      return text(findElectorate((await loadData(e)).dataset, e, args));
    },
  },
  {
    name: "how2vote_list_candidates",
    description:
      "List the candidates on the ballot in a given electorate. chamber = 'house' (default), 'senate' (the electorate's state) or 'both'.",
    inputSchema: {
      type: "object",
      properties: {
        electorate: { type: "string", description: "Electorate/House division name." },
        chamber: { type: "string", enum: ["house", "senate", "both"] },
        ...ELECTION_PROP,
      },
      required: ["electorate"],
    },
    execute: async (args) => {
      const e = resolveElection(args);
      return text(listCandidates((await loadData(e)).dataset, e, args));
    },
  },
  {
    name: "how2vote_get_party_position",
    description:
      "Look up a party's or independent's recorded parliamentary voting position on the propositions — all of them, or those matching an issue. Factual record only; no match score.",
    inputSchema: {
      type: "object",
      properties: {
        party: {
          type: "string",
          description: "Party or independent name, e.g. 'Australian Labor Party'.",
        },
        issue: {
          type: "string",
          description: "Optional keyword to filter propositions, e.g. 'climate'.",
        },
        ...ELECTION_PROP,
      },
      required: ["party"],
    },
    execute: async (args) => {
      const e = resolveElection(args);
      return text(partyPosition((await loadData(e)).dataset, e, args));
    },
  },
  {
    name: "how2vote_list_propositions",
    description:
      "List the parliamentary propositions the quiz is built from, each with its page URL and They Vote For You policy link.",
    inputSchema: { type: "object", properties: { ...ELECTION_PROP } },
    execute: async (args) => {
      const e = resolveElection(args);
      return text(listPropositions((await loadData(e)).dataset, e));
    },
  },
  {
    name: "how2vote_get_methodology",
    description:
      "Explain how How2Vote scores parties and builds a voting comparison and worksheet.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => text(methodology()),
  },
];

export { TOOLS as webmcpTools };

/**
 * Locate the WebMCP provider. The API moved from `navigator.modelContext` to `document.modelContext`,
 * so both are probed. `document` must be probed first: reading the `navigator` property is what emits
 * the deprecation warning, so this order keeps a current browser off the deprecated accessor while a
 * browser still on the old location continues to work.
 */
function modelContext(): ModelContext | undefined {
  const fromDocument = typeof document === "undefined" ? undefined : document.modelContext;
  if (fromDocument) return fromDocument;
  return typeof navigator === "undefined" ? undefined : navigator.modelContext;
}

/**
 * Register the read-only tools with the browser's WebMCP provider, if one is present. Safe to call
 * unconditionally on mount: it feature-detects the provider, is a no-op otherwise, and swallows a
 * duplicate-registration rejection (e.g. a Svelte re-mount in dev).
 */
export function registerWebmcpTools(): void {
  const mc = modelContext();
  if (!mc || typeof mc.registerTool !== "function") return;
  for (const tool of TOOLS) {
    try {
      const result = mc.registerTool(tool);
      // registerTool returns a promise that rejects on a duplicate name; swallow it.
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch {
      /* unsupported shape or already registered — ignore */
    }
  }
}
