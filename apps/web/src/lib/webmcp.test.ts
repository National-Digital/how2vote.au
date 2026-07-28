import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CURRENT_ELECTION_ID, ELECTION_IDS } from "@how2vote/data-schema";
import type { Dataset } from "@how2vote/data-schema";
import { loadData } from "./data";
import {
  findElectorate,
  listCandidates,
  listPropositions,
  methodology,
  partyPosition,
  registerWebmcpTools,
  webmcpTools,
} from "./webmcp";

// A ballot-bearing election: these tests exercise the electorate/candidate tools, which need a real
// ballot. The default (current) election is now the ballot-less upcoming "next" comparison, so pin a
// past election with candidates rather than CURRENT_ELECTION_ID.
const EL = "2025";
let ds: Dataset;

beforeAll(async () => {
  ds = (await loadData(EL)).dataset;
});

describe("findElectorate", () => {
  it("matches by name and returns the canonical page URL", () => {
    const first = ds.ballots.electorates[0]!;
    const out = findElectorate(ds, EL, { query: first.electorate });
    expect(out).toContain(first.electorate);
    expect(out).toContain(`/${EL}/electorates/`);
  });

  it("filters by state code", () => {
    const out = findElectorate(ds, EL, { state: "ACT" });
    const actCount = ds.ballots.electorates.filter((e) => e.state.toUpperCase() === "ACT").length;
    expect(out).toContain(`${actCount} electorate(s) match`);
  });

  it("explains when nothing matches", () => {
    expect(findElectorate(ds, EL, { query: "zzzznotreal" })).toMatch(
      /No federal electorate matches/,
    );
  });
});

describe("listCandidates", () => {
  it("lists the House ballot for a known electorate", () => {
    const div = ds.ballots.house[0]!.division;
    const out = listCandidates(ds, EL, { electorate: div });
    expect(out).toContain(div);
    expect(out).toMatch(/House ballot \(\d+\)/);
  });

  it("can include the Senate ballot", () => {
    const div = ds.ballots.house[0]!.division;
    expect(listCandidates(ds, EL, { electorate: div, chamber: "both" })).toMatch(/Senate ballot/);
  });

  it("guides the caller when the electorate is unknown", () => {
    expect(listCandidates(ds, EL, { electorate: "Nowhere" })).toMatch(/find_electorate/);
  });
});

describe("partyPosition", () => {
  it("resolves a party by name and lists recorded positions with labels", () => {
    const out = partyPosition(ds, EL, { party: "Labor" });
    expect(out).toMatch(/recorded positions/);
    expect(out).toMatch(/strongly agree|agree|equal merits|disagree|strongly disagree/);
    expect(out).toContain("theyvoteforyou.org.au/policies/");
  });

  it("filters to a matching issue", () => {
    const word = ds.questions.questions[0]!.text.split(" ")[0]!;
    const out = partyPosition(ds, EL, { party: "Labor", issue: word });
    expect(out.length).toBeGreaterThan(0);
  });

  it("reports no match for an unknown party", () => {
    expect(partyPosition(ds, EL, { party: "Definitely Not A Party" })).toMatch(
      /No party or independent/,
    );
  });
});

describe("listPropositions / methodology", () => {
  it("lists every proposition with both links", () => {
    const out = listPropositions(ds, EL);
    expect(out).toContain(`/${EL}/issues/`);
    expect(out).toContain("theyvoteforyou.org.au/policies/");
    expect((out.match(/theyvoteforyou\.org\.au\/policies\//g) ?? []).length).toBe(
      ds.questions.questions.length,
    );
  });

  it("explains the method and links the methodology page", () => {
    expect(methodology()).toContain("/methodology");
  });
});

describe("tool registry", () => {
  it("every tool is read-only-shaped: prefixed name, description, object schema, async execute", () => {
    expect(webmcpTools.length).toBe(5);
    const names = webmcpTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of webmcpTools) {
      expect(t.name.startsWith("how2vote_")).toBe(true);
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.inputSchema as { type: string }).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });
});

describe("tools are invocable end-to-end (through execute, as an agent calls them)", () => {
  // Capture the tools exactly as they are registered, then drive them through execute() — the real
  // path (resolveElection → loadData → the MCP text envelope), not the pure helpers directly.
  type Exec = (
    args: Record<string, unknown>,
  ) => Promise<{ content: { type: string; text: string }[] }>;
  const registered = new Map<string, Exec>();

  beforeAll(() => {
    vi.stubGlobal("navigator", {
      modelContext: {
        registerTool: (t: { name: string; execute: Exec }) => registered.set(t.name, t.execute),
      },
    });
    registerWebmcpTools();
    vi.unstubAllGlobals();
  });

  const call = (name: string, args: Record<string, unknown> = {}) => registered.get(name)!(args);

  it("captured a callable execute for every tool", () => {
    expect([...registered.keys()].sort()).toEqual(webmcpTools.map((t) => t.name).sort());
  });

  it("every tool returns a non-empty MCP text envelope", async () => {
    const div = ds.ballots.house[0]!.division;
    const cases: [string, Record<string, unknown>][] = [
      ["how2vote_find_electorate", { state: "ACT" }],
      ["how2vote_list_candidates", { electorate: div, chamber: "both" }],
      ["how2vote_get_party_position", { party: "Labor" }],
      ["how2vote_list_propositions", {}],
      ["how2vote_get_methodology", {}],
    ];
    for (const [name, args] of cases) {
      const res = await call(name, args);
      expect(res.content).toHaveLength(1);
      expect(res.content[0]!.type).toBe("text");
      expect(res.content[0]!.text.length).toBeGreaterThan(0);
    }
  });

  it("execute wires args through to the underlying data (matches the pure helper)", async () => {
    // Pass the election explicitly — the default (current) election is now the ballot-less "next"
    // comparison, so an unqualified electorate lookup would resolve to a set with no electorates.
    const res = await call("how2vote_find_electorate", { election: EL, state: "ACT" });
    expect(res.content[0]!.text).toBe(findElectorate(ds, EL, { state: "ACT" }));
    expect(res.content[0]!.text).toContain(`/${EL}/electorates/`);
  });

  it("honours the election arg and falls back to the current election when it is unknown", async () => {
    const past = ELECTION_IDS.find((id) => id !== CURRENT_ELECTION_ID)!;
    expect(
      (await call("how2vote_list_propositions", { election: past })).content[0]!.text,
    ).toContain(`/${past}/issues/`);
    // An unknown election id resolves to the current election rather than erroring.
    expect(
      (await call("how2vote_list_propositions", { election: "1901" })).content[0]!.text,
    ).toContain(`/${CURRENT_ELECTION_ID}/issues/`);
  });
});

describe("registerWebmcpTools", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Register against a stubbed provider at `location` and return the tool names it received. */
  const registerVia = (location: "document" | "navigator"): string[] => {
    const registered: { name: string }[] = [];
    const provider = { registerTool: (t: { name: string }) => registered.push(t) };
    vi.stubGlobal("document", location === "document" ? { modelContext: provider } : {});
    vi.stubGlobal("navigator", location === "navigator" ? { modelContext: provider } : {});
    registerWebmcpTools();
    return registered.map((t) => t.name).sort();
  };

  it("is a no-op (no throw) when the WebMCP API is absent", () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", {});
    expect(() => registerWebmcpTools()).not.toThrow();
  });

  it("registers all tools via document.modelContext (the current location)", () => {
    expect(registerVia("document")).toEqual(webmcpTools.map((t) => t.name).sort());
  });

  it("still registers via the deprecated navigator.modelContext", () => {
    expect(registerVia("navigator")).toEqual(webmcpTools.map((t) => t.name).sort());
  });

  it("never reads navigator.modelContext when document provides one", () => {
    // Reading the deprecated accessor is what emits the browser's deprecation warning, so document
    // must be probed first and navigator left untouched — not merely preferred as a result.
    const registered: { name: string }[] = [];
    let navigatorReads = 0;
    vi.stubGlobal("document", {
      modelContext: { registerTool: (t: { name: string }) => registered.push(t) },
    });
    vi.stubGlobal("navigator", {
      get modelContext() {
        navigatorReads += 1;
        return { registerTool: () => {} };
      },
    });
    registerWebmcpTools();
    expect(navigatorReads).toBe(0);
    expect(registered).toHaveLength(webmcpTools.length);
  });
});
