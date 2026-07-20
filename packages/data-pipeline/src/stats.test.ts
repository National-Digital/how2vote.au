import { describe, expect, it } from "vitest";
import type { Dataset } from "@how2vote/data-schema";
import {
  buildStats,
  complementaryStateSuppression,
  type CounterRows,
  type PartyStatView,
  type PropositionStatView,
  type StatsFile,
} from "./stats.js";

// Minimal dataset: two parties, two propositions. Only the fields buildStats touches (party
// labels/order and proposition titles) are populated — no scoring happens here any more; the
// counters arrive pre-derived and pre-cohorted (ADR-0008).
const dataset = {
  questions: {
    questions: [
      { id: 1, text: "Proposition one.", positions: { A: 5, B: 1 } },
      { id: 2, text: "Proposition two.", positions: { A: 5, B: 1 } },
    ],
  },
  parties: {
    parties: [
      { key: "A", displayName: "Party A" },
      { key: "B", displayName: "Party B" },
    ],
    merges: [],
  },
} as unknown as Dataset;

/**
 * The DB views gate every cell at k BEFORE buildStats sees it (migration 0006), so this fixture
 * simulates that: it derives the national marginal (sum across ALL states, incl. the unknown-state
 * bucket) and the per-state cells from abstract cells, then drops anything below `GATE_K` — exactly
 * what v_public_demographic_national / v_public_demographic_state emit. `GATE_K` mirrors
 * `opts.minCell`. Feeding buildStats already-gated cells is the whole contract: complementary
 * suppression relies on never seeing a sub-k cell.
 */
const GATE_K = 3;

/** Counter fixture: n scored responses in one (cohort, state, age bucket, party) cell. */
type Cell = { cohort?: string; state?: string | null; age?: string; party?: string; n: number };
function counters(
  cells: Cell[],
  propositions: CounterRows["propositions"] = [],
  gateK = GATE_K,
): CounterRows {
  const cohortOf = (c: Cell) => c.cohort ?? "historical";
  const stateOf = (c: Cell) => (c.state === undefined ? "NSW" : c.state);
  const bucketOf = (c: Cell) => c.age ?? "35–44";
  const partyOf = (c: Cell) => c.party ?? "A";

  const responseTotals = new Map<string, { cohort: string; stateCode: string | null; n: number }>();
  // National marginal: SUM across ALL states, incl. the unknown-state ('') / null bucket.
  const nat = new Map<string, { cohort: string; bucket: string; party: string; n: number }>();
  // Per-state interior: real (non-null) states only.
  const st = new Map<
    string,
    { cohort: string; stateCode: string; bucket: string; party: string; n: number }
  >();

  for (const c of cells) {
    const cohort = cohortOf(c);
    const state = stateOf(c);
    const bucket = bucketOf(c);
    const party = partyOf(c);

    const rk = `${cohort}|${state}`;
    const re = responseTotals.get(rk) ?? { cohort, stateCode: state, n: 0 };
    re.n += c.n;
    responseTotals.set(rk, re);

    const nk = `${cohort}|${bucket}|${party}`;
    const ne = nat.get(nk) ?? { cohort, bucket, party, n: 0 };
    ne.n += c.n;
    nat.set(nk, ne);

    if (state !== null) {
      const sk = `${cohort}|${state}|${bucket}|${party}`;
      const se = st.get(sk) ?? { cohort, stateCode: state, bucket, party, n: 0 };
      se.n += c.n;
      st.set(sk, se);
    }
  }

  return {
    responseTotals: [...responseTotals.values()].map((e) => ({
      cohort: e.cohort,
      stateCode: e.stateCode,
      responses: e.n,
    })),
    demographicsNational: [...nat.values()]
      .filter((e) => e.n >= gateK)
      .map((e) => ({
        cohort: e.cohort,
        dimension: "age",
        bucket: e.bucket,
        party: e.party,
        n: e.n,
      })),
    demographicsState: [...st.values()]
      .filter((e) => e.n >= gateK)
      .map((e) => ({
        cohort: e.cohort,
        stateCode: e.stateCode,
        dimension: "age",
        bucket: e.bucket,
        party: e.party,
        n: e.n,
      })),
    propositions,
  };
}

const opts = {
  generatedAt: "2026-07-13T00:00:00.000Z",
  electionId: "2025",
  electionLabel: "2025 Federal Election",
  minCell: GATE_K,
  dashboardMin: 5,
};

const partyView = (views: StatsFile["views"], id: string): PartyStatView | undefined =>
  views.find((v): v is PartyStatView => v.kind === "party" && v.id === id);
const national = (v: PartyStatView | undefined) => v?.geos.find((g) => g.scope === "national");

describe("buildStats disclosure control", () => {
  it("hides everything below the dashboard minimum", () => {
    const stats = buildStats(counters([{ n: 3 }]), dataset, opts);
    expect(stats.published).toBe(false);
    expect(stats.views).toEqual([]);
    expect(stats.cohorts[0]?.published).toBe(false);
    expect(stats.totalResponses).toBe(3);
  });

  it("counts only scored responses — the denominators come from response_total alone", () => {
    // 5 scored responses; an unscored (all-skips) contribution never increments response_total
    // at ingestion, so it simply is not here to count.
    const stats = buildStats(counters([{ n: 5 }]), dataset, opts);
    expect(stats.totalResponses).toBe(5);
  });

  it("suppresses party cells below minCell and never publishes the true bucket total", () => {
    // In the 35–44 bucket: 5 match A (kept), 2 match B (suppressed). shown must be 5, not 7 — so the
    // suppressed remainder (2) is NOT recoverable by subtracting the visible cell from a total.
    const stats = buildStats(
      counters([
        { party: "A", n: 5 },
        { party: "B", n: 2 },
      ]),
      dataset,
      opts,
    );
    const bucket = national(partyView(stats.views, "top-party-by-age"))?.buckets.find(
      (b) => b.key === "35–44",
    );
    expect(bucket?.cells.map((c) => c.key)).toEqual(["A"]);
    expect(bucket?.cells[0]?.count).toBe(5);
    expect(bucket?.shown).toBe(5); // NOT 7 — the true total is never emitted
  });

  it("drops a bucket entirely when no cell survives suppression", () => {
    const stats = buildStats(
      counters([
        { age: "35–44", party: "A", n: 5 },
        { age: "65–74", party: "B", n: 2 },
      ]),
      dataset,
      opts,
    );
    const buckets = national(partyView(stats.views, "top-party-by-age"))?.buckets ?? [];
    expect(buckets.some((b) => b.key === "65–74")).toBe(false); // 2 < minCell
    expect(buckets.some((b) => b.key === "35–44")).toBe(true);
  });

  it("uses the same k threshold for every dimension (no special-case number)", () => {
    // A count of 4 clears minCell (3) identically on a plain and a sensitive-category dimension.
    const base = counters([{ n: 4 }]);
    const withReligion: CounterRows = {
      ...base,
      demographicsNational: [
        ...base.demographicsNational,
        // Religion is sensitive → national-only (no state key).
        { cohort: "historical", dimension: "religion", bucket: "Christian", party: "A", n: 4 },
      ],
    };
    const stats = buildStats(withReligion, dataset, { ...opts, dashboardMin: 4 });
    const age = national(partyView(stats.views, "top-party-by-age"))?.buckets[0];
    const religion = national(partyView(stats.views, "top-party-by-religion"))?.buckets[0];
    expect(age?.cells[0]?.count).toBe(4);
    expect(religion?.cells[0]?.count).toBe(4); // survives at k = 3, no separate threshold applied
  });

  it("rolls up national + per-state, keeping states only when they fully reconstruct the marginal", () => {
    // Every state clears k and together they ARE the national total, so nothing is hidden: it is
    // safe to publish national + both states (marginal − states = 0, no cell to isolate).
    const stats = buildStats(
      counters([
        { state: "NSW", n: 6 },
        { state: "VIC", n: 5 },
      ]),
      dataset,
      opts,
    );
    const view = partyView(stats.views, "top-party-by-age");
    const scopes = view?.geos.map((g) => g.code);
    expect(view?.geos.find((g) => g.scope === "national")?.buckets[0]?.cells[0]?.count).toBe(11);
    expect(scopes).toContain("NSW");
    expect(scopes).toContain("VIC");
  });

  it("complementary suppression: a thin state that would be differenced out drops the whole series", () => {
    // NSW: 6 (clears k=3), VIC: 2 (below k, dropped by the view). National marginal: 8.
    // Publishing national 8 + NSW 6 would leak VIC = 8 − 6 = 2 by subtraction. Complementary
    // suppression must therefore drop the NSW cell too, leaving only the national marginal.
    const stats = buildStats(
      counters([
        { state: "NSW", n: 6 },
        { state: "VIC", n: 2 },
      ]),
      dataset,
      opts,
    );
    const view = partyView(stats.views, "top-party-by-age");
    const nat = view?.geos.find((g) => g.scope === "national")?.buckets[0]?.cells[0];
    expect(nat?.count).toBe(8); // the marginal (incl. the hidden VIC 2) still publishes
    // No per-state geography survives — so 8 − (published states) can never isolate VIC.
    expect(view?.geos.filter((g) => g.scope === "state")).toEqual([]);
  });

  it("complementary suppression: an unknown-state contribution folded into the marginal hides all states", () => {
    // NSW 6 + VIC 6 clear k, but 4 more were collected with an unknown state (null). The national
    // marginal is 16; the two published states sum to 12, so 16 − 12 = 4 would reveal the
    // unknown-state count. All per-state cells must therefore be suppressed.
    const stats = buildStats(
      counters([
        { state: "NSW", n: 6 },
        { state: "VIC", n: 6 },
        { state: null, n: 4 },
      ]),
      dataset,
      opts,
    );
    const view = partyView(stats.views, "top-party-by-age");
    expect(view?.geos.find((g) => g.scope === "national")?.buckets[0]?.cells[0]?.count).toBe(16);
    expect(view?.geos.filter((g) => g.scope === "state")).toEqual([]);
  });

  it("KEY RULE: a sensitive dimension never yields a state geography, even from hostile rows", () => {
    // The store never holds a state-keyed sensitive row; even if one appeared, the generator must
    // not produce a state roll-up for a sensitive dimension (defence in depth). Sensitive rows are
    // national-only, so they arrive on demographicsNational.
    const rows: CounterRows = {
      responseTotals: [{ cohort: "historical", stateCode: "NSW", responses: 10 }],
      demographicsNational: [
        {
          cohort: "historical",
          dimension: "religion",
          bucket: "Christian",
          party: "A",
          n: 10,
        },
      ],
      demographicsState: [
        // A hostile state-keyed sensitive row (should never exist) must still yield no state geo.
        {
          cohort: "historical",
          stateCode: "NSW",
          dimension: "religion",
          bucket: "Christian",
          party: "A",
          n: 10,
        },
      ],
      propositions: [],
    };
    const stats = buildStats(rows, dataset, opts);
    const view = partyView(stats.views, "top-party-by-religion");
    expect(view?.geos.map((g) => g.scope)).toEqual(["national"]);
  });

  it("never publishes a party key that is not in the compiled dataset", () => {
    const rows: CounterRows = {
      responseTotals: [{ cohort: "historical", stateCode: "NSW", responses: 20 }],
      demographicsNational: [
        { cohort: "historical", dimension: "age", bucket: "35–44", party: "A", n: 10 },
        // A hostile client fabricated a slug and pushed it over k — it must still never appear.
        {
          cohort: "historical",
          dimension: "age",
          bucket: "35–44",
          party: "fabricated_slug",
          n: 10,
        },
      ],
      demographicsState: [
        {
          cohort: "historical",
          stateCode: "NSW",
          dimension: "age",
          bucket: "35–44",
          party: "A",
          n: 10,
        },
      ],
      propositions: [],
    };
    const stats = buildStats(rows, dataset, opts);
    const cells = national(partyView(stats.views, "top-party-by-age"))?.buckets[0]?.cells ?? [];
    expect(cells.map((c) => c.key)).toEqual(["A"]);
  });

  it("publishes proposition stance distributions, suppressing thin categories", () => {
    // 5 agree + 4 disagree on proposition 1; 2 neutral (suppressed at minCell 3).
    const stats = buildStats(
      counters(
        [{ n: 11 }],
        [
          { cohort: "historical", propositionId: 1, stance: "agree", n: 5 },
          { cohort: "historical", propositionId: 1, stance: "disagree", n: 4 },
          { cohort: "historical", propositionId: 1, stance: "neutral", n: 2 },
        ],
      ),
      dataset,
      opts,
    );
    const prop = stats.views.find(
      (v): v is PropositionStatView => v.kind === "proposition" && v.propositionId === 1,
    );
    const overall = prop?.geos[0]?.buckets[0];
    expect(prop?.title).toBe("Proposition one.");
    expect(overall?.cells.find((c) => c.key === "agree")?.count).toBe(5);
    expect(overall?.cells.find((c) => c.key === "disagree")?.count).toBe(4);
    expect(overall?.cells.some((c) => c.key === "neutral")).toBe(false); // 2 < minCell → absent
    expect(overall?.shown).toBe(9); // sum of surviving cells only
  });

  it("passes through metadata", () => {
    const stats = buildStats(counters([{ n: 5 }]), dataset, opts);
    expect(stats.schemaVersion).toBe(3);
    expect(stats.generatedAt).toBe(opts.generatedAt);
    expect(stats.electionId).toBe("2025");
    expect(stats.electionLabel).toBe("2025 Federal Election");
    expect(stats.minCell).toBe(3);
    expect(stats.published).toBe(true);
  });

  it("segments into per-context cohorts and never publishes a combined 'all' cell-view", () => {
    // Single context present → one cohort; top-level views mirror it (no differencing risk).
    const oneContext = buildStats(counters([{ cohort: "historical", n: 6 }]), dataset, opts);
    expect(oneContext.cohorts.map((c) => c.key)).toEqual(["historical"]);
    expect(oneContext.views).toEqual(oneContext.cohorts[0]!.views);

    // Two contexts present → the two cohorts only, in COHORT_META order, with NO combined "all"
    // cohort and NO top-level combined cell-view (that would be a differencing oracle).
    const twoContexts = buildStats(
      counters([
        { cohort: "live", n: 6 },
        { cohort: "historical", n: 6 },
      ]),
      dataset,
      opts,
    );
    expect(twoContexts.cohorts.map((c) => c.key)).toEqual(["live", "historical"]);
    expect(twoContexts.cohorts.some((c) => c.key === "all")).toBe(false);
    expect(twoContexts.views).toEqual([]); // no combined cell-view published
    expect(twoContexts.totalResponses).toBe(12); // a bare total is not attribute data
  });

  it("a cohort below the dashboard minimum is present but unpublished with no views", () => {
    const stats = buildStats(
      counters([
        { cohort: "live", n: 6 },
        { cohort: "historical", n: 3 },
      ]),
      dataset,
      opts,
    );
    const historical = stats.cohorts.find((c) => c.key === "historical");
    expect(historical?.published).toBe(false);
    expect(historical?.views).toEqual([]);
    expect(historical?.totalResponses).toBe(3);
    expect(stats.cohorts.find((c) => c.key === "live")?.published).toBe(true);
  });

  it("per-cohort suppression is exact: a cell clearing k only when cohorts combine publishes nowhere", () => {
    // 2 + 2 across two cohorts (minCell 3): combined would clear k, but cohorts are keyed apart
    // at ingestion and suppressed apart here, so neither publishes the cell.
    const stats = buildStats(
      counters([
        { cohort: "live", n: 6 },
        { cohort: "historical", n: 6 },
        { cohort: "live", age: "65–74", party: "B", n: 2 },
        { cohort: "historical", age: "65–74", party: "B", n: 2 },
      ]),
      dataset,
      opts,
    );
    for (const cohort of stats.cohorts) {
      const buckets = national(partyView(cohort.views, "top-party-by-age"))?.buckets ?? [];
      expect(buckets.some((b) => b.key === "65–74")).toBe(false);
    }
  });

  it("invariant: every bucket's shown equals the sum of its published cells (no leaked total)", () => {
    const stats = buildStats(
      counters(
        [
          { age: "35–44", party: "A", n: 8 },
          { age: "35–44", party: "B", n: 4 },
          { age: "65–74", party: "A", n: 6 },
        ],
        [
          { cohort: "historical", propositionId: 1, stance: "agree", n: 12 },
          { cohort: "historical", propositionId: 1, stance: "disagree", n: 2 },
        ],
      ),
      dataset,
      opts,
    );
    for (const cohort of stats.cohorts) {
      for (const view of cohort.views) {
        for (const geo of view.geos) {
          for (const bucket of geo.buckets) {
            const sum = bucket.cells.reduce((n, c) => n + c.count, 0);
            expect(bucket.shown).toBe(sum);
          }
        }
      }
    }
  });

  it("records an immutable release block with k, the suppression rules and the date", () => {
    const stats = buildStats(counters([{ n: 6 }]), dataset, opts);
    expect(stats.release.k).toBe(opts.minCell);
    expect(stats.release.date).toBe("2026-07-13");
    expect(stats.release.releaseId).toMatch(/^rel-2025-[0-9a-f]{16}$/);
    expect(stats.release.suppressionRules.length).toBeGreaterThan(0);
    // Content-addressed: identical inputs → identical release id (immutable per content).
    const again = buildStats(counters([{ n: 6 }]), dataset, opts);
    expect(again.release.releaseId).toBe(stats.release.releaseId);
    // Different data → different id.
    const more = buildStats(counters([{ n: 60 }]), dataset, opts);
    expect(more.release.releaseId).not.toBe(stats.release.releaseId);
  });
});

describe("complementaryStateSuppression (differencing defence)", () => {
  it("keeps every state cell when the states exactly reconstruct the national marginal", () => {
    const cells = [
      { stateCode: "NSW", count: 60 },
      { stateCode: "VIC", count: 40 },
    ];
    expect(complementaryStateSuppression(100, cells)).toEqual(cells);
  });

  it("DIFFERENCING ATTACK: a single sub-k state hidden behind a published marginal is defeated", () => {
    // National marginal = 100. NSW 46 + VIC 46 clear k and publish; QLD 8 is below k and was dropped
    // by the DB view, so it is absent here. Naively publishing national 100 with NSW 46 + VIC 46
    // would reveal QLD = 100 − 46 − 46 = 8. Complementary suppression must drop ALL state cells.
    const published = [
      { stateCode: "NSW", count: 46 },
      { stateCode: "VIC", count: 46 },
    ];
    // Prove the attack works against the naive (un-suppressed) publication:
    const naiveResidual = 100 - published.reduce((s, c) => s + c.count, 0);
    expect(naiveResidual).toBe(8); // == the hidden QLD cell → a leak

    // The defence removes the complementary cells so no residual can be isolated:
    expect(complementaryStateSuppression(100, published)).toEqual([]);
  });

  it("suppresses everything when an unpublished national marginal accompanies state cells (fail closed)", () => {
    // A state cell cannot clear k unless its marginal does; a null marginal here is an inconsistency.
    expect(complementaryStateSuppression(null, [{ stateCode: "NSW", count: 20 }])).toEqual([]);
  });

  it("returns nothing when there are no state cells", () => {
    expect(complementaryStateSuppression(100, [])).toEqual([]);
  });
});
