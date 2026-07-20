# Data licence & provenance

Data in this repository is **NOT** all under one licence, and it is **not** under the repository's
AGPL code licence. Each data **domain** carries its own rights class, kept separate so no source's
terms contaminate another. **[`../LICENSE-DATA.md`](../LICENSE-DATA.md) is the authoritative,
per-domain licence notice** (generated from [`rights/rights-classes.json`](rights/rights-classes.json)
and drift-gated) — always check it before redistributing anything here. Do **not** treat any file as
ODbL just because it lives under `data/`.

Per-domain summary (see `LICENSE-DATA.md` for the exact terms and required attribution):

| Domain | Where | Licence | Redistribution |
|--------|-------|---------|----------------|
| Parliamentary vote/position data | `source/**/positions*`, compiled into `dist/` | **ODbL v1.0** — Derivative Database of [They Vote For You](https://theyvoteforyou.org.au/) (© OpenAustralia Foundation). Attribution **and** share-alike are obligations. | Permitted under ODbL (share-alike). |
| AEC candidate / ballot / electorate data | `source/**/ballots*`, `source/<id>/aec-sources.json` | **CC BY 4.0** (provisional — pending verification), from public AEC nomination publications. | Permitted with attribution. |
| AEC federal boundary geometry | `aec-spatial/`, compiled maps | **AEC Spatial Data Download Data Licence** (restrictive) — © Commonwealth of Australia (AEC). **Redistribution restricted**; a Derivative Product notice must be shown wherever the geometry appears. | **Restricted** — do not redistribute the raw geometry; see `LICENSE-DATA.md` + `aec-spatial/source-record.json`. |
| Project aggregates & research stats | `dist/**/stats*`, `snapshots/` compiled outputs | **No licence asserted** — the project's own compiled aggregates; reuse terms are not granted here. | Not licensed for reuse without asking. |
| `v0-seed/` | `v0-seed/` | Pre-rewrite seed kept for provenance + the dataset migration; its vote/position portion is ODbL as above. | Per its underlying domain. |

| Path | Contents |
|------|----------|
| `source/` | Curated per-election inputs (questions, positions, ballots) the pipeline compiles from, plus per-election provenance records (`aec-sources.json`, `ballot-verification.json`, `candidate-mapping.json`). |
| `dist/` | Compiled, checksummed dataset shipped with the build — each `manifest.json` carries the data vintage and attribution string. |
| `aec-spatial/` | AEC boundary-geometry source record + rebuild instructions (the raw archive is git-ignored — restricted redistribution). |
| `rights/` | `rights-classes.json` — the single source of truth for every domain's rights class; `LICENSE-DATA.md` is generated from it. |
| `governance/` | The signed runtime kill-switch control plane (`control-plane.json`). |
| `snapshots/` | Locked upstream TVFY snapshots, immutable after lock (ADR 0005). |
| `corrections/` | Published correction records. |
| `question-order.json` | Append-only canonical question-id order per election (pins the positional share-link codec). |
| `v0-seed/` | Pre-rewrite seed data, kept for provenance and the dataset migration (`packages/data-pipeline/src/migrate.ts`). |

Raw upstream fetches (`data/raw/`) are reproducible and never committed — see the root `.gitignore`.
