# 0005 — TVFY snapshot & lock: "lock the election release, not the underlying truth"

**Status:** Accepted
**Relates to:** [0002](0002-multi-election-support.md) (multi-election data),
[0006](0006-legal-compliance-rebuild.md) (archive mode, AEC-timetable lifecycle),
[0008](0008-aggregate-counters.md) (longitudinal research storage)

## Context

The card's policy questions derive from They Vote For You (TVFY) records, but TVFY is a **living
database with no history API** — 42 of the 50 policies used in 2019 have been edited since that
election, so the live API cannot serve as an audit record for what voters were shown. The chosen
approach: *lock the election release, not the underlying truth*, using the
**declaration of nominations** as the formal baseline — the same AEC instant at which the ballot
order becomes final and the plan builder opens (ADR 0006's timetable lifecycle).

The research angle points the same way: the stored research data is generated against the question
set as presented, so the locked release is the *stimulus*. Re-scoring past responses against later
TVFY curation would confound genuine longitudinal change with instrument drift. A locked release
also makes rebuilds idempotent — the existing deterministic-rebuild CI gate extends naturally from
`data/dist` back to the upstream record.

A weekly TVFY cron existed (`data-refresh.yml`) and contradicted all of this: unsupervised drift
into the source of record, plus API traffic with no release purpose.

## Decision

1. **Committed, versioned snapshot store** — `data/snapshots/tvfy/<electionId>/`:
   `versions.json` (which versions exist, which is active) and `v<N>/` holding `meta.json`
   (provenance, lock state, per-file SHA-256), `policies-list.json` (the full TVFY catalogue
   response at snapshot time), `policies/<id>.json` (raw API responses for the **used** policy ids
   only), and `ballots.json` (a copy of the election's ballots at lock — the candidate field is part
   of the same release).

2. **Lifecycle keyed to the AEC timetable** (no new `ElectionStage`; commands read the timetable
   directly via `writWindow()`):
   - **Writ window** (issue of writs → declaration of nominations): `data:snapshot:fetch` may run
     repeatedly; each run re-syncs `questions.json` (positions + division fields wholesale,
     hand-curated `text` preserved) so curation can never drift from the record.
   - **Declaration of nominations**: `data:snapshot:lock` — final fetch + sync, ballots copied in,
     meta locked. Each snapshot records its evidentiary `basis`: `contemporaneous-api-snapshot`
     (current/future elections, positions verified against the snapshot) or
     `primary-source-reconstruction` (past elections — a direct-API provenance capture; the retained
     period-accurate vintage positions are kept, not recomputed).
   - **After lock**: immutable. CI (`scripts/check-locked-snapshots.mjs`) fails any PR that touches
     a locked version except archive refills and `versions.json` appends.

3. **Corrections are new versions, never edits.** A verified factual error mid-campaign →
   `data:snapshot:fetch --new-version --reason "…" --verified-by "…"`, then a fresh lock. The old
   version stays committed; `versions.json` records reason, verifier and supersession; each bump is
   disclosed on the public /corrections page. *Accepted consequence:* a v2 fetch picks up **all**
   TVFY edits since v1, not only the fix — the v1→v2 git diff is the audit record.

4. **Enforcement, fail-closed.** `validateSnapshotConsistency` (data-schema) proves
   `questions.json` — and therefore the built dataset — is exactly what the committed snapshot
   compiles to: id sets, positions, division fields, dataVersion, file hashes, and ballots
   byte-equality against the locked copy. Wired into both `data:validate` and `dataset:build`, so
   `data/dist` can never be written from a snapshot-divergent source. This closes the previously
   unenforced prose contract in `compile.ts` ("positions must match").

5. **Disabled outputs (withdrawal).** When a critical error cannot be corrected immediately, the
   question gains `withdrawn: {date, reason}`: excluded from scoring, quiz, issues pages and
   published stats; exempt from the consistency gate; disclosed on the card and /corrections. The
   share codec deliberately stays positional over the FULL question list so links shared before a
   withdrawal keep decoding correctly — withdrawn answers are inert because scoring filters them.

6. **Methodology frozen per release.** `METHODOLOGY_VERSION` moved to `@how2vote/data-schema`; the
   pipeline stamps it (and the active `snapshotVersion`) into every `manifest.json`. The method
   must not change while any election is `live`; if it ever must, that is a disclosed material
   correction.

7. **API hygiene.** The weekly TVFY cron is deleted; `data-refresh.yml` is dispatch-only and routes
   TVFY access through the guarded `data:snapshot:fetch` (which refuses outside the writ window,
   `--force` excepted, and always refuses on a lock).

8. **Past elections (2019/2022/2025): direct-API provenance, positions from the period-accurate
   capture.** For a past election the snapshot is a `primary-source-reconstruction`: a direct TVFY
   API provenance capture of the used policy pages, recorded with a SHA-256 of each fetched response.
   **These corroborate the policy *pages*, not the compiled 1–5 positions** — the positions for past
   elections rest on the period-accurate committed capture (`data/v0-seed/<id>/`, ADR 0002) and are
   permanently unverifiable against any later snapshot; nobody should mistake the provenance records
   for position evidence. `data:snapshot:divisions` backfills vintage-filtered division fields
   (divisions dated ≤ each election's dataVersion) so past and future elections share the same
   question shape — retrospective metadata under today's TVFY curation, likewise not
   snapshot-verified.

## Consequences

- The next election requires, in order: add the election + AEC timetable to `ELECTIONS`
  (`packages/data-schema/src/elections.ts`), seed its `questions.json` (curated wording + policy
  ids), then `data:snapshot:fetch` inside the writ window and `data:snapshot:lock` at the
  declaration. The guards' refusal messages walk the operator through this.
- Live TVFY data reaching users always has a committed, hash-verified ancestor; research series
  carry a per-release `dataVersion` + `snapshotVersion` + `methodologyVersion`, and any correction
  is a visible series event, not silent drift.
- Party-registry churn surfaces at sync time via the existing `unknown-position-key` gate —
  expected curation work during the writ window, by design.
- TVFY edits *after* an election are treated as errata to annotate (a drift report can diff the
  live API against the locked snapshot at any time), never merged into the release.
