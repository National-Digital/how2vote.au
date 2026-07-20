# scripts/

Repo maintenance and deployment scripts. This README documents the **research data retention sweep**;
the other scripts are self-documented in their file headers.

| File | Purpose |
|------|---------|
| `retention-sweep.sql` | Per-election end-of-purpose deletion template for the research counters (see below). |
| `deploy-cloudflare-pages.mjs` | Deploys the built static site to Cloudflare Pages. |
| `cleanup-cloudflare-preview.mjs` | Prunes stale Cloudflare Pages preview deployments. |
| `next-version.mjs` | Computes the next release version. |
| `check-locked-snapshots.mjs` | CI guard: locked TVFY snapshot versions are immutable (see below). |

## Locked-snapshot guard — `check-locked-snapshots.mjs`

Enforces ADR 0005 for the committed TVFY snapshots under `data/snapshots/tvfy/`: once a version
directory's `meta.json` says `locked: true` on the base branch, a PR may not add, modify, rename,
or delete anything under that `v<N>` directory. Two narrow carve-outs: `archives.json` may take a
**fill-only** update (records flipping `failed` → `archived` once a Wayback capture succeeds on
retry, everything else byte-identical), and the election-level `versions.json` is **append-only**
(existing history entries preserved verbatim, a `null` `lockedAt` may be filled in, `active` may
move). The rules are evaluated against the merge-base, so the PR that creates or locks a version
passes. Run locally with `node scripts/check-locked-snapshots.mjs`; in CI it exits non-zero with
`::error::` annotations per violation.

## Research data deletion — `retention-sweep.sql`

Under the aggregate-counters model (ADR-0008) the store holds only genuinely aggregated group
counts, which are not personal information, so the Privacy Policy §5 permits retaining them
**indefinitely** — there is **no age-based sweep**. Full posture, review
checklist, and the backup-destruction requirement are in
[`docs/privacy/retention.md`](../docs/privacy/retention.md).

**What it deletes:** nothing on a schedule. The file is a **template for purpose-based deletion** —
when an after-election review or the PIA practitioner retires a particular election wave, its counter
rows are deleted by `election_id` across the counter tables (`response_total`, `demographic_count`,
`proposition_count`, `proposition_party_count`, `weighting_frame_count`, `collection_period_count`,
`consent_count`). It does **not** touch `geography_count` (a running integer tally = genuinely
aggregated statistics) or the published `stats/*.json` unless a review decides. There are no
per-person tables — the schema (migration `0001`) is aggregate-only by construction.

**How to run** — an occasional, deliberate operation, not a cron. Set the election year in the SQL
(or pass it inline) and run from an ops host with Cloudflare credentials:

```sh
wrangler d1 execute how2vote-research --remote \
  --command "DELETE FROM demographic_count WHERE election_id = '2019'"   # …and each counter table
```

**Important:**

- The counters are aggregate statistics; keeping them is the default. Deletion is the exception,
  driven by a recorded review decision (`docs/research/analysis-plan.md` review table).
- A hard delete is not enough on its own: it **must be paired with a tested backup-destruction /
  point-in-time-recovery-horizon step**, or deleted rows can persist in D1 snapshots/exports. That
  step is operational and is not expressed in the SQL (see `docs/privacy/retention.md` §3). The same
  step covers the destruction of any earlier per-person data (de-identified to counters; see PIA §6).
- **Status:** the SQL and procedure are in place; **the backup-destruction step and the recurring
  review are not yet operationalised and require sign-off before launch.**
