# Corrections & emergency controls

Election-period operations for How2Vote (ADR
[0006](adr/0006-legal-compliance-rebuild.md)). This file is the **public correction log**
and the runbook for the emergency controls.

## Reporting an error

Suspected errors — a wrong candidate, party mapping, ballot order, or alignment figure —
go through the [contact page](https://how2vote.au/contact) or `how2vote@nationaldigital.com.au`.
The contact channel is monitored during a campaign.

### Response times

- **General:** we aim to respond to a correction report within **5 business days** (matching the
  accessibility-feedback timeframe).
- **During an election period:** the target tightens to **1 business day**. Where a fix cannot be
  made immediately, the affected function is switched to comparison-only (see `EXPORTS_ENABLED`
  below) rather than leaving a ballot-order error in a printable plan.

## What is preserved for every score

So any published figure can be audited or reconstructed after the fact, the following are kept for
every score:

- **Source snapshots** — the committed dataset is deterministically reproducible and carries a
  tamper-evident checksum and a data vintage (the latest division the positions are compiled from).
  The candidate ballots also carry the date they were retrieved from the AEC (`ballots.dataVersion`).
- **The locked TVFY snapshot** (ADR [0005](adr/0005-tvfy-snapshot-lock.md)) — from the next
  election on, the raw They Vote For You responses each question compiles from are committed under
  `data/snapshots/tvfy/<election>/`, frozen at the declaration of nominations, hash-verified in CI,
  with the raw responses' retrieval timestamp and response hash recorded as direct-API provenance
  (there is no external web-archive path). The manifest records the `snapshotVersion` and
  `methodologyVersion` each release was built under. For 2019/2022/2025 the snapshot is a direct-API
  `primary-source-reconstruction` capture; their displayed positions are the retained,
  period-accurate vintage compilation in `data/source/<id>/questions.json`.
- **The exact parliamentary divisions** behind each proposition — every proposition and party record
  links back to the divisions on They Vote For You.
- **Proposition wording and approval** — the curated wording of each proposition is versioned with
  the dataset, so the exact text a score was computed against is recoverable.

## Correcting locked election data (re-snapshot as a new version)

A locked snapshot is never edited. A verified factual error in the TVFY-derived data (or the locked
ballots) is corrected by creating a **new snapshot version**:

1. `pnpm data:snapshot:fetch <election> --new-version --reason "…" --verified-by "…"` — the reason
   and verifier are recorded permanently in `versions.json`.
2. Re-lock with `pnpm data:snapshot:lock <election>`.
3. Rebuild and validate; commit snapshot + source + dist together.
4. Record the correction in the log below **and** on the public `/corrections` route.

The superseded version stays in git — the v1→v2 diff is the audit record. Note a new version
re-fetches the live API, so it carries *all* TVFY edits since the previous version, not only the
fix; that is disclosed by the version bump itself.

Where a critical error cannot be corrected immediately, the affected question is **withdrawn**
(`withdrawn: {date, reason}` in `questions.json`): it disappears from the quiz, card, issues pages
and published stats, the card discloses the withdrawal, and it is listed here and on `/corrections`
until a corrected version replaces it. This is the per-question lever beneath the global
`EXPORTS_ENABLED` kill switch.

## Correction log

Each published correction is recorded here: date, what was wrong, what changed, the data
version before/after, and who verified it. (No corrections yet — pre-launch.)

The public-facing mirror of this log is the `/corrections` route
(`apps/web/src/routes/corrections/+page.svelte`); keep the two in sync when a correction is added.

| Date | Election | Issue | Change | Data version | Verified by |
| ---- | -------- | ----- | ------ | ------------ | ----------- |
| —    | —        | —     | —      | —            | —           |

## Methodology change log

Changes to the **scoring method** (as distinct from data corrections) are recorded, dated and
versioned, in [methodology-changelog.md](methodology-changelog.md). The current method version is
also surfaced on the [methodology page](https://how2vote.au/methodology) and the
[/corrections](https://how2vote.au/corrections) route. A pure data refresh does not bump the method
version.

## Emergency controls

Governance flags live in `apps/web/src/lib/governance.ts`:

- **`EXPORTS_ENABLED`** — global kill switch for building/printing a voting plan. Set
  `false` to force the whole site to comparison-only (e.g. a discovered ballot-order
  error) without a data rollback.
- **Per-election ballot-final gate** — a plan builder opens only once an election's ballot
  order is final and verified (`plansEnabled` on the card, derived from the election date;
  a future upcoming election stays comparison-only until its verified candidate list is
  ingested).
- **Stale-plan handling** — a plan's worksheet always prints the build date and the data +
  app versions, so a stale printout is self-evident; the Terms tell voters to re-check the
  ballot paper.

Larger levers (disable one electorate / ballot type, full data rollback, taking the site
down) are operational: redeploy with a corrected dataset (the dataset is deterministically
reproducible and checksummed) or toggle the flag above and redeploy.

## Verification before each election

Automated dataset integrity checks run in CI (`pnpm data:validate`, the deterministic-
rebuild gate). Before enabling plan export for a new election, a second person signs off a
full-electorate + Senate regression against the official candidate list and
records it in the correction log.

## Pending provenance items (not yet fabricated)

These provenance fields are intentionally left blank rather than filled with placeholder values:

- **Human-verification date.** The second-person ballot sign-off date (above) must be recorded
  during an actual data sign-off. It is captured in the correction log's "Verified by" column at
  that time; no sign-off date is asserted before it happens.

(Resolved 2026-07-14: per-proposition `divisionFirst`/`divisionLast`/`divisionCount` are now
populated — synced from the locked snapshot for future elections, and backfilled for 2019/2022/2025
via `data:snapshot:divisions` with divisions filtered to each election's data vintage. The
backfilled fields reflect today's TVFY division curation and are retrospective metadata, not
snapshot-verified evidence — see ADR [0005](adr/0005-tvfy-snapshot-lock.md).)
