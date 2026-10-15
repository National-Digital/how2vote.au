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
- **The derived database is also served as static files**: `https://how2vote.au/data/<election>/propositions.json`
  and `positions.json` (built by `apps/web/src/lib/open-data.server.ts`, described by
  `/data/openapi.json`) carry the ODbL licence name and link, the required TVFY attribution, the
  source, the publisher and a statement of How2Vote's modifications (the proposition wording is
  adapted from TVFY policy descriptions and editorial; the party positions are computed from TVFY
  member figures), with the ODbL terms read from the rights register. National Digital licenses its
  contributions to these files (the adaptation of the proposition wording and the computed
  positions) under the Database Contents License (DbCL-1.0, `contentsLicense`), to the extent it
  has rights in them; the register's tvfy-odbl notes record this grant. The registered party names
  in `positions.json` are facts, credited to the AEC as their source under `attributions` (scoped
  to `parties[].name where independent is false`; independents' names come from TVFY member
  records), with no licence stated for them inside the ODbL file. The CC0 dedication on
  `/data/openapi.json` covers that description document only. Only elections with an entry in `data/rights/proposition-content-rights.json` are
  published, so the upcoming election is withheld. The AEC candidate
  ballots are served in their own `candidates.json` under CC BY 4.0 with the AEC attribution, the
  AEC download they were built from and a modifications statement. A domain whose class does not
  permit redistribution (boundary geometry, research aggregates) is refused at build. The `Dataset`
  JSON-LD for these files on `/methodology` states the licence on each `DataDownload`.
- **The alteration method is published**: the entire compilation pipeline (`packages/data-pipeline`)
  is open source (AGPL) and public, so anyone can reproduce the derived database from the TVFY source
  — a deterministic, checksummed rebuild the CI deterministic-rebuild gate proves.

Deliberately **not** asserted as an ODbL derived database:

- The coarse, k-suppressed research aggregates (`stats/*.json` on `/insights`, and their `schema.org`
  `Dataset` node) carry **no `license` field** (`structured-data.ts`) — they are the project's own
  aggregate outputs, published without a reuse grant, which is the safe position.
- There is no public research **API** over the aggregates.

Open question for the rights register (control-14, `EV-RIGHTS-CLASSES`), not a repo contradiction:

1. A formal legal characterisation of the research aggregates ("derived database" vs "produced
   work") and whether they should carry ODC-BY. The register's current position is the
   project-owned `how2vote-aggregates` class with no open-data licence.

The AEC licences are settled in the register as `current`: candidate, ballot and electorate data
under CC BY 4.0 (`aec-candidate-data`, `EV-AEC-SOURCE-RECORDS`, control-10) and boundary geometry
under the AEC Spatial Data Download Data Licence (`aec-boundary-spatial`, `EV-AEC-SPATIAL-LICENCE`,
control-15).

Because the AEC boundary geometry is under a **restrictive** licence (not ODbL), it is excluded from
any ODbL export by the rights-domain separation gate (`scripts/check-rights-domain.mjs`).
