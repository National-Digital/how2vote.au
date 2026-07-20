# 0004 — AEC candidate nominations are a manual, election-time ingestion step

- Status: **Accepted** (AEC ingestion is deliberately manual/semi-automated; reversible — see "Reintroduction path")
- Deciders: National Digital

## Context

The tool needs two upstream data sources:

1. **They Vote For You (TVFY)** — parties' recorded parliamentary votes. TVFY exposes a stable, keyed
   HTTP API, so this fetch is automated: `data-refresh.yml` runs it on a manual dispatch or a webhook
   (whenever the `TVFY_API_KEY` secret is present), recompiles the positions, rebuilds the checksummed
   dataset, and opens a PR. There is no scheduled polling of TVFY (ADR 0005).
2. **Australian Electoral Commission (AEC)** — the list of House and Senate candidates on each ballot.
   The AEC only publishes candidate nominations **once, after nominations are declared for a called
   election**, as CSV downloads on the Tally Room / media feed. There is:
   - **no stable API and no persistent URL** — each election is a new event with its own
     (unannounced-in-advance) download URLs;
   - **no live feed between elections** — for ~3 years at a time there is simply nothing to fetch, and
     the current ballots stand;
   - **no clean machine signal** for "nominations are now declared".

The pipeline already contains a *ready-to-run* AEC ingester (`packages/data-pipeline/src/aec.ts` +
`bin/fetch-aec.ts`), and `data-refresh.yml` exposes `aec_house_csv_url` / `aec_senate_csv_url` as
`workflow_dispatch` inputs. What it does **not** do is discover those URLs or run the AEC fetch on the
cron/webhook path — that step is guarded on the manual inputs being supplied.

Separately, note that **no data is fetched during `pnpm build` or in the build/CI job at all.** The web
app imports the committed, checksummed `data/dist/dataset.json`; CI's deterministic-rebuild gate rebuilds
that bundle from committed `data/source`, never from upstream. Data acquisition is decoupled from the
build on purpose (determinism, checksummed ODbL provenance, offline reproducibility). This ADR is about
the *refresh* pipeline, not the build.

## Decision

**AEC candidate nominations are ingested by a deliberate, human-initiated, semi-automated step at
election time — not by automatic discovery.** When nominations are declared, an operator runs the
`Data refresh` workflow via `workflow_dispatch`, supplying the two published AEC nomination CSV URLs. The
workflow then fetches, parses, rebuilds and validates the dataset, and opens a PR for review. Between
elections, the committed ballots stand and no AEC fetch runs.

## Rationale

- **No stable upstream contract.** The AEC provides neither an API nor a durable URL nor a
  nominations-declared signal. Any fully automatic fetch would rest on scraping or hard-coded per-event
  URLs — brittle infrastructure for a path that fires roughly once every three years.
- **Correctness at the moment it matters most.** The ballot is the one artifact that must be exactly
  right on polling day. A human pasting the two official URLs from the AEC is more trustworthy than
  auto-discovery that could silently pull a stale, partial, or wrong event's file.
- **The valuable automation already exists.** Everything downstream of the URLs — download, RFC-4180 CSV
  parsing, ballot-shape mapping, electorate derivation, schema + join-map validation, checksum, PR — is
  automated and tested (`aec.test.ts`). The only manual act is providing two URLs a handful of times per
  decade.
- **Low ongoing cost.** Elections are infrequent and their calling is highly visible; there is no
  monitoring burden between them.

## Consequences

- Ballots do **not** refresh automatically when an election is called; an operator must trigger the
  workflow with the AEC CSV URLs (documented under "Manual steps" in the README).
- The dispatch and `repository_dispatch` webhook refresh **TVFY data only**; they never change the
  ballots.
- If `TVFY_API_KEY` is absent the automated refresh still runs but fetches nothing and produces no
  meaningful dataset change — the secret is a prerequisite for the automatic half of the pipeline.

## Reintroduction path

Making AEC ingestion fully automatic is reversible and needs no schema or app change — only the trigger:

1. **URL discovery** — resolve the current event's House/Senate nomination CSV URLs from the AEC media
   feed / Tally Room event index (the per-event id is the only unknown), instead of taking them as
   `workflow_dispatch` inputs.
2. **A "nominations declared" trigger** — a dated `schedule` armed once an election is called, or a
   lightweight poll of the feed, to run the fetch without a human.
3. Keep the existing **validate → PR → human-merge** tail so a person still signs off on the ballot that
   ships, preserving the integrity posture.

Until an election is imminent, the manual `workflow_dispatch` is the honest, low-risk mechanism.
