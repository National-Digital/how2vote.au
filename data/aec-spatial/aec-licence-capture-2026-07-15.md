<!--
  AEC SPATIAL DATA DOWNLOAD — DATA LICENCE (contemporaneous capture)
  =================================================================
  This file is retained EVIDENCE: a contemporaneous copy of the
  AEC Spatial Data Download Data Licence terms that govern the federal boundary GIS this project's map
  geometry is derived from. It is kept in the repository alongside the machine-readable
  data/aec-spatial/source-record.json (which pins the exact downloaded archive by SHA-256) so the data
  and the licence that governs it travel together.

  Captured from https://www.aec.gov.au/Electorates/gis/ on 2026-07-15. The page records the licence as
  "Updated: 25 June 2013"; it has been stable since. See source-record.json `licence.copyrightYearNote`
  for the copyright-year anomaly (the page renders the Commonwealth copyright year as 2026 despite the
  2013 update). The raw download archive itself is NOT committed (licence-restricted + large); it is
  retained in the restricted corporate store and pinned here by checksum.
-->

# AEC Spatial Data Download — Data Licence

- **Source page:** https://www.aec.gov.au/Electorates/gis/ ("Data download licence")
- **Page last updated (per the AEC):** 25 June 2013
- **Captured:** 2026-07-15
- **Governs:** Commonwealth Electoral Boundaries GIS downloads (e.g. `AUS-March-2025-esri.zip`)

## Prescribed Derivative Product notice

The licence requires a digital Derivative Product to display the following notice (with the product
name substituted for `XXXX`). Reproduced verbatim as captured:

> This product (XXXX) incorporates data that is: © Commonwealth of Australia (Australian Electoral
> Commission) 2026
>
> The Data (Commonwealth Electoral Boundaries (various years)) has been used in XXXX with the
> permission of the Australian Electoral Commission.
>
> The Australian Electoral Commission has not evaluated the Data as altered and incorporated within
> XXXX, and therefore gives no warranty regarding its accuracy, completeness, currency or suitability
> for any particular purpose.
>
> You may use XXXX to load, display, print and reproduce views obtained from the Data, retaining this
> notice, for your personal use, or use within your organisation only.

For a non-digital / simpler publication the licence permits the shorter form: the product name with
"incorporates data that is © Commonwealth of Australia (Australian Electoral Commission) 2026".

## Notes / outstanding

- The Commonwealth copyright year rendered by the AEC page is **2026**, even though the page states the
  licence was last updated 25 June 2013. Per legal instruction the copyright year is taken from the
  accepted licence wording, **not** derived from the boundary/election year. Written AEC confirmation of
  the correct year treatment remains outstanding.
- The exact downloaded archive used to build this project's geometry is pinned by SHA-256 in
  `source-record.json`; a named reviewer attestation (that this file + this licence governed the
  committed geometry) is the remaining human step before the record moves from provisional to current.
