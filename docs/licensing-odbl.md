# ODbL compliance — attribution and share-alike

Status: **Attribution shipped; the derived vote-position database is published under ODbL with the
open alteration method; a formal legal characterisation of the coarse research aggregates remains
pending** (ADR [0006](adr/0006-legal-compliance-rebuild.md); rights register
[`data/rights/rights-classes.json`](../data/rights/rights-classes.json)).

The parliamentary voting data comes from **They Vote For You**, a project of the
**OpenAustralia Foundation**, under the **Open Database Licence (ODbL) 1.0** — granted to the
extent the OpenAustralia Foundation has rights in the data (per the They Vote For You licensing
page). Exact endpoint-level provenance is recorded in `LICENSE-DATA.md`; no OpenAustralia.org
API data is used in this project.

## Attribution — done

They Vote For You (OpenAustralia Foundation) and the ODbL are credited on every screen and
printed output: the site footer (`Footer.svelte`, via `src/lib/org.ts`), the methodology,
About and Terms pages, and the card's data-vintage line. `LICENSE-DATA.md` holds the full
attribution and licence text.

## Share-alike — how it is satisfied

ODbL §4.4 (share-alike) requires a publicly-used **derived database** to be offered under a
compatible open licence with the same attribution, and §4.6 lets that be met by publishing either
the database itself **or the method of alteration** in machine-readable form. How2Vote satisfies both
for the derived vote-position database:

- **The derived database is published**: `data/dist/**` is committed openly in this public repo,
  checksummed, and asserted as ODbL for the vote-position domain in `LICENSE-DATA.md`
  (generated from the rights register), carrying the required TVFY/ODbL attribution.
- **The alteration method is published**: the entire compilation pipeline (`packages/data-pipeline`)
  is open source (AGPL) and public, so anyone can reproduce the derived database from the TVFY source
  — a deterministic, checksummed rebuild the CI deterministic-rebuild gate proves.

Deliberately **not** asserted as an ODbL derived database:

- The coarse, k-suppressed research aggregates (`stats/*.json` on `/insights`, and the `schema.org`
  `Dataset` node) carry **no `license` field** (`structured-data.ts`) — they are the project's own
  aggregate outputs, published without a reuse grant, which is the safe position.
- There is no public research **API** over the aggregates.

Remaining for the electoral/licensing sign-off (control-16), not a repo contradiction:

1. A formal legal characterisation of the research aggregates ("derived database" vs "produced
   work") and whether they should carry ODC-BY.
2. AEC candidate/spatial licences are marked **provisional** in the rights register pending
   verification of the exact source terms (`LICENSE-DATA.md`).

Because the AEC boundary geometry is under a **restrictive** licence (not ODbL), it is excluded from
any ODbL export by the rights-domain separation gate (`scripts/check-rights-domain.mjs`).
