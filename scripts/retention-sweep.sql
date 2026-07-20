-- Research data end-of-purpose deletion (docs/privacy/retention.md; ADR-0008).
--
-- Under the aggregate-counters model the store holds only running group counts
-- (docs/research/analysis-plan.md) — no per-person record, no delta/day-grained store, no timestamp
-- finer than a calendar quarter. Those counts are genuinely aggregated statistics that do not relate
-- to an identifiable individual, so the Privacy Policy §5 permits retaining them INDEFINITELY: there
-- is deliberately NO age-based sweep (a retention clock never mitigated the residual small-cell risk
-- anyway — see retention.md).
--
-- Deletion therefore happens only on a PURPOSE-BASED decision: an after-election review, or a PIA
-- practitioner direction, determines that a particular election wave's counters are no longer
-- required (or carry unacceptable small-cell risk). This file is the template for that occasional,
-- deliberate deletion — it is NOT scheduled and does NOT run itself.
--
-- Set :election_id to the four-digit election year to delete, then run from an ops host with
-- Cloudflare credentials, e.g.:
--   wrangler d1 execute how2vote-research --remote \
--     --command "DELETE FROM demographic_count WHERE election_id = '2019'"   -- (and each table below)
--
-- A delete is a hard delete. It MUST be paired with a tested backup-destruction / backup-rotation
-- step (see retention.md): rows deleted from the live database can persist in D1 point-in-time-
-- recovery snapshots and any exported backups until those expire or are destroyed. That backup step
-- is operational and is NOT expressed in this SQL.

-- Replace 'YYYY' with the election year whose purpose has ended, and record the decision in the
-- analysis plan's review table before running.
BEGIN TRANSACTION;

DELETE FROM response_total          WHERE election_id = 'YYYY';
DELETE FROM demographic_count       WHERE election_id = 'YYYY';
DELETE FROM proposition_count       WHERE election_id = 'YYYY';
DELETE FROM proposition_party_count WHERE election_id = 'YYYY';
DELETE FROM weighting_frame_count   WHERE election_id = 'YYYY';
DELETE FROM collection_period_count WHERE election_id = 'YYYY';
DELETE FROM consent_count           WHERE election_id = 'YYYY';
-- geography_count is a bare electorate tally with nothing attached; §5 permits keeping it, and it
-- feeds the long-run coverage record. Include it only if a review decides the wave is fully retired:
-- DELETE FROM geography_count       WHERE election_id = 'YYYY';

COMMIT;
