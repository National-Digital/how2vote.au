# Research data retention and deletion

Status: **Retention posture implemented in policy; end-of-purpose deletion tooling scripted, its
scheduling NOT yet wired (deployment/ops task); concerns long-term retention.** See
ADR [0006](../adr/0006-legal-compliance-rebuild.md) (Retention, historical), ADR
[0008](../adr/0008-aggregate-counters.md) (aggregate counters — indefinite retention of
aggregates), the Privacy Policy §5 (`apps/web/src/routes/privacy/+page.svelte`), the
[analysis plan](../research/analysis-plan.md) (the documented purpose + review), and
`scripts/retention-sweep.sql`.

This document records the retention posture as it appears to participants, and the concrete
procedure for the deletion that is still performed.

> **ADR-0008 note — indefinite retention of aggregates.** The store holds **only aggregate
> counters** — no per-person record, no delta log, and no timestamp finer than a calendar quarter
> exists at rest. Because those group counts are **genuinely aggregated statistics that do not
> relate to an identifiable individual**, they are not personal information, the APP 11.2
> "destroy/de-identify when no longer needed" limb does not bite, and there is **no fixed retention
> maximum** — the counters may be kept indefinitely (Privacy Policy §5). This supersedes the earlier
> 15-year cap (which itself superseded the pack's 5-year draft). A retention *clock* never mitigated
> the residual small-cell risk anyway — a cell that is `n = 1` at 15 years is `n = 1` because only
> one person ever matched that combination, and time does not change that; the small-cell risk is
> handled by the key rule + publication suppression + access control, not by deletion. What remains
> is **purpose-based** deletion, not age-based.

## 1. The retention rule (as published)

The Privacy Policy §5 states, in substance:

> Research contributions are stored only as additions to aggregate group counts — there is no
> individual record. Because those counts are genuinely aggregated statistics that do not relate to
> an identifiable individual, we may **retain them indefinitely**. We still **review the aggregates
> after each federal election** and **delete any no longer reasonably required for a research
> purpose**. Retention is not limited by a fixed maximum period.

Two operative rules follow:

1. **No maximum age.** Aggregate counters are not personal information and may be kept indefinitely.
2. **Purpose-based review — after each federal election.** The continuing research need is reviewed
   after each federal election; a review may delete a wave's counters when its purpose has ended, or
   (per §5) apply a stricter publication threshold. The PIA practitioner may also direct deletion of
   a specific dimension/cell if they determine it carries unacceptable small-cell risk.

## 2. What is deleted, and what is not

| Store | Contents | Deleted? |
|-------|----------|----------|
| Research counters (`response_total`, `demographic_count`, `proposition_count`, `proposition_party_count`, `weighting_frame_count`, `collection_period_count`, `consent_count`) | group counts per election × cohort (the analysis plan's estimands) | **Only on end-of-purpose review or PIA direction** — no age-based sweep. Genuinely aggregated statistics; §5 permits indefinite retention. |
| `geography_count` | running integer tally per (election, electorate); nothing else attached, no key to anything | **No** — genuinely aggregated statistics; §5 permits indefinite retention. Include in an end-of-purpose delete if a review decides. |
| `apps/web/static/stats/*.json` | published, k≥10-suppressed aggregates | **No** — build artefacts derived from suppressed aggregates; not personal information. |

Counter rows carry **no per-row date** and are never deleted by age; when a review ends a wave's
purpose, that election's rows are deleted by `election_id`. There is **no delta or day-grained
store** (ADR-0008): the coarsest time anywhere is the collection quarter, and no per-person record
exists.

## 3. The deletion procedure

### Mechanism (stated honestly)

There is **no age-based sweep** — aggregates are retained indefinitely (§1). Deletion happens only
when an after-election review (or the PIA practitioner) ends a wave's purpose, and is therefore an
occasional, deliberate operation rather than a schedule. It runs the per-election `DELETE`s in
`scripts/retention-sweep.sql`, parameterised by `election_id`, via either:

- **`wrangler d1 execute how2vote-research --remote --command "DELETE FROM … WHERE election_id = '2019'"`** (lowest-infrastructure; reuses the deploy tooling), or
- **a one-off run of the scripted statements** from an ops host with Cloudflare credentials.

The decision (which wave, why) is recorded in the analysis plan's review table.

### Earlier per-person data: de-identified and destroyed (completed) (ADR-0008)

Any earlier per-person contributions have been converted to de-identified aggregate counters and the
per-person records destroyed, and the one-off tooling that read per-person tables has been removed, so
the committed schema (migration `0001`) is aggregate-only. The destruction record is held at
evidence-ID level in **PIA §6** and National Digital's restricted legal records (EV-DESTRUCTION-CERT).

### Tested backup destruction (must accompany any purpose-based deletion or the transition drop)

When a wave *is* deleted, a hard delete from the live database is **not** the whole job. Rows
deleted from D1 can still persist in D1 **point-in-time recovery** / Time Travel snapshots and any
exported backups. The deletion is only actually met once those copies also age out or are
destroyed — **confirm the D1 backup/PITR retention horizon, and test that a destroyed/expired
backup can no longer surface a deleted row**. This is a deployment task, not expressed in code.
(It also covers the earlier per-person data destruction recorded at §3 — see the PIA §6 destruction
record.)

## 4. After-election review checklist (operational)

Run after each federal election:

1. Review whether any election wave's research purpose has ended; if so, delete its counters (the
   per-election deletes in `retention-sweep.sql`) and record the decision in the analysis plan's
   review table. Otherwise, aggregates are retained — no action needed.
2. Re-check the publication threshold (`MIN_CELL`, currently k = 10) and apply a stricter one where
   circumstances warrant (Privacy Policy §5 reserves this).
3. Confirm backup/PITR horizons are consistent with any deletion decisions above.
4. Record the review outcome (date, waves reviewed, action taken) in the analysis plan.

## 5. Status — what is done vs. outstanding

**Implemented in this change (documentation + SQL):**

- The indefinite-retention posture is documented here and matches the Privacy Policy §5 wording.
- `scripts/retention-sweep.sql` provides the concrete, transaction-safe per-election `DELETE`s for
  end-of-purpose deletion.

**Outstanding — deployment/ops, requires sign-off before launch:**

- The tested backup-destruction / PITR-horizon step described in §3 (for both purpose-based
  deletions and the transition drop).
- The recurring after-election review in §4 being operationalised (owner + calendar).
