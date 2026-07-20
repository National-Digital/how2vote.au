# TVFY snapshots — the locked election record

The committed, immutable record of the They Vote For You data behind each election's questions,
frozen at the **declaration of nominations** (ADR
[0005](../../docs/adr/0005-tvfy-snapshot-lock.md): *lock the election release, not the underlying
truth*). Every snapshot is a **direct TVFY
API capture** — there is no external web-archive path. Everything the app ships for an election is
derived — and CI-verified — from here.

## Layout

```
tvfy/<electionId>/
  versions.json           which snapshot versions exist and which is active
  v<N>/
    meta.json             provenance (source, basis, retrievedAt, responseSha256, endpoint,
                          licence), lock state, per-file SHA-256 hashes
    policies-list.json    the full TVFY /policies.json response at capture time
    policies/<id>.json    raw per-policy API responses (used policy ids only)
    ballots.json          the election's ballots.json as locked (ballot order is
                          declared final at the same instant — part of the release)
```

## Two evidentiary bases (`meta.basis`)

- **`contemporaneous-api-snapshot`** — captured live during the writ window and locked at the
  declaration of nominations. At that instant TVFY's aggregate agreement IS the relevant-period
  record, so the snapshot both provides and **verifies** the shown positions (positions must equal
  the snapshot compilation).
- **`primary-source-reconstruction`** — a past election on retained, period-accurate vintage
  positions (originally direct-API-derived at the time; the raw responses were not preserved). This
  snapshot is a **fresh direct-API provenance capture** — evidence of source, not the position
  source; `effectiveAsAt` records the compilation period. Positions are NOT recomputed from it,
  because a fetch today spans post-election divisions.

## The immutability contract

Once a version's `meta.json` says `locked: true`, **nothing in that `v<N>/` directory may change**.
A verified factual correction is a **new version**: `pnpm data:snapshot:fetch <id> --new-version
--reason "…" --verified-by "…"`, then a fresh `data:snapshot:lock`; the bump is disclosed on the
public /corrections page. `versions.json` is append-only. CI enforces all of this mechanically
(`scripts/check-locked-snapshots.mjs`).

## Lifecycle (next election)

1. Add the election + AEC timetable to `ELECTIONS` (`packages/data-schema/src/elections.ts`) and
   seed its `data/source/<id>/questions.json` (curated wording + TVFY policy ids).
2. **Writ window** (issue of writs → declaration): `pnpm data:snapshot:fetch <id>` — repeatable;
   each run re-syncs questions.json from the snapshot. Expect party-registry churn to surface via
   the `unknown-position-key` validation gate; extend `parties.json` as needed.
3. **Declaration of nominations**: `pnpm data:snapshot:lock <id>` — final direct-API fetch, ballots
   copied in, version locked with its provenance (retrievedAt / responseSha256 / endpoint / licence).
4. Rebuild + validate (`pnpm --filter @how2vote/data-pipeline dataset:build && pnpm data:validate`)
   and commit snapshot, source and dist together.

There is **no scheduled TVFY polling** — the fetch command refuses outside the writ window and the
lock refuses to run twice.

## Past elections (2019, 2022, 2025)

These predate contemporaneous capture, so their `v1` is a `primary-source-reconstruction` snapshot:
a fresh direct-API provenance capture of every used policy, with `effectiveAsAt` set to the election
vintage. Their displayed 1–5 positions are the retained period-accurate compilation in
`data/source/<id>/questions.json` (originally direct-API-derived at the time) — the snapshot records
provenance and is not used to recompute them.
