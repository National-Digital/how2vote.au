# 0013 — Provisional quiz for an upcoming election

**Status:** Accepted
**Extends:** [0006](0006-legal-compliance-rebuild.md) (official ballot order, no ranking; ballot-order
gating of the plan builder)
**Relates to:** [0005](0005-tvfy-snapshot-lock.md) (TVFY snapshot lock), [0010](0010-constrained-product-boundary.md)
(constrained product boundary)

## Context

We want to offer a comparison quiz for the **next** federal election _before it is announced_ — before
a writ is issued, before nominations, before the ballot draw. In that window three things are true and
will keep changing until the AEC timetable locks them:

- there is **no ballot** — candidates are not nominated, and even once nominated the printed order
  (the ballot draw) is not declared;
- the **questions** are provisional — the curated proposition set is still being tuned against the
  parliamentary record and may be added to, reworded or pruned repeatedly;
- there is **no polling day** — the date sequence is not yet defined.

The product already models an election's lifecycle with `ElectionPhase` (`upcoming | live | archived`,
`packages/data-schema/src/elections.ts`), and `upcoming` already keeps the plan builder closed
(`plansEnabled` on the card requires `phase !== "upcoming"`). What it did **not** have was (a) a dataset
that can exist with no candidates, (b) a defined answer to "what order do we show candidates in when
there is no lawful order yet", and (c) a share link that stays honest as the questions change. This ADR
records those three decisions. It does not change anything for a `live` or `archived` election.

## Decision

**D1 — A ballot has a lifecycle status; empty ballots are legal only when explicitly pending.**
`ballotsSchema` gains `ballotStatus: "pending" | "provisional" | "drawn"` (optional; an omitted value
means `drawn`, so every historical dataset is unchanged and keeps the original non-empty guarantee).

- `pending` — no candidates yet. The House/Senate arrays **must** be empty; the card shows the party
  voting-record alignment only. This is what an as-yet-unannounced election ships as.
- `provisional` — candidates are nominated but the **ballot draw is not declared**, so `position` is
  not authoritative.
- `drawn` — the declaration of nominations has happened; `position` is the official printed order.

A schema refinement enforces the shape: a `pending` ballot may not carry candidates, and a
`provisional`/`drawn` ballot must carry the House, Senate and electorates it claims. This preserves the
old `min(1)` guarantee for every real election while letting a pre-nomination dataset be empty.

**D2 — Before the ballot draw, candidates are shown in a neutral randomised order — never official,
never score.** [ADR 0006](0006-legal-compliance-rebuild.md) fixed candidate display to **official
ballot order** with the alignment score as a per-row annotation, and forbade ranking by score
(Commonwealth Electoral Act 1918 s 351). That rule assumes an official order exists. Before the draw it
does not, and the alternatives all carry bias: alphabetical order advantages A-surnames (the very
"donkey vote" the AEC randomises the draw to blunt), and incumbency or registration order advantages
sitting parties. So for a `provisional` ballot the engine orders candidates by a **deterministic,
per-session seeded shuffle** (`seededOrder` in `packages/engine/src/ballot.ts`): stable within a
session (and for offline recompute of a shared link), unbiased across users, and still **not** ranked
by score and **not** presented as the official ballot. When the status becomes `drawn`, the engine
reverts to the strict official-order sort. The plan builder stays closed for the whole `upcoming` phase
regardless (D1 of ADR 0006 gating), so a provisional order can never be printed as a how-to-vote card.

**D3 — Provisional share links are pinned to the quiz version and keyed by policy id.** A shared
comparison encodes only the answers (never a chosen order — unchanged from ADR 0006). For a provisional
quiz the codec is version `v3` (`packages/engine/src/share.ts`):
`v3.<election-id>.<data-version>.<electorate-slug>.<payload>`.

- The payload names each answer by its **They Vote For You policy id** (the question `id`, which _is_
  the TVFY policy id — `questionSchema`), not by position. An answer's binding to a proposition never
  depends on question ordering.
- The link carries the dataset's `dataVersion`, and `decodeShare` refuses to decode unless it
  byte-matches the election's **current** `dataVersion`. Any change to a provisional quiz bumps
  `dataVersion`, so a stale link **fails closed to "start again"** rather than silently rebinding old
  answers to a proposition that has since changed. Live/archived elections keep the durable positional
  `v2` codec.

**D4 — The lifecycle is an election-registry field, and the survey tracks it.** A placeholder election
that targets a parliament period has no AEC timetable, so its stage cannot be derived from milestones.
`electionMetaSchema` gains `provisionalStage: "pending" | "provisional" | "drawn"` (set only when there
is no `timetable`; a scheduled election derives its lifecycle from the timetable as before), and `date`
becomes optional for such a placeholder (no polling day yet). The research ingestion endpoint uses this
stage as the **collection cohort** for a timetable-less election (`cohortFor` in `functions/api/research.ts`),
so a `pending` wave (questions in flight) is never mixed with a `provisional` one (questions locked) —
a deliberate **series break**, recorded in `docs/research/analysis-plan.md` and `aggregate-provenance.json`.
The lifecycle is: `pending` (questions in flight, no candidates) → `provisional` (questions locked,
candidates not yet drawn → D2 randomised order) → `drawn` (everything locked; the election is being
called and gains a real timetable, graduating to a normal election).

**D5 — What ships now.** The `next` election is registered (`id: "next"`, a non-year placeholder so the
year-keyed provenance gates treat it as the in-flight quiz it is) as `pending`: a party-alignment-only
comparison, no candidates, no printable plan, consistent with [ADR 0010](0010-constrained-product-boundary.md)'s
party-panel score placement. Its 25 propositions are selected from They Vote For You policies the
**current (48th) Parliament has actually divided on** (division dates since the 2025-05-03 election);
the party positions are the standard all-time TVFY agreement compile (the API exposes no per-division
member votes, so the *selection*, not the score, is what is current-parliament). The `provisional`
randomised-candidate path (D2) is built and unit-tested but is **not exercised by any shipped dataset**:
it is the mechanism for the later nominated-but-not-drawn window, not a candidate list shown today.

## Consequences

- No change to any `live` or `archived` election: `ballotStatus` defaults to `drawn`, `mapBallot`'s
  official-order sort and the golden card outputs are untouched, and existing `v1`/`v2` share links
  keep decoding.
- The plan builder / how-to-vote print remains closed for the entire `upcoming` phase (ADR 0006), so a
  provisional card can never be printed or a provisional order presented as instructions to vote.
  Provisional shared results are read-only, exactly like a shared card today (ADR 0010 print-auth
  model): no build stage, no print, no save.
- A provisional quiz can be re-tuned freely: bumping `dataVersion` invalidates old share links by
  design instead of corrupting them.
- **Deferred / still human-gated:** the electoral-law view on showing a randomised pre-draw candidate
  list (D2) before it is switched on for a real nominated field; the electorate-picker experience for a
  party-alignment-only quiz; and whether the upcoming election becomes the default landing selection.
  These are not enabled by shipping the `pending` placeholder.

This ADR is an engineering and product implementation record, not legal advice; the electoral-law
position requires the sign-off of a qualified Australian practitioner before an election.
