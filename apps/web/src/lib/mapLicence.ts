/**
 * The AEC Spatial Data Download derivative-product notice, surfaced adjacent to every rendered
 * boundary map.
 *
 * The AEC federal boundary geometry the maps are derived from is licensed under the AEC Spatial
 * Data Download Data Licence (NOT CC BY 4.0). That licence requires a *digital Derivative Product*
 * to display a prescribed notice wherever the data is shown — a bare attribution credit is not
 * sufficient. The prescribed wording is captured verbatim in
 * `data/aec-spatial/source-record.json` (guarded by scripts/check-aec-spatial.mjs and mirrored
 * into LICENSE-DATA.md). This module re-exports it so the in-app display is single-sourced from
 * that record: the notice text is never hand-copied into a component, so it cannot drift from the
 * accepted licence wording.
 *
 * Imported via the `$data` alias (svelte.config.js → ../../data); named imports let Vite
 * tree-shake the record's bulky `sources[]` provenance array out of the client bundle.
 */
import { notice, licence } from "$data/aec-spatial/source-record.json";

/** The prescribed derivative-product notice, one paragraph per component, verbatim from the record. */
export const MAP_LICENCE_NOTICE: readonly string[] = notice.components;

/** The governing licence's name (e.g. "AEC Spatial Data Download Data Licence"). */
export const MAP_LICENCE_NAME: string = licence.name;

/** The AEC licence page the notice is prescribed by. */
export const MAP_LICENCE_URL: string = licence.url;
