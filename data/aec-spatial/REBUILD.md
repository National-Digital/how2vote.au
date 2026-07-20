# Reproducibly verifying the AEC boundary geometry

The electoral boundary maps under `apps/web/static/maps/` are a **Derivative Product** built from AEC
federal boundary GIS data. The AEC Spatial Data Download Data Licence restricts redistribution of the
**raw** data (see [`aec-licence-capture-2026-07-15.md`](./aec-licence-capture-2026-07-15.md)), so the
raw archive is **not committed** — it is git-ignored and held in the restricted corporate store.

That does not make the maps unverifiable. The raw source is pinned by SHA-256 in
[`source-record.json`](./source-record.json), and the build is fully open, so anyone can reproduce and
audit the committed geometry **without us redistributing the raw data**:

## 1. Obtain the same AEC source (free, under the same licence)

Download the national ESRI boundary set from the AEC and accept the licence:
<https://www.aec.gov.au/Electorates/gis/gis_datadownload.htm> (the file pinned here is
`AUS-March-2025-esri.zip`, boundary data dated 2025-02-25).

## 2. Confirm it is byte-identical to what we built from

```sh
pnpm aec-archive:verify        # hashes the local archive, compares to the pinned SHA-256
```

Place the **archive** (`AUS-March-2025-esri.zip` — the file named in `source-record.json`) under
`data/source/boundaries/` or `data/raw/boundaries/`. The tool hashes that exact archive: it prints
`OK` on a match, `SKIP` if the archive is absent (it is git-ignored, so CI always skips), and fails on
a mismatch. The pinned digest is
`sha256 = bdc0393d8448477bf187ac84473978330f776b5ea2ed6343f7eb891187263a09`. (Extracting the shapefile
parts alone will not be checksum-verified — the tool matches the pinned archive; the extracted
`AUS_ELB_region.{shp,shx,dbf,prj}` are what the rebuild in step 3 consumes.)

## 3. Rebuild the derivative geometry and diff

```sh
pnpm data:maps                 # regenerates apps/web/static/maps/<id>/*.json from the raw boundaries
pnpm format                    # apply the repo's Prettier formatting (the committed maps are formatted)
git diff --exit-code apps/web/static/maps
```

The build (`packages/data-pipeline/src/bin/build-maps.ts`) reprojects to Australian Albers, simplifies,
and omits remote external territories — the transformations the licence's derivative-product notice
describes. The pipeline writes the JSON with `JSON.stringify(…, 2)`; the committed files are then run
through Prettier (`apps/web/static/maps/**` is **not** in `.prettierignore`), so re-run `pnpm format`
before diffing or the only differences you will see are Prettier collapsing the short numeric
`viewBox`/`bbox` arrays onto one line — the geometry itself is unchanged. With that step,
`git diff --exit-code apps/web/static/maps` is **clean**: the committed geometry is a byte-identical,
reproducible rebuild of the pinned AEC archive (verified on 2026-07-16 from the archive whose SHA-256
matches `source-record.json`). Attribution in each file is sourced from `MAP_ATTRIBUTION`; the full
prescribed derivative-product notice is generated into `LICENSE-DATA.md` and shown in-app next to every
map (`apps/web/src/lib/mapLicence.ts` → `ElectorateMap.svelte`).

## Provenance attestation

Because CI never holds the git-ignored raw archive, the link between the pinned file, its licence, and
the committed geometry is vouched for by a **named (single) reviewer** recorded in `source-record.json`
(`sources[].reviewer` / `reviewedAt`) — the same single-reviewer attestation pattern as the AEC
candidate provenance. (This is a self-attestation by the maintainer, not the independent
two-reviewer control used for ballot order.) The reproducible steps above let any third
party independently confirm that attestation.
